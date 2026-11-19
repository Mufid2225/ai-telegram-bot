import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";

test("createDatabase creates required tables and returns lastInsertRowid", async () => {
  const db = createDatabase(":memory:");
  try {
    const tables = await db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const names = tables.rows.map((row) => row.name);
    for (const expected of ["memories", "conversations", "knowledge", "pending_actions", "reminders", "active_context", "callback_refs", "input_requests"]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }

    const inserted = await db.query(
      "INSERT INTO reminders (user_id, message, due_at, created_at) VALUES ($1, $2, $3, $4)",
      ["123", "Bayar kos", "2026-11-18T08:00:00.000Z", "2026-11-17T00:00:00.000Z"]
    );
    assert.equal(inserted.rowCount, 1);
    assert.ok(Number(inserted.lastInsertRowid) >= 1);

    const reused = await db.query(
      "SELECT id FROM reminders WHERE user_id = $2 AND (message ILIKE $1 OR due_at ILIKE $1)",
      ["%kos%", "123"]
    );
    assert.equal(reused.rowCount, 1);
  } finally {
    db.end();
  }
});
