const BASE = "https://financialmodelingprep.com/stable";

async function get(endpoint) {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch(`${BASE}${endpoint}&apikey=${key}`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function getProfile(symbol) {
  const data = await get(`/profile?symbol=${symbol}`);
  if (!data?.[0]?.symbol) return null;
  const p = data[0];
  return {
    symbol: p.symbol,
    name: p.companyName,
    sector: p.sector,
    industry: p.industry,
    description: p.description,
    ceo: p.ceo,
    website: p.website,
    exchange: p.exchange,
    marketCap: p.marketCap,
    beta: p.beta,
    lastDividend: p.lastDividend,
    range52: p.range,
    employees: p.fullTimeEmployees,
    country: p.country,
    image: p.image,
  };
}

export async function getFinancialRatios(symbol) {
  const data = await get(`/ratios-ttm?symbol=${symbol}`);
  if (!data?.[0]?.symbol) return null;
  const r = data[0];
  return {
    pe: r.priceToEarningsRatioTTM,
    pb: r.priceToBookRatioTTM,
    ps: r.priceToSalesRatioTTM,
    pfcf: r.priceToFreeCashFlowRatioTTM,
    eps: r.netIncomePerShareTTM,
    revenuePerShare: r.revenuePerShareTTM,
    bookValuePerShare: r.bookValuePerShareTTM,
    dividendYield: r.dividendYieldTTM,
    dividendPerShare: r.dividendPerShareTTM,
    netProfitMargin: r.netProfitMarginTTM,
    operatingMargin: r.operatingProfitMarginTTM,
    roe: parseFloat((r.netIncomePerShareTTM / r.bookValuePerShareTTM).toFixed(4)) || 0,
    debtToEquity: r.debtToEquityRatioTTM,
    currentRatio: r.currentRatioTTM,
    freeCashFlowPerShare: r.freeCashFlowPerShareTTM,
  };
}

export async function getQuote(symbol) {
  const data = await get(`/quote?symbol=${symbol}`);
  if (!data?.[0]?.symbol) return null;
  const q = data[0];
  return {
    symbol: q.symbol,
    price: q.price,
    change: q.change,
    changePct: q.changePercentage,
    volume: q.volume,
    avgVolume: q.averageVolume,
    marketCap: q.marketCap,
    source: "fmp",
  };
}

export function formatFundamentals(profile, ratios) {
  if (!profile) return "";
  let ctx = `\nFundamental ${profile.name} (${profile.symbol}):\n`;
  ctx += `Sektor: ${profile.sector} | Industri: ${profile.industry}\n`;
  ctx += `Exchange: ${profile.exchange}\n`;
  const mc = profile.marketCap;
  const mcStr = mc >= 1e12 ? `$${(mc / 1e12).toFixed(2)}T` : mc >= 1e9 ? `$${(mc / 1e9).toFixed(2)}B` : `$${(mc / 1e6).toFixed(2)}M`;
  ctx += `Market Cap: ${mcStr}\n`;
  ctx += `Beta: ${profile.beta} | CEO: ${profile.ceo}\n`;
  ctx += `Range 52w: ${profile.range52}\n`;
  if (profile.lastDividend) ctx += `Dividend: $${profile.lastDividend}/sh\n`;

  if (ratios) {
    if (ratios.pe) ctx += `PE: ${ratios.pe.toFixed(2)}\n`;
    if (ratios.eps) ctx += `EPS: $${ratios.eps.toFixed(2)}\n`;
    if (ratios.pb) ctx += `PB: ${ratios.pb.toFixed(2)}\n`;
    if (ratios.ps) ctx += `PS: ${ratios.ps.toFixed(2)}\n`;
    if (ratios.dividendYield) ctx += `Dividend Yield: ${(ratios.dividendYield * 100).toFixed(2)}%\n`;
    if (ratios.netProfitMargin) ctx += `Net Profit Margin: ${(ratios.netProfitMargin * 100).toFixed(2)}%\n`;
    if (ratios.operatingMargin) ctx += `Operating Margin: ${(ratios.operatingMargin * 100).toFixed(2)}%\n`;
    if (ratios.roe) ctx += `ROE: ${(ratios.roe * 100).toFixed(2)}%\n`;
    if (ratios.debtToEquity) ctx += `Debt/Equity: ${ratios.debtToEquity.toFixed(2)}\n`;
    if (ratios.currentRatio) ctx += `Current Ratio: ${ratios.currentRatio.toFixed(2)}\n`;
    if (ratios.freeCashFlowPerShare) ctx += `FCF/Share: $${ratios.freeCashFlowPerShare.toFixed(2)}\n`;
  }
  return ctx;
}
