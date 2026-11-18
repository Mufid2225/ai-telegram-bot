import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createRepository } from "../src/repository.js";
import { registerMessageHandlers } from "../src/handlers/messages.js";

test("plain text chat replies directly without sending Loading percentage bars", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    let textHandler = null;
    const fakeBot = {
      on: (event, fn) => {
        if (event === "text") textHandler = fn;
      },
    };
    const repository = createRepository(db);
    registerMessageHandlers(fakeBot, {
      pool: db,
      repository,
      callAI: async () => "Hai! Mau dibantu apa hari ini?",
      dateStr: "18 November 2026",
    });

    const replies = [];
    const edits = [];
    const actions = [];
    const ctx = {
      from: { id: "123" },
      chat: { id: "123" },
      message: { text: "hi" },
      telegram: {
        sendChatAction: async (_id, act) => actions.push(act),
        editMessageText: async (...args) => edits.push(args),
      },
      reply: async (text, extra) => replies.push({ text, extra }),
    };

    await textHandler(ctx);
    assert.ok(actions.includes("typing"));
    assert.equal(edits.length, 0);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, "Hai! Mau dibantu apa hari ini?");
  } finally {
    db.end();
  }
});
