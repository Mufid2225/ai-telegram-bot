import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createReminderStore } from "../src/services/reminder.js";
import { BOT_COMMANDS, handleMenuCallback } from "../src/handlers/menu.js";

function makeCtx(userId) {
  const answers = [];
  const edits = [];
  const photos = [];
  return {
    from: { id: userId },
    chat: { id: userId },
    telegram: { sendChatAction: async () => {} },
    answerCbQuery: async (txt) => answers.push(txt ?? ""),
    editMessageText: async (txt, extra) => edits.push({ txt, extra }),
    replyWithPhoto: async (file, opts) => photos.push({ file, opts }),
    _answers: answers,
    _edits: edits,
    _photos: photos,
  };
}

test("BOT_COMMANDS contains clean Nerissa commands without legacy commands", () => {
  const names = BOT_COMMANDS.map((c) => c.command);
  assert.ok(names.includes("menu"));
  assert.ok(names.includes("keuangan"));
  assert.ok(names.includes("catat"));
  for (const legacy of ["whoami", "phone", "pair", "weather", "tools", "skill"]) {
    assert.equal(names.includes(legacy), false, `unexpected legacy command ${legacy}`);
  }
});

test("handleMenuCallback blocks unauthorized users", async () => {
  const ctx = makeCtx("999");
  await handleMenuCallback({
    ctx,
    action: "home",
    allowedUserId: "123456789",
    pool: {},
    sheetsService: {},
    reminderStore: {},
  });
  assert.match(ctx._answers[0], /Akses ditolak/);
  assert.equal(ctx._edits.length, 0);
});

test("handleMenuCallback switches pages in-place for summary, expenses pagination, notes, reminders, and close", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const reminderStore = createReminderStore(db);
    await db.query(
      "INSERT INTO memories (user_id, type, content, created_at) VALUES ($1, $2, $3, $4)",
      ["123456789", "catatan", "Servis motor", new Date().toISOString()]
    );
    await reminderStore.create({
      userId: "123456789",
      message: "Transfer tabungan",
      dueAt: "2026-11-18T08:00:00+07:00",
    });

    const items = Array.from({ length: 10 }, (_, i) => ({
      rowNumber: i + 2,
      date: "2026-11-17",
      month: "November",
      transaksi: "Cash",
      uraian: `Item ${i + 1}`,
      kategori: "Jajan",
      bank: "Cash",
      nilai: 1000 * (i + 1),
    }));

    const fakeSheets = {
      getSummary: async () => ({
        month: "November",
        year: 2026,
        totalIncome: 300000,
        totalAlokasi: 300000,
        totalRealisasi: 55000,
        saldo: 245000,
        percentUsed: 18.33,
        categories: [{ kategori: "Jajan", alokasi: 15000, realisasi: 55000, progressPercent: 366.67, overbudget: true }],
      }),
      listExpenses: async () => items,
    };

    const sumCtx = makeCtx("123456789");
    await handleMenuCallback({ ctx: sumCtx, action: "summary", allowedUserId: "123456789", pool: db, sheetsService: fakeSheets, reminderStore, stepMs: 0, finishDelayMs: 0 });
    assert.equal(sumCtx._edits[0].txt, "Loading ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 0%");
    assert.equal(sumCtx._edits[4].txt, "Loading ████████████████████ 100%");
    assert.match(sumCtx._edits.at(-1).txt, /Ringkasan MoneyTracker/);
    const flatCallbacks = sumCtx._edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(flatCallbacks.includes("menu:home"));
    assert.ok(flatCallbacks.includes("menu:chart"));

    const expCtx = makeCtx("123456789");
    await handleMenuCallback({ ctx: expCtx, action: "expenses:8", allowedUserId: "123456789", pool: db, sheetsService: fakeSheets, reminderStore, stepMs: 0, finishDelayMs: 0 });
    assert.match(expCtx._edits.at(-1).txt, /Item 9/);
    assert.match(expCtx._edits.at(-1).txt, /Hal 2\/2/);
    const expCallbacks = expCtx._edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(expCallbacks.includes("menu:expenses:0"));

    const notesCtx = makeCtx("123456789");
    await handleMenuCallback({ ctx: notesCtx, action: "notes", allowedUserId: "123456789", pool: db, sheetsService: fakeSheets, reminderStore, stepMs: 0, finishDelayMs: 0 });
    assert.match(notesCtx._edits.at(-1).txt, /Servis motor/);

    const remCtx = makeCtx("123456789");
    await handleMenuCallback({ ctx: remCtx, action: "reminders", allowedUserId: "123456789", pool: db, sheetsService: fakeSheets, reminderStore, stepMs: 0, finishDelayMs: 0 });
    assert.match(remCtx._edits.at(-1).txt, /Transfer tabungan/);

    const closeCtx = makeCtx("123456789");
    await handleMenuCallback({ ctx: closeCtx, action: "close", allowedUserId: "123456789", pool: db, sheetsService: fakeSheets, reminderStore, stepMs: 0, finishDelayMs: 0 });
    assert.match(closeCtx._edits.at(-1).txt, /Menu ditutup/);
  } finally {
    db.end();
  }
});

test("handleMenuCallback ignores Telegram 'message is not modified' on refresh", async () => {
  const ctx = makeCtx("123456789");
  ctx.editMessageText = async () => {
    throw new Error("400: Bad Request: message is not modified");
  };
  await handleMenuCallback({
    ctx,
    action: "home",
    allowedUserId: "123456789",
    pool: {},
    sheetsService: {},
    reminderStore: {},
  });
    assert.equal(ctx._answers[0], "");
});

test("handleMenuCallback exposes live dashboard info and workspace buttons on home and dispatches ws:trello", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const reminderStore = createReminderStore(db);
    await db.query(
      "INSERT INTO memories (user_id, type, content, created_at) VALUES ($1, $2, $3, $4)",
      ["123456789", "catatan", "Cek oli", new Date().toISOString()]
    );
    await reminderStore.create({
      userId: "123456789",
      message: "Bayar listrik",
      dueAt: "2026-11-20T09:00:00+07:00",
    });

    const homeCtx = makeCtx("123456789");
    await handleMenuCallback({
      ctx: homeCtx,
      action: "home",
      allowedUserId: "123456789",
      pool: db,
      sheetsService: { isConfigured: () => true },
      calendarService: { isConfigured: () => true },
      trelloService: { isConfigured: () => true },
      reminderStore,
    });
    assert.match(homeCtx._edits[0].txt, /Nerissa Personal Hub/);
    assert.match(homeCtx._edits[0].txt, /Catatan & Tugas: 1/);
    assert.match(homeCtx._edits[0].txt, /Reminder Aktif: 1/);
    assert.match(homeCtx._edits[0].txt, /Sheets • Calendar • Trello/);
    const homeCallbacks = homeCtx._edits[0].extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    for (const cb of ["menu:ws:trello", "menu:ws:notion", "menu:ws:superhuman", "menu:ws:kb", "menu:ws:calendar"]) {
      assert.ok(homeCallbacks.includes(cb), `missing ${cb}`);
    }

    const wsCtx = makeCtx("123456789");
    await handleMenuCallback({
      ctx: wsCtx,
      action: "ws:trello",
      allowedUserId: "123456789",
      pool: db,
      sheetsService: {},
      reminderStore: {},
      trelloService: { listBoards: async () => [{ id: "b1", name: "Dev Tracker", closed: false }] },
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.match(wsCtx._edits.at(-1).txt, /Pilih Board Trello/);
  } finally {
    db.end();
  }
});
