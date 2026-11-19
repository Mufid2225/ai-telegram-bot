import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getPrices, searchCoin, formatPrices, COIN_ALIASES } from "../src/services/coingecko.js";

const ENV_KEYS = ["COINGECKO_API_KEY"];
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

const pricePayload = {
  bitcoin: { usd: 63736, usd_24h_change: -1.37, idr: 1164101363, idr_24h_change: -1.28 },
  ethereum: { usd: 2100.5, usd_24h_change: 2.4, idr: 38300000, idr_24h_change: 2.51 },
};

test("getPrices sends demo header with key, builds correct URL, formats id-ID, and caches", async (t) => {
  const urls = [];
  let sawDemoHeader = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    urls.push(String(url));
    sawDemoHeader = init?.headers?.["x-cg-demo-api-key"] === "test-key";
    return new Response(JSON.stringify(pricePayload), { status: 200 });
  });

  const data = await getPrices(["bitcoin", "ethereum"]);
  assert.equal(data.bitcoin.idr, 1164101363);
  assert.equal(sawDemoHeader, true);
  assert.ok(urls[0].startsWith("https://api.coingecko.com/api/v3/simple/price?"));
  assert.match(urls[0], /ids=bitcoin,ethereum/);
  assert.match(urls[0], /vs_currencies=idr,usd/);
  assert.match(urls[0], /include_24hr_change=true/);

  const text = formatPrices(data, "idr");
  assert.match(text, /1\.164\.101\.363 IDR/);
  assert.match(text, /-1,28% 24 jam/);
  assert.match(text, /\+2,51% 24 jam/);
  assert.match(text, /Data: CoinGecko/);

  const second = await getPrices(["bitcoin", "ethereum"]);
  assert.deepEqual(second, data);
  assert.equal(urls.length, 1);
});

test("getPrices omits demo header when no key is set", async (t) => {
  delete process.env.COINGECKO_API_KEY;
  let sawDemoHeader = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sawDemoHeader = Boolean(init?.headers?.["x-cg-demo-api-key"]);
    return new Response(JSON.stringify({ solana: { idr: 2500000, idr_24h_change: 0.5 } }), { status: 200 });
  });
  const data = await getPrices(["solana"]);
  assert.equal(data.solana.idr, 2500000);
  assert.equal(sawDemoHeader, false);
});

test("searchCoin returns at most 5 coins and caches by query", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      coins: Array.from({ length: 8 }, (_, i) => ({
        id: `coin-uji-${i}`, name: `Coin Uji ${i}`, symbol: `c${i}`, market_cap_rank: i + 1,
      })),
    }), { status: 200 });
  });

  const coins = await searchCoin("coin uji pencarian");
  assert.equal(coins.length, 5);
  assert.equal(coins[0].id, "coin-uji-0");
  assert.match(urls[0], /\/api\/v3\/search\?query=coin%20uji%20pencarian/);

  const second = await searchCoin("coin uji pencarian");
  assert.deepEqual(second, coins);
  assert.equal(urls.length, 1);
});

test("getPrices encodes each id in the ids query parameter", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ "avalanche-2": { idr: 9000000 } }), { status: 200 });
  });
  const data = await getPrices(["avalanche-2", "koin&uji#x"]);
  assert.match(urls[0], /ids=avalanche-2,koin%26uji%23x&/);
  assert.equal(data["avalanche-2"].idr, 9000000);
});

test("COIN_ALIASES maps common symbols to CoinGecko ids", () => {
  assert.equal(COIN_ALIASES.btc, "bitcoin");
  assert.equal(COIN_ALIASES.eth, "ethereum");
  assert.equal(COIN_ALIASES.avax, "avalanche-2");
  assert.equal(COIN_ALIASES.ton, "the-open-network");
  assert.equal(COIN_ALIASES.usdc, "usd-coin");
});

test("coingecko services return null on failure without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await getPrices(["dogecoin"]), null);
  assert.equal(await searchCoin("koin gagal uji"), null);

  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
  assert.equal(await getPrices(["cardano"]), null);

  assert.equal(await getPrices([]), null);
});
