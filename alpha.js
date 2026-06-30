const BASE = "https://www.alphavantage.co/query";
const KEY = process.env.ALPHA_VANTAGE_KEY;

async function fetchJson(params) {
  if (!KEY) return null;
  const url = `${BASE}?${new URLSearchParams({ ...params, apikey: KEY })}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await resp.json();
    if (data.Note || data.Information) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getQuote(symbol) {
  const data = await fetchJson({ function: "GLOBAL_QUOTE", symbol });
  if (!data?.["Global Quote"]) return null;
  const q = data["Global Quote"];
  return {
    symbol: q["01. symbol"],
    price: parseFloat(q["05. price"]),
    change: parseFloat(q["09. change"]),
    changePct: parseFloat(q["10. change percent"]?.replace("%", "")),
    high: parseFloat(q["03. high"]),
    low: parseFloat(q["04. low"]),
    volume: parseInt(q["06. volume"]),
    source: "alphavantage",
  };
}

export async function getNewsSentiment({ tickers = [], topics = [], limit = 5 } = {}) {
  const params = { function: "NEWS_SENTIMENT", limit };
  if (tickers.length) params.tickers = tickers.join(",");
  if (topics.length) params.topics = topics.join(",");
  const data = await fetchJson(params);
  if (!data?.feed) return [];
  return data.feed.slice(0, limit).map((item) => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    source: item.source,
    sentiment: item.overall_sentiment_label,
    sentimentScore: item.overall_sentiment_score,
    topics: item.topics?.map((t) => t.topic) || [],
    tickers: item.ticker_sentiment?.map((t) => ({
      ticker: t.ticker,
      sentiment: t.ticker_sentiment_label,
      score: t.ticker_sentiment_score,
    })) || [],
  }));
}

export async function getEconomicIndicator(indicator) {
  const data = await fetchJson({ function: indicator });
  if (!data?.data) return [];
  return data.data.slice(0, 12);
}

export async function getCPI() {
  return getEconomicIndicator("CPI");
}

export async function getFedRate() {
  return getEconomicIndicator("FEDERAL_FUNDS_RATE");
}

export async function getInflation() {
  return getEconomicIndicator("INFLATION");
}

export async function getGDP() {
  return getEconomicIndicator("REAL_GDP");
}

export function formatSentiment(news) {
  if (!news.length) return "";
  let ctx = "\n--- Sentimen Berita (Alpha Vantage) ---\n";
  for (const n of news) {
    const icon = n.sentiment === "Bullish" ? "+" : n.sentiment === "Bearish" ? "-" : "~";
    ctx += `${icon} [${n.sentiment}] ${n.title} (${n.source})\n`;
    if (n.summary) ctx += `  ${n.summary.slice(0, 120)}...\n`;
  }
  const scores = news.filter((n) => n.sentimentScore != null);
  if (scores.length) {
    const avg = scores.reduce((s, n) => s + n.sentimentScore, 0) / scores.length;
    ctx += `\nRata-rata sentimen: ${avg > 0 ? "Positif" : avg < 0 ? "Negatif" : "Netral"} (${avg.toFixed(3)})\n`;
  }
  return ctx;
}

export function formatIndicator(data, name) {
  if (!data?.length) return "";
  const recent = data.slice(0, 3);
  let ctx = `\n${name}:\n`;
  for (const r of recent) {
    ctx += `  ${r.date || r.year}: ${r.value}\n`;
  }
  return ctx;
}
