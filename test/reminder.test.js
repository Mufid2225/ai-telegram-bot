import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createReminderStore, processDueReminders } from "../src/services/reminder.js";

test("reminderStore persists reminders across DB handles and avoids duplicate sends", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const store = createReminderStore(db);
    const r1 = await store.create({
      userId: "123456789",
      message: "Sisihin tabungan 15rb",
      dueAt: "2026-11-17T10:00:00.000Z",
    });
    const r2 = await store.create({
      userId: "123456789",
      message: "Bayar kuota",
      dueAt: "2026-11-20T10:00:00.000Z",
    });

    const pending = await store.listPending("123456789");
    assert.equal(pending.length, 2);
    assert.equal(pending[0].id, r1.id);

    const sent = [];
    const count = await processDueReminders(
      store,
      async (userId, text) => { sent.push({ userId, text }); },
      new Date("2026-11-17T11:00:00.000Z")
    );
    assert.equal(count, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Sisihin tabungan 15rb/);

    const count2 = await processDueReminders(
      store,
      async (userId, text) => { sent.push({ userId, text }); },
      new Date("2026-11-17T11:05:00.000Z")
    );
    assert.equal(count2, 0);
    assert.equal(sent.length, 1);

    const remaining = await store.listPending("123456789");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, r2.id);

    assert.equal(await store.remove(r2.id, "123456789"), true);
    assert.equal((await store.listPending("123456789")).length, 0);
  } finally {
    db.end();
  }
});
