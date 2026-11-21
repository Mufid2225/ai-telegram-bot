import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createPendingActionsStore } from "../src/services/money.js";
import { createReminderStore } from "../src/services/reminder.js";
import { tools, executeTool } from "../src/tools.js";

test("tools include MoneyTracker, notes, reminders, and memory functions", () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "money_get_summary",
    "money_list_expenses",
    "money_propose_add_expenses",
    "money_propose_update_expense",
    "money_propose_delete_expense",
    "money_propose_upsert_income",
    "save_note",
    "list_notes",
    "delete_note",
    "save_reminder",
    "list_reminders",
    "delete_reminder",
    "remember",
    "recall",
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`);
  }
});

test("executeTool validates options and creates SQLite pendingAction without writing to sheets", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    const reminderStore = createReminderStore(db);
    let writeCalled = false;
    const fakeSheets = {
      getContext: async () => ({
        banks: ["Seabank", "Cash"],
        categories: ["Transportasi", "Jajan"],
        incomeSources: ["Gaji Bulanan"],
      }),
      addExpenses: async () => {
        writeCalled = true;
        return {};
      },
    };

    const ctx = { userId: "123456789", pool: db, sheetsService: fakeSheets, pendingStore, reminderStore };

    const bad = await executeTool(
      "money_propose_add_expenses",
      { items: [{ uraian: "Bensin", nilai: 25000, kategori: "Salah", bank: "Cash" }] },
      ctx
    );
    assert.match(bad, /Kategori tidak valid/);
    assert.equal(ctx.pendingAction, undefined);

    const ok = await executeTool(
      "money_propose_add_expenses",
      { items: [{ uraian: "Bensin", nilai: 25000, kategori: "transportasi", bank: "cash" }] },
      ctx
    );
    assert.equal(writeCalled, false);
    assert.ok(ctx.pendingAction?.id);
    assert.match(ok, /Bensin/);

    const saved = await pendingStore.getById(ctx.pendingAction.id, "123456789");
    assert.equal(saved.status, "pending");
    assert.equal(saved.payload.items[0].kategori, "Transportasi");
  } finally {
    db.end();
  }
});

test("executeTool persists notes, reminders, and knowledge in SQLite", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const reminderStore = createReminderStore(db);
    const ctx = { userId: "123456789", pool: db, reminderStore };

    const noteRes = await executeTool("save_note", { content: "Servis motor minggu depan", type: "catatan" }, ctx);
    assert.match(noteRes, /Tersimpan/);
    const notesRes = await executeTool("list_notes", {}, ctx);
    assert.match(notesRes, /Servis motor minggu depan/);

    const remRes = await executeTool("save_reminder", { message: "Sisihin tabungan", dueAt: "2026-11-18T08:00:00+07:00" }, ctx);
    assert.match(remRes, /Reminder tersimpan/);
    const remsRes = await executeTool("list_reminders", {}, ctx);
    assert.match(remsRes, /Sisihin tabungan/);

    await executeTool("remember", { entity: "budget", attribute: "transport_mingguan", value: "50000" }, ctx);
    const recalled = await executeTool("recall", { query: "transport" }, ctx);
    assert.match(recalled, /50000/);
  } finally {
    db.end();
  }
});

test("workspace tools register, disambiguate duplicate lists/cards, and create pendingAction without mutating", async () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "trello_list_boards",
    "trello_search_cards",
    "trello_propose_move_card",
    "notion_list_sources",
    "notion_propose_create_page",
    "superhuman_list_docs",
    "superhuman_propose_add_row",
    "kb_search",
    "kb_read_note",
  ]) {
    assert.ok(names.has(required), `missing workspace tool ${required}`);
  }

  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    let movedCalled = false;
    const trelloService = {
      listBoards: async () => [{ id: "b1", name: "Development Tracker" }],
      getBoardLists: async () => [
        { id: "l1", name: "To Do", duplicate: false },
        { id: "l2", name: "FIX", duplicate: true },
        { id: "l3", name: "FIX", duplicate: true },
        { id: "l4", name: "In Progress", duplicate: false },
      ],
      searchCards: async (_b, q) =>
        q.includes("login")
          ? [{ id: "c1", name: "Bug Login Page", idList: "l1", listName: "To Do" }]
          : [
              { id: "c2", name: "Auth Error 1", idList: "l1", listName: "To Do" },
              { id: "c3", name: "Auth Error 2", idList: "l4", listName: "In Progress" },
            ],
      moveCard: async () => { movedCalled = true; },
    };

    const ctx = { userId: "123", pool: db, pendingStore, trelloService };

    const dupListMsg = await executeTool(
      "trello_propose_move_card",
      { boardName: "Development Tracker", cardQuery: "login", targetListName: "FIX" },
      ctx
    );
    assert.match(dupListMsg, /lebih dari satu list|FIX/i);
    assert.equal(ctx.pendingAction, undefined);

    const multiCardMsg = await executeTool(
      "trello_propose_move_card",
      { boardName: "Development Tracker", cardQuery: "auth error", targetListName: "In Progress" },
      ctx
    );
    assert.match(multiCardMsg, /Ditemukan lebih dari 1 card/i);
    assert.equal(ctx.pendingAction, undefined);

    const okDraft = await executeTool(
      "trello_propose_move_card",
      { boardName: "Development Tracker", cardQuery: "login", targetListName: "In Progress" },
      ctx
    );
    assert.match(okDraft, /Draft/);
    assert.equal(movedCalled, false);
    assert.equal(ctx.pendingAction?.kind, "trello_move_card");
  } finally {
    db.end();
  }
});

test("target tools register, calculate surplus, disambiguate targets, and create pendingAction without mutating", async () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "money_list_targets",
    "money_list_target_logs",
    "money_check_surplus",
    "money_propose_create_target",
    "money_propose_add_target_deposit",
    "money_propose_update_target",
    "money_propose_delete_target_log",
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`);
  }

  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    let mutated = false;
    const fakeTargets = [
      { rowNumber: 2, id: "TGT-001", name: "Monitor 27", targetAmount: 3000000, collectedAmount: 1000000, remainingAmount: 2000000, progressPercent: 33.3, status: "Aktif", note: "" },
      { rowNumber: 3, id: "TGT-002", name: "Monitor Kantor", targetAmount: 2000000, collectedAmount: 500000, remainingAmount: 1500000, progressPercent: 25, status: "Aktif", note: "" },
    ];
    const fakeLogs = [
      { rowNumber: 2, logId: "LOG-001", date: "2026-11-02", targetId: "TGT-001", targetName: "Monitor 27", amount: 200000, note: "Sisa uang bulan Oktober", sourcePeriod: "2026-10" },
    ];
    const fakeSheets = {
      listTargets: async () => ({ targets: fakeTargets }),
      listTargetLogs: async ({ sourcePeriod } = {}) => {
        const matched = sourcePeriod ? fakeLogs.filter((l) => l.sourcePeriod === sourcePeriod) : fakeLogs;
        return { logs: matched, totalMatchedAmount: matched.reduce((s, l) => s + l.amount, 0) };
      },
      getSummary: async ({ month, year }) => ({
        month,
        year,
        totalIncome: 1500000,
        totalRealisasi: 1000000,
        saldo: 500000,
      }),
      createTarget: async () => { mutated = true; return {}; },
      addTargetDeposit: async () => { mutated = true; return {}; },
      updateTarget: async () => { mutated = true; return {}; },
      deleteTargetLog: async () => { mutated = true; return {}; },
    };

    const ctx = { userId: "123456789", pool: db, sheetsService: fakeSheets, pendingStore };

    const surplusOut = await executeTool("money_check_surplus", { month: "Oktober", year: 2026 }, ctx);
    assert.match(surplusOut, /Rp 500\.000/);
    assert.match(surplusOut, /Rp 200\.000/);
    assert.match(surplusOut, /Rp 300\.000/);

    const ambig = await executeTool("money_propose_add_target_deposit", { targetName: "Monitor", amount: 100000 }, ctx);
    assert.match(ambig, /Monitor 27/);
    assert.match(ambig, /Monitor Kantor/);
    assert.equal(ctx.pendingAction, undefined);

    const overWarn = await executeTool(
      "money_propose_add_target_deposit",
      { targetName: "Monitor 27", amount: 400000, sourcePeriod: "2026-10", note: "Sisa uang bulan Oktober" },
      ctx
    );
    assert.match(overWarn, /melebihi/i);
    assert.equal(ctx.pendingAction.kind, "add_target_deposit");
    assert.equal(ctx.pendingAction.payload.targetId, "TGT-001");

    const dupCreate = await executeTool("money_propose_create_target", { name: "monitor 27", targetAmount: 1000000 }, ctx);
    assert.match(dupCreate, /sudah ada/i);

    const okCreate = await executeTool("money_propose_create_target", { name: "SSD NVMe", targetAmount: 1500000, note: "1TB" }, ctx);
    assert.match(okCreate, /SSD NVMe/);
    assert.equal(ctx.pendingAction.kind, "create_target");

    const okUpdate = await executeTool("money_propose_update_target", { targetId: "TGT-002", patch: { status: "Ditunda" } }, ctx);
    assert.match(okUpdate, /Ditunda/);
    assert.equal(ctx.pendingAction.kind, "update_target");
    assert.equal(ctx.pendingAction.payload.expected.name, "Monitor Kantor");

    const okDeleteLog = await executeTool("money_propose_delete_target_log", { logId: "LOG-001" }, ctx);
    assert.match(okDeleteLog, /LOG-001/);
    assert.equal(ctx.pendingAction.kind, "delete_target_log");
    assert.equal(ctx.pendingAction.payload.rowNumber, 2);
    assert.equal(mutated, false);
  } finally {
    db.end();
  }
});

