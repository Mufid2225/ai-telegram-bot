const BASE = "https://www.alphavantage.co/query";

async function fetchJson(params) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) return null;
  const url = `${BASE}?${new URLSearchParams({ ...params, apikey: key })}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await resp.json();
    if (data.Note || data.Information || data["Error Message"]) return null;
    return data;
  } catch {
    return null;
  }
}

function extractTimeSeries(data) {
  if (!data) return null;
  const key = Object.keys(data).find(k => k.includes("Time Series"));
  if (!key || !data[key]) return null;
  return Object.entries(data[key]).map(([date, vals]) => {
    const entry = { date };
    const o = Object.keys(vals).find(k => k.includes("open"));
    const h = Object.keys(vals).find(k => k.includes("high"));
    const l = Object.keys(vals).find(k => k.includes("low"));
    const c = Object.keys(vals).find(k => k.includes("close"));
    const v = Object.keys(vals).find(k => k.includes("volume"));
    if (o) entry.open = parseFloat(vals[o]);
    if (h) entry.high = parseFloat(vals[h]);
    if (l) entry.low = parseFloat(vals[l]);
    if (c) entry.close = parseFloat(vals[c]);
    if (v) entry.volume = parseInt(vals[v]);
    return entry;
  });
}

function extractDataArray(data) {
  if (!data?.data) return [];
  return data.data.map(d => ({ date: d.date, value: parseFloat(d.value) }));
}

function extractTechnicalAnalysis(data) {
  if (!data) return null;
  const key = Object.keys(data).find(k => k.includes("Technical Analysis"));
  if (!key || !data[key]) return null;
  return Object.entries(data[key]).map(([date, vals]) => ({
    date,
    ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k.toLowerCase(), parseFloat(v)])),
  }));
}

function formatMarketCap(n) {
  if (!n) return "-";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
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

export async function getCompanyOverview(symbol) {
  const data = await fetchJson({ function: "COMPANY_OVERVIEW", symbol });
  if (!data?.Symbol) return null;
  return {
    symbol: data.Symbol, name: data.Name, description: data.Description,
    sector: data.Sector, industry: data.Industry,
    pe: parseFloat(data.PERatio) || 0,
    eps: parseFloat(data.EPS) || 0,
    marketCap: parseFloat(data.MarketCapitalization) || 0,
    dividendYield: parseFloat(data.DividendYield) || 0,
    beta: parseFloat(data.Beta) || 0,
    high52: parseFloat(data["52WeekHigh"]) || 0,
    low52: parseFloat(data["52WeekLow"]) || 0,
    avg50: parseFloat(data["50DayMovingAverage"]) || 0,
    avg200: parseFloat(data["200DayMovingAverage"]) || 0,
    targetPrice: parseFloat(data.AnalystTargetPrice) || 0,
    revenueTTM: parseFloat(data.RevenueTTM) || 0,
    profitMargin: parseFloat(data.ProfitMargin) || 0,
    returnOnEquity: parseFloat(data.ReturnOnEquityTTM) || 0,
    earningsGrowth: parseFloat(data.QuarterlyEarningsGrowthYOY) || 0,
    revenueGrowth: parseFloat(data.QuarterlyRevenueGrowthYOY) || 0,
  };
}

export async function getEarnings(symbol) {
  const data = await fetchJson({ function: "EARNINGS", symbol });
  if (!data) return null;
  return {
    quarterly: (data.quarterlyEarnings || []).slice(0, 4).map(e => ({
      date: e.fiscalDateEnding,
      reported: e.reportedEPS ? parseFloat(e.reportedEPS) : null,
      estimated: e.estimatedEPS ? parseFloat(e.estimatedEPS) : null,
      surprise: e.surprise ? parseFloat(e.surprise) : null,
    })),
    annual: (data.annualEarnings || []).slice(0, 4).map(e => ({
      date: e.fiscalDateEnding,
      eps: parseFloat(e.reportedEPS),
    })),
  };
}

export async function getTopGainersLosers() {
  const data = await fetchJson({ function: "TOP_GAINERS_LOSERS" });
  if (!data) return null;
  const map = i => ({
    ticker: i.ticker, price: parseFloat(i.price),
    change: parseFloat(i.change_amount), changePct: parseFloat(i.change_percentage),
    volume: parseInt(i.volume),
  });
  return {
    gainers: (data.top_gainers || []).slice(0, 5).map(map),
    losers: (data.top_losers || []).slice(0, 5).map(map),
    active: (data.most_actively_traded || []).slice(0, 5).map(map),
    lastUpdated: data.last_updated,
  };
}

export async function getInsiderTransactions(symbol) {
  const data = await fetchJson({ function: "INSIDER_TRANSACTIONS", symbol });
  if (!data?.data) return [];
  return data.data.slice(0, 10).map(t => ({
    symbol: t.symbol, filingDate: t.filing_date,
    transactionDate: t.transaction_date, type: t.transaction_type,
    shares: parseInt(t.shares) || 0, price: parseFloat(t.transaction_price) || 0,
  }));
}

export async function searchSymbol(keywords) {
  const data = await fetchJson({ function: "SYMBOL_SEARCH", keywords });
  if (!data?.bestMatches) return [];
  return data.bestMatches.map(m => ({
    symbol: m["1. symbol"], name: m["2. name"],
    type: m["3. type"], region: m["4. region"], currency: m["8. currency"],
  }));
}

export async function getMarketStatus() {
  const data = await fetchJson({ function: "MARKET_STATUS" });
  if (!data?.markets) return [];
  return data.markets.map(m => ({
    region: m.region, exchange: m.primary_exchanges,
    status: m.current_status, open: m.local_open, close: m.local_close,
  }));
}

export async function getEconomicIndicator(indicator) {
  const data = await fetchJson({ function: indicator });
  if (!data?.data) return [];
  return data.data.slice(0, 12);
}

export async function getCPI() { return getEconomicIndicator("CPI"); }
export async function getFedRate() { return getEconomicIndicator("FEDERAL_FUNDS_RATE"); }
export async function getInflation() { return getEconomicIndicator("INFLATION"); }
export async function getGDP() { return getEconomicIndicator("REAL_GDP"); }
export async function getGDPPerCapita() { return getEconomicIndicator("REAL_GDP_PER_CAPITA"); }
export async function getTreasuryYield() { return getEconomicIndicator("TREASURY_YIELD"); }
export async function getRetailSales() { return getEconomicIndicator("RETAIL_SALES"); }
export async function getUnemployment() { return getEconomicIndicator("UNEMPLOYMENT"); }
export async function getNonfarmPayroll() { return getEconomicIndicator("NONFARM_PAYROLL"); }

export async function getCommodity(type) {
  return extractDataArray(await fetchJson({ function: type }));
}
export const getWTI = () => getCommodity("WTI");
export const getBrent = () => getCommodity("BRENT");
export const getNaturalGas = () => getCommodity("NATURAL_GAS");
export const getCopper = () => getCommodity("COPPER");
export const getAluminum = () => getCommodity("ALUMINUM");
export const getWheat = () => getCommodity("WHEAT");
export const getCorn = () => getCommodity("CORN");
export const getCotton = () => getCommodity("COTTON");
export const getSugar = () => getCommodity("SUGAR");
export const getCoffee = () => getCommodity("COFFEE");
export const getAllCommodities = () => getCommodity("ALL_COMMODITIES");

export async function getGoldSilverSpot() {
  const data = await fetchJson({ function: "GOLD_SILVER_SPOT" });
  if (!data?.data) return [];
  return data.data.map(d => ({
    date: d.date,
    gold: parseFloat(d.gold) || 0,
    silver: parseFloat(d.silver) || 0,
    unit: d.unit || "USD",
  }));
}

export async function getGoldSilverHistory(range = "5y") {
  const data = await fetchJson({ function: "GOLD_SILVER_HISTORY", range });
  if (!data?.data) return [];
  return data.data.map(d => ({
    date: d.date,
    gold: parseFloat(d.gold) || 0,
    silver: parseFloat(d.silver) || 0,
    unit: d.unit || "USD",
  }));
}

export async function getIntraday(symbol, interval = "60min", outputsize = "compact") {
  return extractTimeSeries(await fetchJson({ function: "TIME_SERIES_INTRADAY", symbol, interval, outputsize }));
}

export async function getDaily(symbol, outputsize = "compact") {
  return extractTimeSeries(await fetchJson({ function: "TIME_SERIES_DAILY", symbol, outputsize }));
}

export async function getWeekly(symbol) {
  return extractTimeSeries(await fetchJson({ function: "TIME_SERIES_WEEKLY", symbol }));
}

export async function getMonthly(symbol) {
  return extractTimeSeries(await fetchJson({ function: "TIME_SERIES_MONTHLY", symbol }));
}

export async function getTechnicalIndicator(indicator, symbol, interval = "daily", timePeriod = 14, seriesType = "close") {
  const params = { function: indicator, symbol, interval };
  if (timePeriod) params.time_period = timePeriod;
  if (seriesType) params.series_type = seriesType;
  return extractTechnicalAnalysis(await fetchJson(params));
}
export const getRSI = (s, i, p) => getTechnicalIndicator("RSI", s, i, p);
export const getSMA = (s, i, p) => getTechnicalIndicator("SMA", s, i, p);
export const getEMA = (s, i, p) => getTechnicalIndicator("EMA", s, i, p);
export const getMACD = (s, i) => getTechnicalIndicator("MACD", s, i);
export const getBBANDS = (s, i, p) => getTechnicalIndicator("BBANDS", s, i, p);
export const getVWAP = (s, i) => getTechnicalIndicator("VWAP", s, i);
export const getATR = (s, i, p) => getTechnicalIndicator("ATR", s, i, p);
export const getSTOCH = (s, i) => getTechnicalIndicator("STOCH", s, i);
export const getCCI = (s, i, p) => getTechnicalIndicator("CCI", s, i, p);
export const getOBV = (s, i) => getTechnicalIndicator("OBV", s, i);
export const getMOM = (s, i, p) => getTechnicalIndicator("MOM", s, i, p);
export const getWILLR = (s, i, p) => getTechnicalIndicator("WILLR", s, i, p);
export const getADX = (s, i, p) => getTechnicalIndicator("ADX", s, i, p);
export const getMFI = (s, i, p) => getTechnicalIndicator("MFI", s, i, p);
export const getSAR = (s, i) => getTechnicalIndicator("SAR", s, i);

export async function getForexIntraday(from, to, interval = "60min") {
  return extractTimeSeries(await fetchJson({ function: "FX_INTRADAY", from_symbol: from, to_symbol: to, interval }));
}
export async function getForexDaily(from, to) {
  return extractTimeSeries(await fetchJson({ function: "FX_DAILY", from_symbol: from, to_symbol: to }));
}

export async function getCryptoExchangeRate(from, to) {
  const data = await fetchJson({ function: "CURRENCY_EXCHANGE_RATE", from_currency: from, to_currency: to });
  if (!data?.["Realtime Currency Exchange Rate"]) return null;
  const r = data["Realtime Currency Exchange Rate"];
  return {
    from: r["1. From_Currency Code"], to: r["3. To_Currency Code"],
    rate: parseFloat(r["5. Exchange Rate"]),
    bid: parseFloat(r["8. Bid Price"]), ask: parseFloat(r["9. Ask Price"]),
    lastRefreshed: r["6. Last Refreshed"],
  };
}

export async function getCryptoDaily(symbol) {
  return extractTimeSeries(await fetchJson({ function: "DIGITAL_CURRENCY_DAILY", symbol, market: "USD" }));
}

export function formatSentiment(news) {
  if (!news.length) return "";
  let ctx = "\n--- Sentimen Berita ---\n";
  for (const n of news) {
    const icon = n.sentiment === "Bullish" ? "+" : n.sentiment === "Bearish" ? "-" : "~";
    ctx += `${icon} [${n.sentiment}] ${n.title} (${n.source})\n`;
    if (n.summary) ctx += `  ${n.summary.slice(0, 120)}...\n`;
  }
  const scores = news.filter(n => n.sentimentScore != null);
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
  for (const r of recent) ctx += `  ${r.date || r.year}: ${r.value}\n`;
  return ctx;
}

export function formatFundamentals(f) {
  if (!f) return "";
  return `
