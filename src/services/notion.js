import { requestJson } from "../utils/http.js";

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function joinRichText(arr) {
  return (arr || []).map((t) => t?.plain_text || "").join("").trim();
}

function extractPropertyValue(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return joinRichText(prop.title);
    case "rich_text":
      return joinRichText(prop.rich_text);
    case "number":
      return prop.number ?? "";
    case "select":
      return prop.select?.name || "";
    case "status":
      return prop.status?.name || "";
    case "multi_select":
      return (prop.multi_select || []).map((o) => o.name).join(", ");
    case "url":
      return prop.url || "";
    case "date":
      return prop.date?.start || "";
    case "checkbox":
      return prop.checkbox ? "Ya" : "Tidak";
    default:
      return "";
  }
}

function summarizePage(page) {
  const fields = {};
  let title = "";
  for (const [key, prop] of Object.entries(page?.properties || {})) {
    const val = extractPropertyValue(prop);
    if (prop?.type === "title" && !title) title = String(val || "");
    if (val !== "" && val !== null && val !== undefined) fields[key] = val;
  }
  return {
    id: page.id,
    title: title || "(Tanpa Judul)",
    url: page.url || "",
    fields,
  };
}

function parseSchema(db) {
  return Object.entries(db?.properties || {}).map(([name, def]) => {
    const options =
      def.type === "select"
        ? (def.select?.options || []).map((o) => o.name)
        : def.type === "status"
          ? (def.status?.options || []).map((o) => o.name)
          : def.type === "multi_select"
            ? (def.multi_select?.options || []).map((o) => o.name)
            : [];
    return { name, type: def.type, options };
  });
}

function matchSelectOption(value, options, fieldName) {
  if (!options.length) return String(value);
  const target = String(value).trim().toLowerCase();
  const hit = options.find((opt) => opt.toLowerCase() === target);
  if (!hit) {
    throw new Error(`Nilai "${value}" tidak valid untuk kolom "${fieldName}". Opsi: ${options.join(", ")}`);
  }
  return hit;
}

function buildNotionProperties(schema, values = {}) {
  const byLowerName = new Map(schema.map((s) => [s.name.toLowerCase(), s]));
  const result = {};

  for (const [rawKey, rawVal] of Object.entries(values)) {
    const def = byLowerName.get(String(rawKey).trim().toLowerCase());
    if (!def) {
      throw new Error(`Kolom "${rawKey}" tidak ditemukan. Kolom tersedia: ${schema.map((s) => s.name).join(", ")}`);
    }
    if (rawVal === undefined || rawVal === null || rawVal === "") continue;

    switch (def.type) {
      case "title":
        result[def.name] = { title: [{ text: { content: String(rawVal) } }] };
        break;
      case "rich_text":
        result[def.name] = { rich_text: [{ text: { content: String(rawVal) } }] };
        break;
      case "number": {
        const num = Number(rawVal);
        if (!Number.isFinite(num)) throw new Error(`Kolom angka "${def.name}" harus berupa angka valid.`);
        result[def.name] = { number: num };
        break;
      }
      case "select":
        result[def.name] = { select: { name: matchSelectOption(rawVal, def.options, def.name) } };
        break;
      case "status":
        result[def.name] = { status: { name: matchSelectOption(rawVal, def.options, def.name) } };
        break;
      case "multi_select": {
        const arr = Array.isArray(rawVal) ? rawVal : String(rawVal).split(",").map((x) => x.trim()).filter(Boolean);
        result[def.name] = { multi_select: arr.map((x) => ({ name: matchSelectOption(x, def.options, def.name) })) };
        break;
      }
      case "url":
        result[def.name] = { url: String(rawVal).trim() };
        break;
      case "date":
        result[def.name] = { date: { start: String(rawVal).trim() } };
        break;
      case "checkbox":
        result[def.name] = { checkbox: Boolean(rawVal) };
        break;
      default:
        throw new Error(`Tipe kolom "${def.type}" pada "${def.name}" belum didukung untuk penulisan otomatis.`);
    }
  }
  return result;
}

/**
 * Create a Notion REST API client respecting schema validation and read-back verification.
 */
