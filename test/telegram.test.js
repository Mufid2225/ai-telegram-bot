import test from "node:test";
import assert from "node:assert/strict";
import { splitTelegramText, truncateCaption, formatLoadingBar, runWithProgress, buildConfirmExtra } from "../src/utils/telegram.js";

test("buildConfirmExtra preserves money: prefix for finance drafts and uses action: prefix for workspace drafts", () => {
  const moneyKb = buildConfirmExtra({ id: "abc123", kind: "add_expenses" }).reply_markup.inline_keyboard[0];
  assert.equal(moneyKb[0].callback_data, "money:confirm:abc123");
  assert.equal(moneyKb[1].callback_data, "money:cancel:abc123");

  const wsKb = buildConfirmExtra({ id: "def456", kind: "trello_move_card" }).reply_markup.inline_keyboard[0];
  assert.equal(wsKb[0].callback_data, "action:confirm:def456");
  assert.equal(wsKb[1].callback_data, "action:cancel:def456");
});

test("chunks replies within Telegram limit", () => {
  const chunks = splitTelegramText("word ".repeat(2000));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), "word ".repeat(2000).trim());
});

test("caps captions", () => assert.equal(truncateCaption("x".repeat(2000)).length, 1024));

test("formatLoadingBar renders 0%, 25%, 50%, 75%, 100% bars", () => {
  assert.equal(formatLoadingBar(0), "Loading ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 0%");
  assert.equal(formatLoadingBar(25), "Loading █████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 25%");
  assert.equal(formatLoadingBar(50), "Loading ██████████▒▒▒▒▒▒▒▒▒▒ 50%");
  assert.equal(formatLoadingBar(75), "Loading ███████████████▒▒▒▒▒ 75%");
  assert.equal(formatLoadingBar(100), "Loading ████████████████████ 100%");
});

test("runWithProgress animates 0->25->50->75->100 and delivers final text in reply mode", async () => {
  const replies = [];
  const edits = [];
  const ctx = {
    chat: { id: 10 },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { chat: { id: 10 }, message_id: 99 };
    },
    telegram: {
      editMessageText: async (chatId, msgId, _inlineId, text, extra) => {
        edits.push({ chatId, msgId, text, extra });
      },
    },
  };

  const result = await runWithProgress({
    ctx,
    mode: "reply",
    stepMs: 0,
    finishDelayMs: 0,
    task: async () => "Hasil selesai",
    formatResult: (val) => ({ text: val }),
  });

  assert.equal(result, "Hasil selesai");
  assert.equal(replies[0].text, "Loading ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 0%");
  assert.deepEqual(
    edits.map((e) => e.text),
    [
      "Loading █████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 25%",
      "Loading ██████████▒▒▒▒▒▒▒▒▒▒ 50%",
      "Loading ███████████████▒▒▒▒▒ 75%",
      "Loading ████████████████████ 100%",
      "Hasil selesai",
    ]
  );
});

test("runWithProgress replaces loading bar on error in edit mode", async () => {
  const edits = [];
  const ctx = {
    editMessageText: async (text, extra) => edits.push({ text, extra }),
  };

  await runWithProgress({
    ctx,
    mode: "edit",
    stepMs: 0,
    finishDelayMs: 0,
    task: async () => { throw new Error("Koneksi gagal"); },
    formatError: (err) => ({ text: `Error: ${err.message}` }),
  });

  assert.equal(edits[0].text, "Loading ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 0%");
  assert.equal(edits.at(-1).text, "Error: Koneksi gagal");
});
