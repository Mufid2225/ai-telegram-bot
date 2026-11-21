import { storeFact, getFacts, deleteFacts } from "./memory.js";
import {
  normalizeMonthName,
  normalizeExpenseItem,
  formatDraftPreview,
  formatSummaryText,
  formatExpensesList,
} from "./services/money.js";
import { workspaceTools, executeWorkspaceTool } from "./tools/workspace.js";
import { calendarTools, executeCalendarTool } from "./tools/calendar.js";
import { researchTools, executeResearchTool } from "./tools/research.js";
import { infoTools, executeInfoTool } from "./tools/info.js";
import { targetTools, executeTargetTool } from "./tools/targets.js";
import { moneyExtraTools, executeMoneyExtraTool } from "./tools/money-extra.js";
import { redactSecrets } from "./utils/errors.js";

function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

export const tools = [
  fnTool(
    "get_current_time",
    "Get current date, time, and ISO timestamp in local timezone (useful for relative dates like hari ini, besok, and reminders)",
    { format: { type: "string", enum: ["full", "date", "time", "day", "iso"], description: "Format output" } }
  ),
  fnTool(
    "calculate",
    "Perform mathematical calculations (budgets, weekly splits, totals)",
    { expression: { type: "string", description: "Math expression (e.g. '300000 / 4 - 50000')" } },
    ["expression"]
  ),
  fnTool(
    "money_get_options",
    "Read valid Bank, Kategori, and Income source options from Google Sheets Database tab",
    {}
  ),
  fnTool(
    "money_get_summary",
    "Read live monthly financial summary from Google Sheets MoneyTracker (Total Income, Alokasi per category, Realisasi, Saldo, overbudget status). Use before answering any budget or planning question.",
    {
      month: { type: "string", description: "Indonesian month name (e.g. 'November'), optional; defaults to current month" },
      year: { type: "integer", description: "Year (e.g. 2026), optional; defaults to current year" },
    }
  ),
  fnTool(
    "money_list_expenses",
    "Read live expense rows (including rowNumber for editing/deleting) from Google Sheets Expenses tab",
    {
      month: { type: "string", description: "Optional month filter (e.g. 'November')" },
      year: { type: "integer", description: "Optional year filter" },
      category: { type: "string", description: "Optional category filter" },
      bank: { type: "string", description: "Optional bank/wallet filter" },
      search: { type: "string", description: "Optional text search in uraian" },
      limit: { type: "integer", description: "Max rows to return (default 20)" },
    }
  ),
  fnTool(
    "money_propose_add_expenses",
    "Create a confirmation draft to add one or more expenses to Google Sheets Expenses tab. Never writes directly; user must click Simpan.",
    {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD (defaults to today)" },
            transaksi: { type: "string", enum: ["Transfer", "Cash"] },
            uraian: { type: "string", description: "Short description of expense" },
            kategori: { type: "string", description: "Must match valid category from Database" },
            bank: { type: "string", description: "Must match valid bank/wallet from Database" },
            nilai: { type: "number", description: "Positive amount in IDR" },
          },
          required: ["uraian", "kategori", "bank", "nilai"],
        },
      },
    },
    ["items"]
  ),
  fnTool(
    "money_propose_update_expense",
    "Create a confirmation draft to update an existing expense row in Google Sheets. Call money_list_expenses first to get exact rowNumber and expected values.",
    {
      rowNumber: { type: "integer", description: "Exact row number in Expenses sheet" },
      expected: {
        type: "object",
        properties: {
          date: { type: "string" },
          uraian: { type: "string" },
          nilai: { type: "number" },
        },
      },
      patch: {
        type: "object",
        properties: {
          date: { type: "string" },
          transaksi: { type: "string", enum: ["Transfer", "Cash"] },
          uraian: { type: "string" },
          kategori: { type: "string" },
          bank: { type: "string" },
          nilai: { type: "number" },
        },
      },
    },
    ["rowNumber", "patch"]
  ),
  fnTool(
    "money_propose_delete_expense",
    "Create a confirmation draft to delete an expense row from Google Sheets. Call money_list_expenses first to get exact rowNumber and expected values.",
    {
      rowNumber: { type: "integer", description: "Exact row number in Expenses sheet" },
      expected: {
        type: "object",
        properties: {
          date: { type: "string" },
          uraian: { type: "string" },
          nilai: { type: "number" },
        },
      },
    },
    ["rowNumber"]
  ),
  fnTool(
    "money_propose_upsert_income",
    "Create a confirmation draft to add or set monthly income in Google Sheets Income tab.",
    {
      source: { type: "string", description: "Income source name (e.g. 'Gaji Bulanan', 'Bonus')" },
      month: { type: "string", description: "Indonesian month name (defaults to current month)" },
      year: { type: "integer", description: "Optional year" },
      amount: { type: "number", description: "Positive amount in IDR" },
      mode: { type: "string", enum: ["set", "add"], description: "'set' replaces the cell value; 'add' adds to existing value" },
    },
    ["source", "amount"]
  ),
  fnTool(
    "save_note",
    "Save a casual note, task, or personal memo to local SQLite database (persists across restarts)",
    {
      type: { type: "string", enum: ["catatan", "tugas", "ujian"], description: "Default 'catatan'" },
      subject: { type: "string", description: "Optional topic or subject" },
      deadline: { type: "string", description: "Optional date YYYY-MM-DD" },
      content: { type: "string", description: "Note or task content" },
    },
    ["content"]
  ),
  fnTool(
    "list_notes",
    "List saved notes/tasks from local SQLite database",
    {
      type: { type: "string", enum: ["catatan", "tugas", "ujian"] },
      limit: { type: "integer" },
    }
  ),
  fnTool(
    "delete_note",
    "Delete a saved note/task by ID from local SQLite database",
    { id: { type: "integer", description: "Note ID" } },
    ["id"]
  ),
  fnTool(
    "save_reminder",
    "Schedule a persistent reminder in SQLite that notifies the user on Telegram at dueAt",
    {
      message: { type: "string", description: "What to remind the user about" },
      dueAt: { type: "string", description: "ISO-8601 timestamp with timezone offset (e.g. '2026-11-18T08:00:00+07:00')" },
    },
    ["message", "dueAt"]
  ),
  fnTool(
    "list_reminders",
    "List pending scheduled reminders from SQLite",
    {}
  ),
  fnTool(
    "delete_reminder",
    "Delete a scheduled reminder by ID from SQLite",
    { id: { type: "integer", description: "Reminder ID" } },
    ["id"]
  ),
  fnTool(
    "remember",
    "Persist a long-term fact or user preference in SQLite knowledge graph across sessions",
    {
      entity: { type: "string", description: "Topic or entity (e.g. 'budget', 'mufid')" },
      attribute: { type: "string", description: "Property name (e.g. 'transport_mingguan')" },
      value: { type: "string", description: "Fact value" },
      category: { type: "string", enum: ["keuangan", "sekolah", "pribadi", "tugas", "umum"] },
    },
    ["entity", "attribute", "value"]
  ),
  fnTool(
    "recall",
    "Search persisted facts in SQLite knowledge graph",
    { query: { type: "string", description: "Search keyword" } },
    ["query"]
  ),
  fnTool(
    "forget",
    "Delete persisted facts from SQLite knowledge graph",
    {
      entity: { type: "string" },
      attribute: { type: "string" },
    },
    ["entity"]
  ),
  ...workspaceTools,
  ...calendarTools,
  ...researchTools,
  ...infoTools,
  ...targetTools,
  ...moneyExtraTools,
];

