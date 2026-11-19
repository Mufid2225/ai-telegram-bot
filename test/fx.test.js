import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getRates, formatConversion } from "../src/services/fx.js";

const ENV_KEYS = ["EXCHANGERATE_API_KEY"];
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

// 2026-11-19T00:00:00Z
const UNIX_UJI = 1795046400;

test("getRates uses ExchangeRate-API primary when key present and result success", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      result: "success",
      time_last_update_unix: UNIX_UJI,
      conversion_rates: { IDR: 18237, EUR: 0.92 },
    }), { status: 200 });
  });

  const result = await getRates("usd");
  assert.equal(result.base, "USD");
  assert.equal(result.source, "exchangerate-api");
  assert.equal(result.rates.IDR, 18237);
  assert.equal(result.date, "2026-11-19");
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://v6.exchangerate-api.com/v6/test-key/latest/USD");
});

test("getRates falls back to Frankfurter when primary result is not success", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.startsWith("https://v6.exchangerate-api.com/")) {
      return new Response(JSON.stringify({ result: "error", "error-type": "invalid-key" }), { status: 200 });
    }
    assert.ok(u.startsWith("https://api.frankfurter.dev/v2/rates?base=GBP"));
    return new Response(JSON.stringify([
      { date: "2026-11-19", base: "GBP", quote: "IDR", rate: 23500 },
      { date: "2026-11-19", base: "GBP", quote: "USD", rate: 1.27 },
    ]), { status: 200 });
  });

  const result = await getRates("GBP");
  assert.equal(result.source, "frankfurter");
  assert.equal(result.base, "GBP");
  assert.equal(result.rates.IDR, 23500);
  assert.equal(result.date, "2026-11-19");
  assert.equal(urls.length, 2);
});

test("getRates returns null when both providers fail or base unsupported", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.startsWith("https://v6.exchangerate-api.com/")) {
      throw new Error("network down");
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
  assert.equal(await getRates("JPY"), null);

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await getRates("XXX"), null);
});

test("getRates rejects invalid base without fetching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(await getRates("US"), null);
  assert.equal(await getRates("usd1"), null);
  assert.equal(await getRates(""), null);
});

test("getRates caches the unified result for 24h including fallback source", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    fetchCalls++;
    const u = String(url);
    if (u.startsWith("https://v6.exchangerate-api.com/")) {
      return new Response(JSON.stringify({ result: "error" }), { status: 200 });
    }
    return new Response(JSON.stringify([
      { date: "2026-11-19", base: "SGD", quote: "IDR", rate: 13500 },
    ]), { status: 200 });
  });

  const first = await getRates("SGD");
  assert.equal(first.source, "frankfurter");
  assert.equal(fetchCalls, 2);

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called on cache hit");
  });
  const second = await getRates("SGD");
  assert.deepEqual(second, first);
  assert.equal(fetchCalls, 2);
});

test("formatConversion renders id-ID numbers with rate date and source", () => {
  const obj = { base: "USD", rates: { IDR: 18237 }, date: "2026-11-19", source: "frankfurter" };
  assert.equal(
    formatConversion(obj, "idr"),
    "1 USD = 18.237 IDR (kurs 2026-11-19, sumber: Frankfurter; data diperbarui harian)"
  );
  assert.match(formatConversion(obj, "IDR", 2), /^2 USD = 36\.474 IDR/);
  assert.match(
    formatConversion({ ...obj, source: "exchangerate-api" }, "IDR"),
    /sumber: ExchangeRate-API — https:\/\/www\.exchangerate-api\.com; data diperbarui harian/
  );
  assert.equal(formatConversion(obj, "EUR"), "");
  assert.equal(formatConversion(null, "IDR"), "");
});
