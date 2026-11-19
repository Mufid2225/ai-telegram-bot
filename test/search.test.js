import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webSearch, newsSearch, detectSearchNeeded } from "../src/services/search.js";

const ENV_KEYS = ["TAVILY_API_KEY", "NEWSAPI_KEY", "SERPAPI_KEY"];
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

test("webSearch formats Tavily results and serves the second call from cache", async (t) => {
  let fetchCalls = 0;
  let sawSignal = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    fetchCalls++;
    if (init?.signal instanceof AbortSignal) sawSignal = true;
    return new Response(JSON.stringify({
      answer: "Ringkasan uji",
      results: [{ title: "Judul Uji", url: "https://example.com/uji", content: "Isi hasil uji" }],
    }), { status: 200 });
  });

  const first = await webSearch("topik uji cache tavily", 5);
  assert.match(first, /Ringkasan: Ringkasan uji/);
  assert.match(first, /Judul Uji/);
  assert.match(first, /Sumber: https:\/\/example\.com\/uji/);
  assert.equal(sawSignal, true);

  const second = await webSearch("topik uji cache tavily", 5);
  assert.equal(second, first);
  assert.equal(fetchCalls, 1);
});

test("webSearch returns null when all providers are empty and does not cache the failure", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ results: [], articles: [], organic_results: [] }), { status: 200 });
  });

  const query = "uji gagal semua provider";
  assert.equal(await webSearch(query, 5), null);
  const afterFirst = fetchCalls;
  assert.ok(afterFirst >= 4);

  assert.equal(await webSearch(query, 5), null);
  assert.ok(fetchCalls >= afterFirst + 4);
});

test("webSearch returns null without throwing when fetch rejects", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down https://api.tavily.com/search?key=test-key");
  });

  assert.equal(await webSearch("uji error jaringan", 5), null);
});

test("newsSearch defaults to Indonesian, formats articles, and caches success", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      articles: [{ title: "Berita Uji", source: { name: "Sumber Uji" }, url: "https://example.com/berita-uji", description: "Deskripsi uji" }],
    }), { status: 200 });
  });

  const result = await newsSearch("berita uji nusantara");
  assert.match(result, /Berita Uji \(Sumber Uji\)/);
  assert.match(result, /https:\/\/example\.com\/berita-uji/);
  assert.match(result, /Deskripsi uji/);
  assert.match(urls[0], /language=id/);

  const second = await newsSearch("berita uji nusantara");
  assert.equal(second, result);
  assert.equal(urls.length, 1);
});

test("detectSearchNeeded no longer triggers on personal company fragments alone", () => {
  assert.equal(detectSearchNeeded("jel"), false);
  assert.equal(detectSearchNeeded("rans"), false);
  assert.equal(detectSearchNeeded("niramas"), false);
  assert.equal(detectSearchNeeded("berita terbaru"), true);
});