function getCurrentTime(format = "full") {
  const now = new Date();
  if (format === "iso") return now.toISOString();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const day = days[now.getDay()];
  const date = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  switch (format) {
    case "date": return `${day}, ${date} ${month} ${year}`;
    case "time": return `${h}:${m}:${s}`;
    case "day": return day;
    default: return `${day}, ${date} ${month} ${year} ${h}:${m}:${s} (${now.toISOString()})`;
  }
}

function calculate(expression) {
  try {
    const sanitized = String(expression ?? "").replace(/[^0-9+\-*/.() ]/g, "");
    if (!sanitized.trim()) return `Ekspresi tidak valid: "${expression}"`;
    const result = Function(`"use strict"; return (${sanitized})`)();
    return `${expression} = ${result}`;
  } catch {
    return `Gagal menghitung: "${expression}"`;
  }
}

function requireSheets(ctx) {
  if (!ctx?.sheetsService) throw new Error("Layanan Google Sheets tidak tersedia.");
  return ctx.sheetsService;
}

function requirePendingStore(ctx) {
  if (!ctx?.pendingStore) throw new Error("Penyimpanan draft konfirmasi tidak tersedia.");
  return ctx.pendingStore;
}

async function createProposal(ctx, kind, payload) {
  const pendingStore = requirePendingStore(ctx);
  const summaryText = formatDraftPreview(kind, payload);
  const action = await pendingStore.create({ userId: ctx.userId, kind, payload, summaryText });
  ctx.pendingAction = action;
  return `Draft berhasil dibuat (ID: ${action.id}). JANGAN anggap sudah tersimpan — beritahu user ringkasan draft ini dan minta user klik tombol Simpan atau Batal.\n\n${summaryText}`;
}

