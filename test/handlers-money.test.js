import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createPendingActionsStore } from "../src/services/money.js";
import { handleMoneyCallback, sendFinanceChart, handleTargetCommand } from "../src/handlers/money.js";

function makeCallbackCtx(userId, messageText = "Draft Catat") {
  const answers = [];
  const edits = [];
  return {
    from: { id: userId },
    callbackQuery: { message: { text: messageText } },
    answerCbQuery: async (txt) => answers.push(txt),
    editMessageText: async (txt, extra) => edits.push({ txt, extra }),
    _answers: answers,
    _edits: edits,
  };
}

test("handleMoneyCallback blocks unauthorized users", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    const ctx = makeCallbackCtx("999");
    await handleMoneyCallback({
      ctx,
      actionType: "confirm",
      actionId: "abcd1234",
      allowedUserId: "123456789",
      pendingStore,
      sheetsService: {},
    });
    assert.match(ctx._answers[0], /Akses ditolak/);
    assert.equal(ctx._edits.length, 0);
  } finally {
    db.end();
  }
});

test("handleMoneyCallback confirms once, writes to sheets, and rejects second click", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    const draft = await pendingStore.create({
      userId: "123456789",
      kind: "add_expenses",
      payload: { items: [{ date: "2026-11-17", transaksi: "Cash", uraian: "Bensin", kategori: "Transportasi", bank: "Cash", nilai: 25000 }] },
      summaryText: "Bensin Rp 25.000",
    });

    let writeCount = 0;
    const fakeSheets = {
      addExpenses: async () => {
        writeCount++;
        return { addedRows: [19] };
      },
    };

    const ctx1 = makeCallbackCtx("123456789");
    await handleMoneyCallback({
      ctx: ctx1,
      actionType: "confirm",
      actionId: draft.id,
      allowedUserId: "123456789",
      pendingStore,
      sheetsService: fakeSheets,
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.equal(writeCount, 1);
    assert.equal(ctx1._edits[0].txt, "Loading ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 0%");
    assert.match(ctx1._edits.at(-1).txt, /Tersimpan ke Google Sheets/);
    assert.equal((await pendingStore.getById(draft.id, "123456789")).status, "confirmed");

    const ctx2 = makeCallbackCtx("123456789");
    await handleMoneyCallback({
      ctx: ctx2,
      actionType: "confirm",
      actionId: draft.id,
      allowedUserId: "123456789",
      pendingStore,
      sheetsService: fakeSheets,
    });
    assert.equal(writeCount, 1);
    assert.match(ctx2._answers[0], /sudah/i);
  } finally {
    db.end();
  }
});

test("handleMoneyCallback restores pending status on transient sheets error and handles cancel", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    const draft = await pendingStore.create({
      userId: "123456789",
      kind: "add_expenses",
      payload: { items: [{ date: "2026-11-17", transaksi: "Cash", uraian: "Kopi", kategori: "Jajan", bank: "Cash", nilai: 15000 }] },
      summaryText: "Kopi Rp 15.000",
    });

    const failCtx = makeCallbackCtx("123456789");
    await handleMoneyCallback({
      ctx: failCtx,
      actionType: "confirm",
      actionId: draft.id,
      allowedUserId: "123456789",
      pendingStore,
      sheetsService: { addExpenses: async () => { throw new Error("Timeout"); } },
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.match(failCtx._edits.at(-1).txt, /Gagal menyimpan: Timeout/);
    assert.equal((await pendingStore.getById(draft.id, "123456789")).status, "pending");

    const cancelCtx = makeCallbackCtx("123456789", "Draft Kopi");
    await handleMoneyCallback({
      ctx: cancelCtx,
      actionType: "cancel",
      actionId: draft.id,
      allowedUserId: "123456789",
      pendingStore,
      sheetsService: {},
    });
    assert.match(cancelCtx._edits[0].txt, /Dibatalkan/);
    assert.equal((await pendingStore.getById(draft.id, "123456789")).status, "cancelled");
  } finally {
    db.end();
  }
});

test("sendFinanceChart retries once on transient upload failure and degrades gracefully", async () => {
  const buf = Buffer.from("png");
  let attempts = 0;
  const retryCtx = {
    chat: { id: 1 },
    telegram: { sendChatAction: async () => {} },
    replyWithPhoto: async (file, opts) => {
      attempts++;
      assert.equal(file.filename, "moneytracker.png");
      assert.equal(opts.caption, "MoneyTracker — November 2026");
      if (attempts === 1) throw new Error("socket hang up");
    },
  };
  assert.equal(await sendFinanceChart(retryCtx, buf, "MoneyTracker — November 2026"), true);
  assert.equal(attempts, 2);

  const failCtx = {
    chat: { id: 1 },
    telegram: { sendChatAction: async () => {} },
    replyWithPhoto: async () => { throw new Error("ECONNRESET"); },
  };
  assert.equal(await sendFinanceChart(failCtx, buf, "MoneyTracker — November 2026"), false);
});

test("handleTargetCommand displays formatted targets when called without args and delegates to callAI with args", async () => {
  const replies = [];
  const makeMsgCtx = (text) => ({
    from: { id: "123456789" },
    chat: { id: "123456789" },
    message: { text },
    telegram: { sendChatAction: async () => {} },
    reply: async (msg, extra) => replies.push({ msg, extra }),
  });

  await handleTargetCommand({
    ctx: makeMsgCtx("/target"),
    sheetsService: {
      listTargets: async () => ({
        targets: [
          {
            id: "TGT-001",
            name: "SSD NVMe",
            targetAmount: 1500000,
            collectedAmount: 750000,
            remainingAmount: 750000,
            progressPercent: 50,
            status: "Aktif",
            note: "",
          },
        ],
      }),
    },
  });
  assert.match(replies[0].msg, /SSD NVMe/);
  assert.match(replies[0].msg, /\[█████░░░░░\] 50%/);

  let aiOpts;
  await handleTargetCommand({
    ctx: makeMsgCtx("/target nabung ssd 250rb"),
    callAI: async (_msgs, _ctx, opts) => {
      aiOpts = opts;
      opts.toolContext.pendingAction = { id: "abcd1234", kind: "add_target_deposit" };
      return "Draft setoran dibuat.";
    },
    pool: {},
    sheetsService: {},
    pendingStore: {},
    reminderStore: {},
    dateStr: "Sabtu, 21 November 2026",
  });
  assert.ok(aiOpts.tools.some((t) => t.function.name === "money_propose_add_target_deposit"));
  assert.equal(replies[1].msg, "Draft setoran dibuat.");
  assert.equal(replies[1].extra.reply_markup.inline_keyboard[0][0].callback_data, "money:confirm:abcd1234");
});