test("moneyExtra tools read income overview & usage, validate percentages, and draft allocation updates without mutating", async () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "money_get_income_overview",
    "money_propose_update_allocations",
    "money_get_usage",
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`);
  }

  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    let mutated = false;
    const fakeSheets = {
      getIncomeOverview: async () => ({
        month: "November",
        year: 2026,
        incomeSources: [{ rowNumber: 3, source: "Gaji", amount: 5000000 }],
        totalIncome: 5000000,
        allocations: [
          { rowNumber: 12, kategori: "Makan", percent: 40, monthlyAmount: 2000000 },
          { rowNumber: 13, kategori: "Tabungan", percent: 40, monthlyAmount: 2000000 },
          { rowNumber: 14, kategori: "Jajan", percent: 20, monthlyAmount: 1000000 },
        ],
        totalPercent: 100,
      }),
      getUsage: async () => ({
        sheetName: "Usage",
        rows: [["Dompet", "Sisa"], ["Seabank", "Rp 500.000"]],
        truncatedRows: false,
        truncatedCols: false,
      }),
      updateAllocations: async () => {
        mutated = true;
        return {};
      },
    };

    const ctx = { userId: "123456789", pool: db, sheetsService: fakeSheets, pendingStore };

    const overviewOut = await executeTool("money_get_income_overview", { month: "November", year: 2026 }, ctx);
    assert.match(overviewOut, /Gaji: Rp 5\.000\.000/);
    assert.match(overviewOut, /Makan: 40%/);

    const usageOut = await executeTool("money_get_usage", {}, ctx);
    assert.match(usageOut, /Seabank \| Rp 500\.000/);

    let receivedUsageArgs;
    fakeSheets.getUsage = async (args) => {
      receivedUsageArgs = args;
      return {
        sheetName: "Usage",
        structured: true,
        title: "Penggunaan Tahun 2026",
        month: args.month || "November",
        items: [{ kategori: "Transportasi", percent: 0, amount: 120000 }],
        total: 120000,
        monthlyTotals: [{ month: "November", total: 120000 }],
        yearTotal: 120000,
      };
    };
    const usageYearOut = await executeTool("money_get_usage", { month: "nov", view: "year" }, ctx);
    assert.equal(receivedUsageArgs.month, "November");
    assert.match(usageYearOut, /Rekap Usage/);

    const badPct = await executeTool("money_propose_update_allocations", { updates: [{ kategori: "Makan", percent: 120 }] }, ctx);
    assert.match(badPct, /0 sampai 100/);
    assert.equal(ctx.pendingAction, undefined);

    const missingCat = await executeTool("money_propose_update_allocations", { updates: [{ kategori: "Hiburan", percent: 10 }] }, ctx);
    assert.match(missingCat, /tidak ditemukan/i);
    assert.equal(ctx.pendingAction, undefined);

    const okWarn = await executeTool(
      "money_propose_update_allocations",
      { updates: [{ kategori: "makan", percent: 35 }, { kategori: "Tabungan", percent: 50 }] },
      ctx
    );
    assert.match(okWarn, /Makan: 40% → 35%/);
    assert.match(okWarn, /Total Alokasi Baru: 105%/);
    assert.match(okWarn, /belum 100%/i);
    assert.equal(ctx.pendingAction.kind, "update_allocations");
    assert.equal(ctx.pendingAction.payload.updates[0].kategori, "Makan");
    assert.equal(ctx.pendingAction.payload.updates[0].expectedPercent, 40);
    assert.equal(mutated, false);
  } finally {
    db.end();
  }
});
