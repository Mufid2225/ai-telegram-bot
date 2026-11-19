import { createTtlCache } from "../utils/cache.js";

const BASE = "https://api.coingecko.com/api/v3";
const cache = createTtlCache();

export const COIN_ALIASES = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  bnb: "binancecoin",
  xrp: "ripple",
  doge: "dogecoin",
  ada: "cardano",
  dot: "polkadot",
  avax: "avalanche-2",
  matic: "matic-network",
  link: "chainlink",
  ltc: "litecoin",
  trx: "tron",
  ton: "the-open-network",
  shib: "shiba-inu",
  usdt: "tether",
  usdc: "usd-coin",
};

function demoHeaders() {
  const key = process.env.COINGECKO_API_KEY;
  return key ? { "x-cg-demo-api-key": key } : {};
}

export async function getPrices(ids, vsCurrencies = "idr,usd") {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const idList = ids.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (!idList.length) return null;
  const key = `cg:price:${idList.join(",")}:${vsCurrencies}`;
  return cache.wrap(key, 60_000, async () => {
    try {
      const resp = await fetch(
        `${BASE}/simple/price?ids=${idList.map((id) => encodeURIComponent(id)).join(",")}&vs_currencies=${vsCurrencies}&include_24hr_change=true`,
        { headers: demoHeaders(), signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data || Object.keys(data).length === 0) return null;
      return data;
    } catch {
      return null;
    }
  });
}

export async function searchCoin(query) {
  const q = String(query ?? "").trim();
  if (!q) return null;
  return cache.wrap(`cg:search:${q.toLowerCase()}`, 86_400_000, async () => {
    try {
      const resp = await fetch(`${BASE}/search?query=${encodeURIComponent(q)}`, {
        headers: demoHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!Array.isArray(data?.coins) || data.coins.length === 0) return null;
      return data.coins.slice(0, 5).map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        market_cap_rank: c.market_cap_rank ?? null,
      }));
    } catch {
      return null;
    }
  });
}

export function formatPrices(data, vsCurrency = "idr") {
  if (!data) return "";
  const cur = String(vsCurrency).toLowerCase();
  const lines = [];
  for (const [id, vals] of Object.entries(data)) {
    const price = vals?.[cur];
    if (typeof price !== "number") continue;
    let line = `${id}: ${price.toLocaleString("id-ID")} ${cur.toUpperCase()}`;
    const change = vals?.[`${cur}_24h_change`];
    if (typeof change === "number" && Number.isFinite(change)) {
      const pct = change.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      line += ` (${change >= 0 ? "+" : ""}${pct}% 24 jam)`;
    }
    lines.push(line);
  }
  if (!lines.length) return "";
  return `${lines.join("\n")}\nData: CoinGecko`;
}