export function createNotionService(config, fetchImpl = fetch) {
  const token = (config?.notionApiKey || "").trim();

  function isConfigured() {
    return Boolean(token);
  }

  async function api(path, { method = "GET", body } = {}) {
    if (!isConfigured()) {
      throw new Error("Notion belum dikonfigurasi. Pastikan NOTION_API_KEY tersedia di environment.");
    }
    return requestJson(
      `${BASE_URL}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body } : {}),
      },
      { label: "Notion", timeoutMs: 20000, fetchImpl, extraSecrets: [token] }
    );
  }

  return {
    isConfigured,

    async listConnectedSources() {
      const databases = [];
      const pages = [];
      let cursor = undefined;

      for (let i = 0; i < 10; i++) {
        const data = await api("/search", {
          method: "POST",
          body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
        });
        for (const item of data.results || []) {
          if (item.object === "database") {
            databases.push({ id: item.id, title: joinRichText(item.title) || "(Database Tanpa Judul)", url: item.url || "" });
          } else if (item.object === "page" && item.parent?.type !== "database_id") {
            const summary = summarizePage(item);
            pages.push({ id: item.id, title: summary.title, url: item.url || "" });
          }
        }
        if (!data.has_more || !data.next_cursor) break;
        cursor = data.next_cursor;
      }

      return { databases, pages };
    },

    async getDatabaseSchema(databaseId) {
      const db = await api(`/databases/${encodeURIComponent(databaseId)}`);
      return {
        id: db.id,
        title: joinRichText(db.title) || "(Database Tanpa Judul)",
        url: db.url || "",
        schema: parseSchema(db),
      };
    },

    async getDatabaseOverview(databaseId, { pageSize = 6 } = {}) {
      const [meta, queryRes] = await Promise.all([
        this.getDatabaseSchema(databaseId),
        api(`/databases/${encodeURIComponent(databaseId)}/query`, {
          method: "POST",
          body: {
            page_size: pageSize,
            sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          },
        }),
      ]);
      return {
        ...meta,
        rows: (queryRes.results || []).map(summarizePage),
        hasMore: Boolean(queryRes.has_more),
        nextCursor: queryRes.next_cursor || null,
      };
    },

    async queryDatabase(databaseId, { query = "", startCursor, pageSize = 8 } = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      const body = {
        page_size: q ? 50 : Math.min(Math.max(Number(pageSize) || 8, 1), 25),
        ...(startCursor ? { start_cursor: startCursor } : {}),
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      };
      const res = await api(`/databases/${encodeURIComponent(databaseId)}/query`, { method: "POST", body });
      const rows = (res.results || []).map(summarizePage);
      const filtered = q
        ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)).slice(0, pageSize)
        : rows.slice(0, pageSize);
      return {
        rows: filtered,
        hasMore: Boolean(res.has_more),
        nextCursor: res.next_cursor || null,
      };
    },

    async getPagePreview(pageId) {
      const [page, blocks] = await Promise.all([
        api(`/pages/${encodeURIComponent(pageId)}`),
        api(`/blocks/${encodeURIComponent(pageId)}/children?page_size=20`),
      ]);
      const summary = summarizePage(page);
      const lines = [];
      for (const b of blocks.results || []) {
        const blockData = b[b.type];
        const txt = joinRichText(blockData?.rich_text);
        if (txt) lines.push(txt);
      }
      return { ...summary, lines: lines.slice(0, 15) };
    },

    async createDatabasePage({ databaseId, values }) {
      const { schema } = await this.getDatabaseSchema(databaseId);
      const properties = buildNotionProperties(schema, values);
      const created = await api("/pages", {
        method: "POST",
        body: { parent: { database_id: databaseId }, properties },
      });
      const readBack = await api(`/pages/${encodeURIComponent(created.id)}`);
      return { ...summarizePage(readBack), verified: Boolean(readBack?.id) };
    },

    async updatePage({ pageId, values = {}, archived }) {
      let properties;
      if (Object.keys(values).length) {
        const current = await api(`/pages/${encodeURIComponent(pageId)}`);
        const dbId = current?.parent?.database_id;
        if (!dbId) {
          throw new Error("Halaman ini bukan row database; update terstruktur hanya didukung untuk row database.");
        }
        const { schema } = await this.getDatabaseSchema(dbId);
        properties = buildNotionProperties(schema, values);
      }
      await api(`/pages/${encodeURIComponent(pageId)}`, {
        method: "PATCH",
        body: {
          ...(properties ? { properties } : {}),
          ...(archived !== undefined ? { archived: Boolean(archived) } : {}),
        },
      });
      const readBack = await api(`/pages/${encodeURIComponent(pageId)}`);
      return { ...summarizePage(readBack), archived: Boolean(readBack?.archived), verified: Boolean(readBack?.id) };
    },
  };
}