async function handleSaveNote(args, ctx) {
  const type = args.type || "catatan";
  const res = await ctx.pool.query(
    `INSERT INTO memories (user_id, type, subject, deadline, content, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [String(ctx.userId), type, args.subject || null, args.deadline || null, args.content, new Date().toISOString()]
  );
  return `Tersimpan (${type} #${res.lastInsertRowid}): ${args.content}`;
}

async function handleListNotes(args, ctx) {
  const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 30);
  const params = [String(ctx.userId)];
  let sql = "SELECT id, type, subject, deadline, content FROM memories WHERE user_id = $1";
  if (args?.type) {
    params.push(args.type);
    sql += " AND type = $2";
  }
  params.push(limit);
  sql += ` ORDER BY id DESC LIMIT $${params.length}`;
  const { rows } = await ctx.pool.query(sql, params);
  if (!rows.length) return "Belum ada catatan tersimpan.";
  return rows.map((r) => `#${r.id} [${r.type}]${r.deadline ? ` (${r.deadline})` : ""}: ${r.content}`).join("\n");
}

async function handleDeleteNote(args, ctx) {
  const res = await ctx.pool.query("DELETE FROM memories WHERE id = $1 AND user_id = $2", [args.id, String(ctx.userId)]);
  return res.rowCount ? `Catatan #${args.id} dihapus.` : `Catatan #${args.id} tidak ditemukan.`;
}

async function handleSaveReminder(args, ctx) {
  if (!ctx?.reminderStore) throw new Error("Penyimpanan reminder tidak tersedia.");
  const created = await ctx.reminderStore.create({ userId: ctx.userId, message: args.message, dueAt: args.dueAt });
  const localTime = new Date(created.dueAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  return `Reminder tersimpan (#${created.id}) untuk ${localTime}: ${created.message}`;
}

async function handleListReminders(ctx) {
  if (!ctx?.reminderStore) throw new Error("Penyimpanan reminder tidak tersedia.");
  const rows = await ctx.reminderStore.listPending(ctx.userId);
  if (!rows.length) return "Tidak ada reminder aktif.";
  return rows.map((r) => `#${r.id} (${new Date(r.due_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}): ${r.message}`).join("\n");
}

async function handleDeleteReminder(args, ctx) {
  if (!ctx?.reminderStore) throw new Error("Penyimpanan reminder tidak tersedia.");
  const ok = await ctx.reminderStore.remove(args.id, ctx.userId);
  return ok ? `Reminder #${args.id} dihapus.` : `Reminder #${args.id} tidak ditemukan.`;
}

export async function executeTool(name, args = {}, context = {}) {
  try {
    switch (name) {
      case "get_current_time":
        return getCurrentTime(args.format);
      case "calculate":
        return calculate(args.expression);
      case "money_get_options": {
        const opts = await requireSheets(context).getContext();
        return JSON.stringify(opts);
      }
      case "money_get_summary": {
        const month = normalizeMonthName(args.month);
        const year = Number(args.year) || new Date().getFullYear();
        const summary = await requireSheets(context).getSummary({ month, year });
        return `${formatSummaryText(summary)}\n\nRAW_JSON:\n${JSON.stringify(summary)}`;
      }
      case "money_list_expenses": {
        const params = {
          month: args.month ? normalizeMonthName(args.month) : undefined,
          year: args.year ? Number(args.year) : undefined,
          category: args.category,
          bank: args.bank,
          search: args.search,
          limit: args.limit || 20,
        };
        const rows = await requireSheets(context).listExpenses(params);
        return `${formatExpensesList(rows, params.month || "")}\n\nRAW_JSON:\n${JSON.stringify(rows)}`;
      }
      case "money_propose_add_expenses": {
        const opts = await requireSheets(context).getContext();
        if (!Array.isArray(args.items) || !args.items.length) return "Error: items minimal 1 transaksi.";
        const items = args.items.map((item) => normalizeExpenseItem(item, opts));
        return await createProposal(context, "add_expenses", { items });
      }
      case "money_propose_update_expense": {
        const rowNumber = Number(args.rowNumber);
        if (!Number.isInteger(rowNumber) || rowNumber < 2) return "Error: rowNumber tidak valid.";
        const opts = await requireSheets(context).getContext();
        const patch = { ...(args.patch || {}) };
        if (patch.kategori) {
          const hit = opts.categories.find((c) => c.toLowerCase() === String(patch.kategori).trim().toLowerCase());
          if (!hit) return `Kategori tidak valid. Pilihan: ${opts.categories.join(", ")}`;
          patch.kategori = hit;
        }
        if (patch.bank) {
          const hit = opts.banks.find((b) => b.toLowerCase() === String(patch.bank).trim().toLowerCase());
          if (!hit) return `Bank tidak valid. Pilihan: ${opts.banks.join(", ")}`;
          patch.bank = hit;
        }
        if (patch.nilai !== undefined && (!Number.isFinite(Number(patch.nilai)) || Number(patch.nilai) <= 0)) {
          return "Error: nilai harus lebih dari 0.";
        }
        return await createProposal(context, "update_expense", { rowNumber, expected: args.expected || {}, patch });
      }
      case "money_propose_delete_expense": {
        const rowNumber = Number(args.rowNumber);
        if (!Number.isInteger(rowNumber) || rowNumber < 2) return "Error: rowNumber tidak valid.";
        return await createProposal(context, "delete_expense", { rowNumber, expected: args.expected || {} });
      }
      case "money_propose_upsert_income": {
        const source = String(args.source ?? "").trim();
        const amount = Number(args.amount);
        if (!source) return "Error: source income wajib diisi.";
        if (!Number.isFinite(amount) || amount <= 0) return "Error: amount harus lebih dari 0.";
        const month = normalizeMonthName(args.month);
        const year = args.year ? Number(args.year) : undefined;
        const mode = args.mode === "add" ? "add" : "set";
        return await createProposal(context, "upsert_income", { source, month, year, amount: Math.round(amount), mode });
      }
      case "save_note":
        return await handleSaveNote(args, context);
      case "list_notes":
        return await handleListNotes(args, context);
      case "delete_note":
        return await handleDeleteNote(args, context);
      case "save_reminder":
        return await handleSaveReminder(args, context);
      case "list_reminders":
        return await handleListReminders(context);
      case "delete_reminder":
        return await handleDeleteReminder(args, context);
      case "remember":
        await storeFact(context.userId, args.entity, args.attribute, args.value, args.category || "umum", context.pool);
        return `Diingat: ${args.entity} -> ${args.attribute} = ${args.value}`;
      case "recall": {
        const facts = await getFacts(context.userId, args.query, context.pool);
        return facts.length
          ? facts.map((f) => `- ${f.entity}: ${f.attribute} = ${f.value} (${f.category})`).join("\n")
          : `Tidak ada fakta tersimpan untuk "${args.query}".`;
      }
      case "forget":
        await deleteFacts(context.userId, args.entity, args.attribute || null, context.pool);
        return `Fakta "${args.entity}"${args.attribute ? ` (${args.attribute})` : ""} dihapus.`;
      default: {
        const targetResult = await executeTargetTool(name, args, context);
        if (targetResult !== null) return targetResult;
        const extraMoneyResult = await executeMoneyExtraTool(name, args, context);
        if (extraMoneyResult !== null) return extraMoneyResult;
        const wsResult = await executeWorkspaceTool(name, args, context);
        if (wsResult !== null) return wsResult;
        const calResult = await executeCalendarTool(name, args, context);
        if (calResult !== null) return calResult;
        const researchResult = await executeResearchTool(name, args);
        if (researchResult !== null) return researchResult;
        const infoResult = await executeInfoTool(name, args);
        if (infoResult !== null) return infoResult;
        return `Unknown tool: ${name}`;
      }
    }
  } catch (err) {
    return `Error: ${redactSecrets(err.message)}`;
  }
}
