import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createInputRequestStore } from "../src/services/inputRequest.js";

test("inputRequestStore set/get, overwrite, consume atomik, clear, dan validasi tool", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    let clock = 1000000;
    const store = createInputRequestStore(db, { now: () => clock, ttlMs: 300000 });

    // User tanpa state → null (get/consume/clear aman).
    assert.equal(await store.get("123"), null);
    assert.equal(await store.consume("123"), null);
    await store.clear("123");

    // set + get.
    await store.set("123", "fx", 42);
    assert.deepEqual(await store.get("123"), {
      tool: "fx",
      promptMessageId: 42,
      expiresAt: clock + 300000,
    });

    // Prompt baru menimpa lama; tetap satu baris per user.
    await store.set("123", "stock", 43);
    assert.deepEqual(await store.get("123"), {
      tool: "stock",
      promptMessageId: 43,
      expiresAt: clock + 300000,
    });
    const count = await db.query("SELECT COUNT(*) AS n FROM input_requests WHERE user_id = $1", ["123"]);
    assert.equal(count.rows[0].n, 1);

    // Tool tidak dikenal → throw, state lama tidak rusak.
    await assert.rejects(() => store.set("123", "gempa"), /tidak dikenal/);
    await assert.rejects(() => store.set("123", "libur"), /tidak dikenal/);
    await assert.rejects(() => store.set("123", ""), /tidak dikenal/);
    assert.equal((await store.get("123")).tool, "stock");

    // Consume atomik: klaim pertama dapat, klaim kedua null.
    assert.deepEqual(await store.consume("123"), {
      tool: "stock",
      promptMessageId: 43,
      expiresAt: clock + 300000,
    });
    assert.equal(await store.consume("123"), null);
    assert.equal(await store.get("123"), null);

    // set tanpa promptMessageId → null.
    await store.set("123", "weather");
    assert.equal((await store.get("123")).promptMessageId, null);

    // clear menghapus baris.
    await store.clear("123");
    assert.equal(await store.get("123"), null);

    // Isolasi antar user.
    await store.set("123", "crypto", 60);
    await store.set("456", "fx", 61);
    await store.clear("123");
    assert.equal((await store.get("456")).tool, "fx");
    assert.equal(await store.get("123"), null);
  } finally {
    db.end();
  }
});

test("inputRequestStore TTL expired: get null + baris terhapus, consume null", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    let clock = 1000000;
    const store = createInputRequestStore(db, { now: () => clock, ttlMs: 300000 });

    await store.set("123", "news", 50);
    clock += 300000; // tepat di batas → dianggap expired.
    assert.equal(await store.get("123"), null);
    const afterGet = await db.query("SELECT COUNT(*) AS n FROM input_requests WHERE user_id = $1", ["123"]);
    assert.equal(afterGet.rows[0].n, 0);

    // Baris expired tidak bisa diklaim consume.
    await store.set("123", "wb", 51);
    clock += 300001;
    assert.equal(await store.consume("123"), null);

    // set baru setelah expired hidup lagi dengan TTL baru.
    await store.set("123", "fx", 52);
    assert.deepEqual(await store.get("123"), {
      tool: "fx",
      promptMessageId: 52,
      expiresAt: clock + 300000,
    });
  } finally {
    db.end();
  }
});

test("inputRequestStore default TTL 5 menit dengan Date.now", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const store = createInputRequestStore(db);
    const before = Date.now();
    await store.set("789", "news");
    const got = await store.get("789");
    assert.equal(got.tool, "news");
    assert.ok(got.expiresAt >= before + 300000);
    assert.ok(got.expiresAt <= Date.now() + 300000);
  } finally {
    db.end();
  }
});
