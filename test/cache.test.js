import test from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "../src/utils/cache.js";

test("wrap returns cached value on hit without calling fn again", async () => {
  let clock = 1000;
  const cache = createTtlCache({ now: () => clock });
  let calls = 0;
  const fn = async () => { calls++; return "value"; };

  assert.equal(await cache.wrap("k", 500, fn), "value");
  clock = 1400;
  assert.equal(await cache.wrap("k", 500, fn), "value");
  assert.equal(calls, 1);
});

test("wrap recomputes after entry expires", async () => {
  let clock = 0;
  const cache = createTtlCache({ now: () => clock });
  let calls = 0;
  const fn = async () => ++calls;

  assert.equal(await cache.wrap("k", 100, fn), 1);
  clock = 99;
  assert.equal(await cache.wrap("k", 100, fn), 1);
  clock = 100;
  assert.equal(await cache.wrap("k", 100, fn), 2);
  assert.equal(calls, 2);
});

test("wrap does not cache null or undefined so failures can retry", async () => {
  const cache = createTtlCache();
  let nullCalls = 0;
  let undefinedCalls = 0;

  assert.equal(await cache.wrap("n", 1000, async () => { nullCalls++; return null; }), null);
  assert.equal(await cache.wrap("n", 1000, async () => { nullCalls++; return null; }), null);
  assert.equal(nullCalls, 2);

  assert.equal(await cache.wrap("u", 1000, async () => { undefinedCalls++; return undefined; }), undefined);
  assert.equal(await cache.wrap("u", 1000, async () => { undefinedCalls++; return undefined; }), undefined);
  assert.equal(undefinedCalls, 2);
});

test("wrap caches falsy non-null values like 0 and empty string", async () => {
  const cache = createTtlCache();
  let calls = 0;
  const fn = async () => { calls++; return 0; };

  assert.equal(await cache.wrap("zero", 1000, fn), 0);
  assert.equal(await cache.wrap("zero", 1000, fn), 0);
  assert.equal(calls, 1);

  let strCalls = 0;
  assert.equal(await cache.wrap("str", 1000, async () => { strCalls++; return ""; }), "");
  assert.equal(await cache.wrap("str", 1000, async () => { strCalls++; return ""; }), "");
  assert.equal(strCalls, 1);
});

test("wrap evicts the oldest entry when maxEntries is exceeded", async () => {
  const cache = createTtlCache({ maxEntries: 2 });
  const calls = { a: 0, b: 0, c: 0 };

  await cache.wrap("a", 1000, async () => { calls.a++; return "A"; });
  await cache.wrap("b", 1000, async () => { calls.b++; return "B"; });
  await cache.wrap("c", 1000, async () => { calls.c++; return "C"; });

  await cache.wrap("b", 1000, async () => { calls.b++; return "B"; });
  assert.equal(calls.b, 1);
  await cache.wrap("c", 1000, async () => { calls.c++; return "C"; });
  assert.equal(calls.c, 1);

  await cache.wrap("a", 1000, async () => { calls.a++; return "A"; });
  assert.equal(calls.a, 2);
});
