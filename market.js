import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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
  try {
    const r = await yf.quote(symbol);
    return formatQuote(r);
  } catch {
    return null;
  }
}

export async function getNews(query, count = 5) {
  try {
    const r = await yf.search(query, { newsCount: count });
    return (r.news || []).map((n) => ({
      title: n.title,
      publisher: n.publisher,
      summary: n.summary,
      link: n.link,
    }));
  } catch {
    return [];
  }
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
