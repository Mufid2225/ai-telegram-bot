import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { researchTools, executeResearchTool } from "../src/tools/research.js";
import { tools, executeTool } from "../src/tools.js";
import * as fmp from "../src/services/fmp.js";
import { withTimeout } from "../src/services/market.js";

const ENV_KEYS = ["TAVILY_API_KEY", "NEWSAPI_KEY", "SERPAPI_KEY", "ALPHA_VANTAGE_KEY", "FMP_API_KEY"];
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

const RESEARCH_NAMES = [
  "web_search",
  "news_search",
  "stock_quote",
  "symbol_search",
  "market_news",
  "news_sentiment",
  "economic_indicator",
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Mock lengkap alur yahoo-finance2 (crumb + quote + search) agar tetap 100% offline.
function mockYahooFetch(t, { quoteResult, searchResult }) {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("finance.yahoo.com/quote/AAPL")) {
      return new Response("<html></html>", {
        status: 200,
        headers: {
          "set-cookie": "A3=d=AQABBTestCookieUji; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Domain=.yahoo.com; Path=/; Secure; SameSite=None",
        },
      });
    }
    if (url.includes("/v1/test/getcrumb")) return new Response("test-crumb", { status: 200 });
    if (url.includes("/v7/finance/quote")) {
      return jsonResponse({ quoteResponse: { result: quoteResult ? [quoteResult] : [], error: null } });
    }
    if (url.includes("/v1/finance/search")) return jsonResponse(searchResult ?? {});
    if (url.includes("registry.npmjs.org")) return jsonResponse({ version: "3.15.3" });
    throw new Error("unexpected fetch in yahoo mock: " + url);
  });
}

function yahooSearchResult(newsItems) {
  return {
    explains: [],
    count: newsItems.length,
    quotes: [],
    news: newsItems,
    nav: [],
    lists: [],
    researchReports: [],
    totalTime: 1,
    timeTakenForQuotes: 1,
    timeTakenForNews: 1,
    timeTakenForAlgowatchlist: 1,
    timeTakenForPredefinedScreener: 1,
    timeTakenForCrunchbase: 1,
    timeTakenForNav: 1,
    timeTakenForResearchReports: 1,
    timeTakenForScreenerField: 1,
    timeTakenForCulturalAssets: 1,
    timeTakenForSearchLists: 1,
  };
}

test("researchTools registers 7 read-only tools with valid schemas and is merged into tools", () => {
  assert.deepEqual(researchTools.map((t) => t.function.name).sort(), [...RESEARCH_NAMES].sort());
  const registered = new Set(tools.map((t) => t.function.name));
  for (const name of RESEARCH_NAMES) assert.ok(registered.has(name), `missing tool ${name}`);

  const byName = Object.fromEntries(researchTools.map((t) => [t.function.name, t.function]));
  for (const fn of Object.values(byName)) {
    assert.equal(fn.parameters.type, "object");
    assert.ok(fn.parameters.properties);
  }
  assert.deepEqual(byName.web_search.parameters.required, ["query"]);
  assert.deepEqual(byName.news_search.parameters.required, ["query"]);
  assert.deepEqual(byName.stock_quote.parameters.required, ["symbol"]);
  assert.deepEqual(byName.symbol_search.parameters.required, ["keywords"]);
  assert.deepEqual(byName.economic_indicator.parameters.required, ["indicator"]);
  assert.equal(byName.economic_indicator.parameters.properties.indicator.enum.length, 9);
  assert.deepEqual(byName.news_search.parameters.properties.language.enum, ["id", "en"]);
});

test("web_search success via executeTool returns formatted results with source URLs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({
    answer: "Ringkasan riset uji",
    results: [{ title: "Judul Riset", url: "https://example.com/riset", content: "Isi hasil riset" }],
  }));

  const out = await executeTool("web_search", { query: "uji riset web sukses" }, {});
  assert.match(out, /Ringkasan: Ringkasan riset uji/);
  assert.match(out, /Sumber: https:\/\/example\.com\/riset/);
});

test("web_search failure via executeTool returns friendly message instead of throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ results: [], articles: [], organic_results: [] }));

  const out = await executeTool("web_search", { query: "uji gagal provider riset" }, {});
  assert.match(out, /Pencarian web sedang gagal\/tidak tersedia/);
  assert.doesNotMatch(out, /test-key|api\.tavily|newsapi|serpapi/i);
});

