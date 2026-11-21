import {
  normalizeMonthName,
  formatDraftPreview,
  formatIncomeOverviewText,
  formatUsageText,
} from "../services/money.js";

function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

export const moneyExtraTools = [
  fnTool(
    "money_get_income_overview",
    "Read live income sources (with monthly amounts) and allocation percentages (%) from Google Sheets Income tab.",
    {
      month: { type: "string", description: "Indonesian month name (optional; defaults to current/dashboard month)" },
      year: { type: "integer", description: "Optional year" },
    }
  ),
  fnTool(
    "money_propose_update_allocations",
    "Create a confirmation draft to update percentage (%) allocations in Google Sheets Income tab (Column B only). Never writes directly and never overwrites monthly formulas.",
    {
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kategori: { type: "string", description: "Allocation category name from Income tab Alokasi table" },
            percent: { type: "number", description: "New percentage between 0 and 100 (e.g. 25 for 25%)" },
          },
          required: ["kategori", "percent"],
        },
      },
    },
    ["updates"]
  ),
  fnTool(
    "money_get_usage",
    "Read live read-only data from Google Sheets Usage tab by specific month or full-year summary (Jan-Des).",
    {
      month: { type: "string", description: "Indonesian month name (e.g. 'November'); defaults to current/dashboard month" },
      view: { type: "string", enum: ["month", "year"], description: "'month' for category breakdown of a month, 'year' for 12-month totals" },
    }
  ),
];

function requireSheets(ctx) {
  if (!ctx?.sheetsService) throw new Error("Layanan Google Sheets tidak tersedia.");
  return ctx.sheetsService;
}

function requirePendingStore(ctx) {
  if (!ctx?.pendingStore) throw new Error("Penyimpanan draft konfirmasi tidak tersedia.");
  return ctx.pendingStore;
}

export async function executeMoneyExtraTool(name, args = {}, context = {}) {
  switch (name) {
    case "money_get_income_overview": {
      const sheets = requireSheets(context);
      const params = {
        month: args.month ? normalizeMonthName(args.month) : undefined,
        year: args.year ? Number(args.year) : undefined,
      };
      const overview = await sheets.getIncomeOverview(params);
      return `${formatIncomeOverviewText(overview)}\n\nRAW_JSON:\n${JSON.stringify(overview)}`;
    }
    case "money_propose_update_allocations": {
      const sheets = requireSheets(context);
      const rawUpdates = args.updates;
      if (!Array.isArray(rawUpdates) || !rawUpdates.length) {
        return "Error: updates minimal berisi 1 kategori alokasi.";
      }

      const seen = new Set();
      for (const item of rawUpdates) {
        const key = String(item?.kategori ?? "").trim().toLowerCase();
        const pct = Number(item?.percent);
        if (!key) return "Error: nama kategori alokasi wajib diisi.";
        if (seen.has(key)) return `Error: kategori "${item.kategori}" duplikat dalam satu permintaan.`;
        seen.add(key);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return `Error: persentase alokasi untuk "${item.kategori}" harus antara 0 sampai 100.`;
        }
      }

      const overview = await sheets.getIncomeOverview({});
      const currentRows = overview?.allocations || [];
      if (!currentRows.length) {
        return "Error: tabel Alokasi di tab Income tidak ditemukan atau kosong.";
      }

      const rowByKey = new Map(currentRows.map((r) => [String(r.kategori).toLowerCase(), r]));
      const resolvedUpdates = [];
      const nextByKey = new Map(currentRows.map((r) => [String(r.kategori).toLowerCase(), Number(r.percent) || 0]));

      for (const item of rawUpdates) {
        const key = String(item.kategori).trim().toLowerCase();
        const hit = rowByKey.get(key);
        if (!hit) {
          const validList = currentRows.map((r) => r.kategori).join(", ");
          return `Error: kategori "${item.kategori}" tidak ditemukan di tabel Alokasi. Pilihan: ${validList}`;
        }
        const newPct = Number(Number(item.percent).toFixed(2));
        nextByKey.set(key, newPct);
        resolvedUpdates.push({
          kategori: hit.kategori,
          oldPercent: Number(hit.percent) || 0,
          newPercent: newPct,
          expectedPercent: Number(hit.percent) || 0,
        });
      }

      let newTotalPercent = 0;
      for (const v of nextByKey.values()) newTotalPercent += v;
      newTotalPercent = Number(newTotalPercent.toFixed(2));

      const payload = { updates: resolvedUpdates, newTotalPercent };
      const pendingStore = requirePendingStore(context);
      const summaryText = formatDraftPreview("update_allocations", payload);
      const action = await pendingStore.create({
        userId: context.userId,
        kind: "update_allocations",
        payload,
        summaryText,
      });
      context.pendingAction = action;
      return `Draft berhasil dibuat (ID: ${action.id}). JANGAN anggap sudah tersimpan — beritahu user ringkasan draft ini dan minta user klik tombol Simpan atau Batal.\n\n${summaryText}`;
    }
    case "money_get_usage": {
      const sheets = requireSheets(context);
      const usage = await sheets.getUsage({
        month: args.month ? normalizeMonthName(args.month) : undefined,
        maxRows: args.maxRows || 60,
        maxCols: args.maxCols || 16,
      });
      const view = args.view === "year" ? "year" : "month";
      return `${formatUsageText(usage, { view })}\n\nRAW_JSON:\n${JSON.stringify(usage)}`;
    }
    default:
      return null;
  }
}
