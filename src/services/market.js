import YahooFinance from "yahoo-finance2";
import { createTtlCache } from "../utils/cache.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const cache = createTtlCache();
const cached = (key, ttlMs, fn) => cache.wrap(key, ttlMs, fn);

// yahoo-finance2 tidak punya timeout aplikasi (undici default ~300s); batasi ~15 detik.
// Resolve null saat timeout agar caller mengembalikan null (null tidak di-cache).
export function withTimeout(promise, ms = 15_000) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const SYMBOL_MAP = {
  xauusd: "GC=F",
  emas: "GC=F",
  gold: "GC=F",
  xagusd: "SI=F",
  perak: "SI=F",
  silver: "SI=F",
  eurusd: "EURUSD=X",
  gbpusd: "GBPUSD=X",
  usdjpy: "USDJPY=X",
  usdcad: "USDCAD=X",
  audusd: "AUDUSD=X",
  nzdusd: "NZDUSD=X",
  btc: "BTC-USD",
  bitcoin: "BTC-USD",
  eth: "ETH-USD",
  ethereum: "ETH-USD",
  minyak: "CL=F",
  crude: "CL=F",
  "s&p": "^GSPC",
  spx: "^GSPC",
  nasdaq: "^IXIC",
  "ihsg": "^JKSE",
  jkse: "^JKSE",
  nikkei: "^N225",
  hang: "^HSI",
  hsbi: "^HSI",
  gas: "NG=F",
  natural: "NG=F",
  tembaga: "HG=F",
  copper: "HG=F",
  wheat: "ZW=F",
  gandum: "ZW=F",
  corn: "ZC=F",
  jagung: "ZC=F",
  coffee: "KC=F",
  kopi: "KC=F",
  sugar: "SB=F",
  gula: "SB=F",
  cotton: "CT=F",
  kapas: "CT=F",
  paladium: "PA=F",
  platinum: "PL=F",
};

export function detectSymbol(text) {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s.=^/]/g, "");

  for (const [keyword, symbol] of Object.entries(SYMBOL_MAP)) {
    if (lower.includes(keyword)) return symbol;
  }

  const stockMatch = lower.match(/saham\s+(\w+)/i);
  if (stockMatch) {
    let sym = stockMatch[1].toUpperCase();
    if (!sym.includes(".") && !sym.includes("^") && !sym.includes("=")) {
      if (["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA"].includes(sym)) {
        return sym;
      }
      sym += ".JK";
    }
    return sym;
  }

  return null;
}

export function formatQuote(r) {
  if (!r || !r.regularMarketPrice) return null;
  const change = r.regularMarketChange || 0;
  const changePct = r.regularMarketChangePercent || 0;
  const arrow = change > 0 ? "+" : "";
  return {
    symbol: r.symbol,
    name: r.shortName || r.longName || r.symbol,
    price: r.regularMarketPrice,
    change: change,
    changePct: changePct,
    high: r.regularMarketDayHigh,
    low: r.regularMarketDayLow,
    volume: r.regularMarketVolume,
    currency: r.currency || "USD",
    marketState: r.marketState || "REGULAR",
    changeStr: `${arrow}${change.toFixed(2)} (${arrow}${changePct.toFixed(2)}%)`,
  };
}

export async function getQuote(symbol) {
  return cached(`quote:${symbol}`, 60_000, async () => {
    try {
      const r = await withTimeout(yf.quote(symbol));
      return formatQuote(r);
    } catch {
      return null;
    }
  });
}

export async function getNews(query, count = 5) {
  const news = await cached(`news:${count}:${query}`, 600_000, async () => {
    try {
      const r = await withTimeout(yf.search(query, { newsCount: count }));
      const items = (r?.news || []).map((n) => ({
        title: n.title,
        publisher: n.publisher,
        summary: n.summary,
        link: n.link,
      }));
      return items.length ? items : null;
    } catch {
      return null;
    }
  });
  return news ?? [];
}

export async function getMarketNews(count = 6) {
  return getNews("stock market economy", count);
}

export function buildMarketContext(quote, news) {
  let ctx = "\n--- Data Market ---\n";

  if (quote) {
    ctx += `[${quote.symbol}] ${quote.name}
Harga: ${quote.price} ${quote.currency}
Perubahan: ${quote.changeStr}
High: ${quote.high} | Low: ${quote.low}
Volume: ${quote.volume?.toLocaleString() || "-"}
Status: ${quote.marketState}\n`;
  }

  if (news && news.length > 0) {
    ctx += "\nBerita Terkait:\n";
    for (const n of news) {
      ctx += `- ${n.title} (${n.publisher || "yahoo"})\n`;
    }
  }

  return ctx;
}