test("news_search includes article URLs and falls back to friendly message when unavailable", async (t) => {
  let articles = [{ title: "Berita Riset Uji", source: { name: "Sumber Uji" }, url: "https://example.com/berita-riset", description: "Deskripsi berita" }];
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ articles }));

  const ok = await executeTool("news_search", { query: "uji berita riset nusantara", language: "en" }, {});
  assert.match(ok, /Berita Riset Uji \(Sumber Uji\)/);
  assert.match(ok, /https:\/\/example\.com\/berita-riset/);

  articles = [];
  const fail = await executeTool("news_search", { query: "uji berita riset kosong" }, {});
  assert.match(fail, /web_search/);
});

test("stock_quote success via executeTool builds market context from mocked Yahoo quote", async (t) => {
  mockYahooFetch(t, {
    quoteResult: {
      symbol: "UJI.JK",
      quoteType: "EQUITY",
      shortName: "Saham Uji",
      language: "en-US",
      region: "US",
      currency: "IDR",
      market: "id_market",
      marketState: "REGULAR",
      exchange: "JKT",
      fullExchangeName: "Jakarta",
      exchangeTimezoneName: "Asia/Jakarta",
      exchangeTimezoneShortName: "WIB",
      gmtOffSetMilliseconds: 25200000,
      esgPopulated: false,
      exchangeDataDelayedBy: 0,
      sourceInterval: 15,
      tradeable: false,
      triggerable: true,
      regularMarketPrice: 1000,
      regularMarketChange: 10,
      regularMarketChangePercent: 1.01,
      regularMarketDayHigh: 1010,
      regularMarketDayLow: 990,
      regularMarketVolume: 1234567,
    },
    searchResult: yahooSearchResult([{
      uuid: "n-uji-1",
      title: "Berita Emiten Uji",
      publisher: "Penerbit Uji",
      link: "https://example.com/berita-emiten-uji",
      providerPublishTime: 1763500000,
      type: "STORY",
    }]),
  });

  const out = await executeTool("stock_quote", { symbol: "UJI.JK" }, {});
  assert.match(out, /\[UJI\.JK\] Saham Uji/);
  assert.match(out, /Harga: 1000 IDR/);
  assert.match(out, /Berita Emiten Uji/);
});

test("stock_quote null path suggests symbol_search without leaking errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down https://query2.finance.yahoo.com/v7/finance/quote?crumb=test-key");
  });

  const out = await executeTool("stock_quote", { symbol: "TIDAKADA.JK" }, {});
  assert.match(out, /tidak ditemukan/);
  assert.match(out, /symbol_search/);
  assert.match(out, /\.JK/);
  assert.doesNotMatch(out, /test-key|query2\.finance/);
});

test("symbol_search formats at most 5 candidates and reports empty results", async (t) => {
  const matches = Array.from({ length: 7 }, (_, i) => ({
    "1. symbol": `UJI${i}.JK`,
    "2. name": `Perusahaan Uji ${i}`,
    "3. type": "Equity",
    "4. region": "Indonesia",
    "8. currency": "IDR",
  }));
  let bestMatches = matches;
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ bestMatches }));

  const out = await executeTool("symbol_search", { keywords: "perusahaan uji banyak" }, {});
  assert.match(out, /UJI0\.JK: Perusahaan Uji 0 \(Equity, Indonesia, IDR\)/);
  assert.match(out, /UJI4\.JK/);
  assert.doesNotMatch(out, /UJI5\.JK/);

  bestMatches = [];
  const empty = await executeTool("symbol_search", { keywords: "perusahaan uji nihil" }, {});
  assert.match(empty, /Tidak ada ticker yang cocok/);
});

test("market_news without symbol returns general market news with links", async (t) => {
  mockYahooFetch(t, {
    searchResult: yahooSearchResult([{
      uuid: "n-market-1",
      title: "Berita Pasar Uji",
      publisher: "Penerbit Pasar",
      link: "https://example.com/berita-pasar-uji",
      providerPublishTime: 1763500000,
      type: "STORY",
    }]),
  });

  const out = await executeTool("market_news", {}, {});
  assert.match(out, /Berita Pasar Uji \(Penerbit Pasar\)/);
  assert.match(out, /https:\/\/example\.com\/berita-pasar-uji/);
});