Fundamental ${f.name} (${f.symbol}):
Sektor: ${f.sector} | Industri: ${f.industry}
PE: ${f.pe} | EPS: ${f.eps}
Market Cap: ${formatMarketCap(f.marketCap)}
Dividend Yield: ${(f.dividendYield * 100).toFixed(2)}% | Beta: ${f.beta}
Range 52w: ${f.low52} - ${f.high52}
MA50: ${f.avg50} | MA200: ${f.avg200}
Target Analyst: ${f.targetPrice}
Revenue TTM: ${formatMarketCap(f.revenueTTM)}
Profit Margin: ${(f.profitMargin * 100).toFixed(2)}% | ROE: ${(f.returnOnEquity * 100).toFixed(2)}%
Growth Laba: ${(f.earningsGrowth * 100).toFixed(2)}% | Growth Revenue: ${(f.revenueGrowth * 100).toFixed(2)}%`.trim();
}

export function formatEarnings(earnings) {
  if (!earnings?.quarterly?.length) return "";
  let ctx = "\nEarnings Terbaru:\n";
  for (const e of earnings.quarterly) {
    const est = e.estimated ? `vs ${e.estimated.toFixed(2)}` : "";
    const sur = e.surprise != null ? ` (surprise: ${e.surprise > 0 ? "+" : ""}${e.surprise.toFixed(2)})` : "";
    ctx += `  ${e.date}: ${e.reported?.toFixed(2) || "-"} ${est}${sur}\n`;
  }
  return ctx;
}

export function formatTopGainers(data) {
  if (!data?.gainers?.length) return "";
  let ctx = "\nTop Gainers/Losers:\n";
  ctx += "Gainers: " + data.gainers.map(g => `${g.ticker} (+${g.changePct}%)`).join(", ") + "\n";
  ctx += "Losers: " + data.losers.map(g => `${g.ticker} (${g.changePct}%)`).join(", ") + "\n";
  ctx += "Aktif: " + data.active.slice(0, 3).map(g => `${g.ticker} (vol ${(g.volume / 1e6).toFixed(1)}M)`).join(", ");
  return ctx;
}

export function formatTechnicals(data, name) {
  if (!data?.length) return "";
  const latest = data[0];
  const vals = Object.entries(latest).filter(([k]) => k !== "date").map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(2) : v}`);
  return `\n${name}: ${vals.join(", ")}`;
}

export function formatCommodityPrice(data, name) {
  if (!data?.length) return "";
  const rev = data.slice(0, 2);
  let ctx = `\n${name}:\n`;
  for (const r of rev) ctx += `  ${r.date}: ${r.value}\n`;
  return ctx;
}

export function formatGoldSilver(data) {
  if (!data?.length) return "";
  const rev = data.slice(0, 2);
  let ctx = "\nGold/Silver:\n";
  for (const r of rev) ctx += `  ${r.date}: Gold $${r.gold} | Silver $${r.silver}\n`;
  return ctx;
}

export function formatForex(data, pair) {
  if (!data?.length) return "";
  const rev = data.slice(0, 3);
  let ctx = `\n${pair} (Harian):\n`;
  for (const r of rev) ctx += `  ${r.date}: O=${r.open} H=${r.high} L=${r.low} C=${r.close}\n`;
  return ctx;
}
