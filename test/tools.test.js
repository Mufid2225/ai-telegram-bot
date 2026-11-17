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