test("news_sentiment requires symbol or topics and formats sentiment feed", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    return jsonResponse({
      feed: [{
        title: "Berita Sentimen Uji",
        summary: "Ringkasan sentimen uji",
        url: "https://example.com/sentimen-uji",
        source: "Sumber Sentimen",
        overall_sentiment_label: "Bullish",
        overall_sentiment_score: 0.45,
        topics: [],
        ticker_sentiment: [],
      }],
    });
  });

  const noArgs = await executeTool("news_sentiment", {}, {});
  assert.match(noArgs, /minimal salah satu/);
  assert.equal(fetchCalls, 0);

  const out = await executeTool("news_sentiment", { symbol: "SENTIMEN.JK" }, {});
  assert.match(out, /Sentimen Berita/);
  assert.match(out, /\[Bullish\] Berita Sentimen Uji/);
  assert.match(out, /Rata-rata sentimen: Positif/);
});

test("economic_indicator validates enum and formats valid indicator data", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    fetchCalls++;
    assert.match(String(input), /function=CPI/);
    return jsonResponse({ data: [{ date: "2026-10-01", value: "300.123" }, { date: "2026-09-01", value: "299.5" }] });
  });

  const bad = await executeTool("economic_indicator", { indicator: "NGARANG" }, {});
  assert.match(bad, /indicator tidak dikenal/);
  assert.match(bad, /FEDERAL_FUNDS_RATE/);
  assert.equal(fetchCalls, 0);

  const out = await executeTool("economic_indicator", { indicator: "CPI" }, {});
  assert.match(out, /CPI:/);
  assert.match(out, /2026-10-01: 300\.123/);
  assert.equal(fetchCalls, 1);
});

test("economic_indicator empty data returns friendly quota message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ Note: "API call frequency limit" }));

  const out = await executeTool("economic_indicator", { indicator: "UNEMPLOYMENT" }, {});
  assert.match(out, /tidak tersedia/);
  assert.doesNotMatch(out, /test-key|alphavantage/i);
});

test("research tool output is capped at 4000 characters", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({
    answer: "Ringkasan panjang",
    results: [{ title: "Judul Panjang", url: "https://example.com/panjang", content: "x".repeat(9000) }],
  }));

  const out = await executeTool("web_search", { query: "uji output sangat panjang" }, {});
  assert.ok(out.length <= 4000, `output length ${out.length} exceeds 4000`);
  assert.match(out, /\[output dipotong\]$/);
});

test("unknown research tool falls through dispatch consistently and returns null directly", async () => {
  assert.equal(await executeResearchTool("riset_tidak_ada"), null);
  const out = await executeTool("riset_tidak_ada", {}, {});
  assert.equal(out, "Unknown tool: riset_tidak_ada");
});

test("news_sentiment strips exchange suffix before calling Alpha Vantage", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    urls.push(String(input));
    return jsonResponse({ feed: [] });
  });

  await executeTool("news_sentiment", { symbol: "BBCA.JK" }, {});
  assert.equal(urls.length, 1);
  assert.match(urls[0], /tickers=BBCA(&|$)/);
  assert.doesNotMatch(urls[0], /BBCA\.JK/);
});

test("fmp encodes symbol in all request URLs (no parameter injection)", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    urls.push(String(input));
    return jsonResponse([]);
  });

  const symbol = "AAPL&x=y";
  await fmp.getProfile(symbol);
  await fmp.getFinancialRatios(symbol);
  await fmp.getQuote(symbol);

  assert.equal(urls.length, 3);
  for (const url of urls) {
    assert.match(url, /symbol=AAPL%26x%3Dy/);
    assert.doesNotMatch(url, /&x=y/);
  }
});

test("formatFundamentals keeps ratios when profile is null and preserves profile output", () => {
  const ratios = { pe: 15.5, eps: 2.34, pb: 2.1, roe: 0.15 };

  const ratiosOnly = fmp.formatFundamentals(null, ratios);
  assert.notEqual(ratiosOnly, "");
  assert.match(ratiosOnly, /PE: 15\.50/);
  assert.match(ratiosOnly, /EPS: \$2\.34/);
  assert.match(ratiosOnly, /ROE: 15\.00%/);

  assert.equal(fmp.formatFundamentals(null, null), "");

  const profile = { name: "Uji", symbol: "UJI", sector: "Sektor", industry: "Industri", exchange: "X", marketCap: 1e9, beta: 1.1, ceo: "CEO", range52: "1-2" };
  const full = fmp.formatFundamentals(profile, ratios);
  assert.match(full, /Fundamental Uji \(UJI\)/);
  assert.match(full, /Market Cap: \$1\.00B/);
  assert.match(full, /PE: 15\.50/);
});

test("withTimeout resolves value before deadline, null after deadline, and propagates rejection", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 50), "ok");
  assert.equal(await withTimeout(new Promise(() => {}), 10), null);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
});
