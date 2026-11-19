import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readUrl } from "../src/services/jina.js";

const ENV_KEYS = ["JINA_API_KEY"];
const savedEnv = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = "test-key";
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("readUrl returns markdown text, sends Bearer with key, and serves second call from cache", async (t) => {
  let fetchCalls = 0;
  let sawAuth = false;
  let sawSignal = false;
  let sawUrl = "";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    fetchCalls++;
    sawUrl = String(url);
    sawAuth = init?.headers?.Authorization === "Bearer test-key";
    if (init?.signal instanceof AbortSignal) sawSignal = true;
    return new Response(
      "Title: Artikel Uji\n\nURL Source: https://example.com/artikel-uji\n\nMarkdown Content:\nIsi artikel uji",
      { status: 200 }
    );
  });

  const text = await readUrl("https://example.com/artikel-uji");
  assert.match(text, /Markdown Content:/);
  assert.match(text, /Isi artikel uji/);
  assert.equal(sawAuth, true);
  assert.equal(sawSignal, true);
  assert.ok(sawUrl.startsWith("https://r.jina.ai/https://example.com/artikel-uji"));

  const second = await readUrl("https://example.com/artikel-uji");
  assert.equal(second, text);
  assert.equal(fetchCalls, 1);
});

test("readUrl returns null without fetching for non-http urls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(await readUrl("ftp://example.com/berkas"), null);
  assert.equal(await readUrl("example.com/tanpa-skema"), null);
  assert.equal(await readUrl(""), null);
  assert.equal(await readUrl(null), null);
});

test("readUrl returns null on fetch failure and does not cache the failure", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    throw new Error("network down");
  });
  assert.equal(await readUrl("https://example.com/gagal-uji"), null);
  assert.equal(await readUrl("https://example.com/gagal-uji"), null);
  assert.equal(fetchCalls, 2);
});

test("readUrl caps oversized response text at 200000 characters including cache", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    return new Response("y".repeat(250000), { status: 200 });
  });

  const text = await readUrl("https://example.com/artikel-uji-sangat-panjang");
  assert.equal(text.length, 200000);

  const second = await readUrl("https://example.com/artikel-uji-sangat-panjang");
  assert.equal(second.length, 200000);
  assert.equal(fetchCalls, 1);
});

test("readUrl returns null on non-ok HTTP status", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
  assert.equal(await readUrl("https://example.com/status-429-uji"), null);
});

test("readUrl omits Authorization header when no key is set", async (t) => {
  delete process.env.JINA_API_KEY;
  let sawAuth = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sawAuth = Boolean(init?.headers?.Authorization);
    return new Response("Markdown Content: tanpa key", { status: 200 });
  });
  const text = await readUrl("https://example.com/tanpa-key-uji");
  assert.match(text, /tanpa key/);
  assert.equal(sawAuth, false);
});
