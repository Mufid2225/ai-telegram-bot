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
  assert.ok(names.includes("target"));
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
    for (const cb of ["menu:money", "menu:ws:trello", "menu:ws:notion", "menu:ws:superhuman", "menu:ws:kb", "menu:ws:calendar"]) {
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

test("handleMenuCallback opens MoneyTracker hub and switches across income, targets, targetlogs, usage, and surplus sheets", async () => {
  const fakeSheets = {
    getSummary: async ({ month, year }) => ({
      month,
      year,
      totalIncome: 1500000,
      totalRealisasi: 1000000,
      saldo: 500000,
    }),
    getIncomeOverview: async () => ({
      month: "November",
      year: 2026,
      incomeSources: [{ source: "Gaji", amount: 5000000 }],
      totalIncome: 5000000,
      allocations: [{ kategori: "Makan", percent: 30, monthlyAmount: 1500000 }],
      totalPercent: 30,
    }),
    listTargets: async () => ({
      targets: [
        {
          id: "TGT-001",
          name: "Monitor 27",
          targetAmount: 3000000,
          collectedAmount: 1500000,
          remainingAmount: 1500000,
          progressPercent: 50,
          status: "Aktif",
          note: "",
        },
      ],
    }),
    listTargetLogs: async ({ sourcePeriod } = {}) => ({
      logs: [
        {
          logId: "LOG-001",
          date: "2026-11-05",
          targetId: "TGT-001",
          targetName: "Monitor 27",
          amount: 200000,
          note: "Sisa uang bulan Oktober",
          sourcePeriod: "2026-10",
        },
      ],
      totalMatchedAmount: sourcePeriod ? 200000 : 200000,
    }),
    getUsage: async () => ({
      sheetName: "Usage",
      rows: [["Dompet", "Sisa"], ["Seabank", "Rp 500.000"]],
      truncatedRows: false,
      truncatedCols: false,
    }),
  };

  const hubCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: hubCtx, action: "money", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {} });
  assert.match(hubCtx._edits[0].txt, /MoneyTracker Hub/);
  const hubCbs = hubCtx._edits[0].extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  for (const cb of ["menu:summary", "menu:expenses:0", "menu:income", "menu:targets", "menu:targetlogs", "menu:usage", "menu:surplus", "menu:home"]) {
    assert.ok(hubCbs.includes(cb), `missing ${cb}`);
  }

  for (const [action, pattern] of [
    ["income", /Overview Tab Income/],
    ["targets", /Monitor 27/],
    ["targetlogs", /LOG-001/],
    ["usage", /Seabank \| Rp 500\.000/],
    ["surplus", /Sisa Bebas Belum Dialokasikan: Rp 300\.000/],
  ]) {
    const viewCtx = makeCtx("123456789");
    await handleMenuCallback({
      ctx: viewCtx,
      action,
      allowedUserId: "123456789",
      pool: {},
      sheetsService: fakeSheets,
      reminderStore: {},
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.match(viewCtx._edits.at(-1).txt, pattern);
    const viewCbs = viewCtx._edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(viewCbs.includes("menu:money"), `missing menu:money on ${action}`);
    assert.ok(viewCbs.includes("menu:home"), `missing menu:home on ${action}`);
  }

  const pickCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: pickCtx, action: "usage:pick", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {} });
  assert.match(pickCtx._edits[0].txt, /Pilih Bulan Usage/);
  const pickCbs = pickCtx._edits[0].extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(pickCbs.includes("menu:usage:November"));
  assert.ok(pickCbs.includes("menu:usage:year"));
  assert.ok(pickCbs.every((cb) => Buffer.byteLength(cb, "utf8") <= 64));

  let requestedMonth;
  fakeSheets.getUsage = async (opts = {}) => {
    requestedMonth = opts.month;
    return {
      sheetName: "Usage",
      structured: true,
      title: "Penggunaan Tahun 2026",
      month: opts.month || "November",
      items: [{ kategori: "Transportasi", percent: 0, amount: 120000 }],
      total: 120000,
      monthlyTotals: [
        { month: "Januari", total: 0 },
        { month: "November", total: 120000 },
      ],
      yearTotal: 120000,
    };
  };

  const novCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: novCtx, action: "usage:November", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {}, stepMs: 0, finishDelayMs: 0 });
  assert.equal(requestedMonth, "November");
  assert.match(novCtx._edits.at(-1).txt, /Transportasi: Rp 120\.000/);
  const novCbs = novCtx._edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(novCbs.includes("menu:usage:pick"));
  assert.ok(novCbs.includes("menu:usage:year"));

  const yearCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: yearCtx, action: "usage:year", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {}, stepMs: 0, finishDelayMs: 0 });
  assert.match(yearCtx._edits.at(-1).txt, /Rekap Usage/);
  assert.match(yearCtx._edits.at(-1).txt, /November: Rp 120\.000/);

  const incPickCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: incPickCtx, action: "income:pick", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {} });
  assert.match(incPickCtx._edits[0].txt, /Pilih Bulan Income/);
  const incPickCbs = incPickCtx._edits[0].extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(incPickCbs.includes("menu:income:Oktober"));
  assert.ok(incPickCbs.every((cb) => Buffer.byteLength(cb, "utf8") <= 64));

  let requestedIncomeMonth;
  fakeSheets.getIncomeOverview = async (opts = {}) => {
    requestedIncomeMonth = opts.month;
    return {
      month: opts.month || "November",
      year: 2026,
      incomeSources: [{ source: "Gaji Bulanan", amount: 300000 }],
      totalIncome: 300000,
      allocations: [{ kategori: "Transportasi", percent: 50, monthlyAmount: 150000 }],
      totalPercent: 50,
    };
  };

  const octIncCtx = makeCtx("123456789");
  await handleMenuCallback({ ctx: octIncCtx, action: "income:Oktober", allowedUserId: "123456789", pool: {}, sheetsService: fakeSheets, reminderStore: {}, stepMs: 0, finishDelayMs: 0 });
  assert.equal(requestedIncomeMonth, "Oktober");
  assert.match(octIncCtx._edits.at(-1).txt, /Oktober 2026/);
  const octCbs = octIncCtx._edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(octCbs.includes("menu:income:pick"));
  assert.ok(octCbs.includes("menu:income:Oktober"));
});
