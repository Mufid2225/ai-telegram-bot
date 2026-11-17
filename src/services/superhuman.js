import { requestJson } from "../utils/http.js";

const BASE_URL = "https://coda.io/apis/v1";
const GENERIC_TABLE_RE = /^Table\s+\d+$/i;

/**
 * Create a Superhuman Docs (Coda v1 compatible) REST client with ACL check and 202 polling.
 */
export function createSuperhumanService(config, fetchImpl = fetch, { pollDelayMs = 400 } = {}) {
  const token = (config?.superhumanApiToken || "").trim();

  function isConfigured() {
    return Boolean(token);
  }

  async function api(path, { method = "GET", params = {}, body } = {}) {
    if (!isConfigured()) {
      throw new Error("Superhuman Docs belum dikonfigurasi. Pastikan SUPERHUMAN_API_TOKEN tersedia di environment.");
    }
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    return requestJson(
      url.toString(),
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body } : {}),
      },
      { label: "Superhuman Docs", timeoutMs: 20000, fetchImpl, extraSecrets: [token] }
    );
  }

  async function checkWriteAccess(docId) {
    const acl = await api(`/docs/${encodeURIComponent(docId)}/acl/permissions`, { params: { limit: 50 } });
    return (acl.items || []).some((item) => item.access === "write");
  }

  async function getColumns(docId, tableId) {
    const res = await api(`/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/columns`, {
      params: { limit: 100 },
    });
    return (res.items || []).map((c) => ({ id: c.id, name: c.name, type: c.format?.type || "text" }));
  }

  function mapCellsToColumnIds(columns, rowObj) {
    const byLower = new Map();
    for (const c of columns) {
      byLower.set(c.name.toLowerCase(), c.id);
      byLower.set(c.id.toLowerCase(), c.id);
    }
    const cells = [];
    for (const [key, value] of Object.entries(rowObj || {})) {
      if (value === null || value === undefined || value === "") continue;
      const colId = byLower.get(String(key).trim().toLowerCase());
      if (!colId) {
        throw new Error(`Kolom "${key}" tidak ditemukan di tabel. Kolom valid: ${columns.map((c) => c.name).join(", ")}`);
      }
      cells.push({ column: colId, value });
    }
    if (!cells.length) throw new Error("Minimal 1 kolom bernilai non-kosong wajib diisi.");
    return cells;
  }

  async function waitForMutation(requestId) {
    if (!requestId) return { completed: true };
    for (let i = 0; i < 8; i++) {
      if (pollDelayMs > 0) await new Promise((r) => setTimeout(r, pollDelayMs));
      const status = await api(`/mutationStatus/${encodeURIComponent(requestId)}`);
      if (status?.completed) return { completed: true, requestId };
    }
    return { completed: false, requestId };
  }

  return {
    isConfigured,

    async listDocs() {
      const res = await api("/docs", { params: { limit: 50 } });
      return (res.items || []).map((d) => ({
        id: d.id,
        name: d.name,
        browserLink: d.browserLink || "",
        updatedAt: d.updatedAt || "",
      }));
    },

    async getDocOverview(docId) {
      const id = encodeURIComponent(docId);
      const [doc, canWrite, pagesRes, tablesRes] = await Promise.all([
        api(`/docs/${id}`),
        checkWriteAccess(docId).catch(() => false),
        api(`/docs/${id}/pages`, { params: { limit: 50 } }),
        api(`/docs/${id}/tables`, { params: { limit: 50 } }),
      ]);

      const tables = (tablesRes.items || [])
        .map((t) => ({ id: t.id, name: t.name }))
        .sort((a, b) => Number(GENERIC_TABLE_RE.test(a.name)) - Number(GENERIC_TABLE_RE.test(b.name)));

      return {
        doc: { id: doc.id, name: doc.name, browserLink: doc.browserLink || "" },
        canWrite,
        pages: (pagesRes.items || []).map((p) => ({ id: p.id, name: p.name })),
        tables,
      };
    },

    async getTableOverview(docId, tableId, { limit = 8, pageToken, query = "" } = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      const [columns, rowsRes] = await Promise.all([
        getColumns(docId, tableId),
        api(`/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/rows`, {
          params: {
            useColumnNames: true,
            limit: q ? 50 : Math.min(Math.max(Number(limit) || 8, 1), 25),
            ...(pageToken ? { pageToken } : {}),
          },
        }),
      ]);

      const mappedRows = (rowsRes.items || []).map((r) => ({
        id: r.id,
        name: r.name || "",
        values: r.values || {},
      }));
      const filtered = q
        ? mappedRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)).slice(0, limit)
        : mappedRows.slice(0, limit);

      return {
        docId,
        tableId,
        columns,
        rows: filtered,
        nextPageToken: rowsRes.nextPageToken || null,
      };
    },

    async insertRows(docId, tableId, { rows }) {
      const canWrite = await checkWriteAccess(docId);
      if (!canWrite) {
        throw new Error("Akses dokumen ini read-only (tidak punya izin tulis / ACL write).");
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error("Minimal 1 baris data diperlukan.");
      const columns = await getColumns(docId, tableId);
      const formattedRows = rows.map((row) => ({ cells: mapCellsToColumnIds(columns, row) }));
      const accepted = await api(`/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/rows`, {
        method: "POST",
        body: { rows: formattedRows },
      });
      return waitForMutation(accepted?.requestId);
    },

    async updateRow(docId, tableId, rowId, { cells }) {
      const canWrite = await checkWriteAccess(docId);
      if (!canWrite) {
        throw new Error("Akses dokumen ini read-only (tidak punya izin tulis / ACL write).");
      }
      const columns = await getColumns(docId, tableId);
      const mapped = mapCellsToColumnIds(columns, cells);
      const accepted = await api(
        `/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`,
        { method: "PUT", body: { row: { cells: mapped } } }
      );
      return waitForMutation(accepted?.requestId);
    },
  };
}
