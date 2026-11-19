import { createTtlCache } from "../utils/cache.js";

const cache = createTtlCache();
const FX_TTL_MS = 86_400_000;

// Key ExchangeRate-API berada di PATH URL. Jangan pernah throw/log URL; semua gagal -> null.
async function fetchExchangeRateApi(base, key) {
  try {
    const resp = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/${base}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    // Endpoint v6 ber-key memakai "conversion_rates"; "rates" hanya di endpoint open access.
    const rates = data?.conversion_rates ?? data?.rates;
    if (data?.result !== "success" || !rates) return null;
    const date = data.time_last_update_unix
      ? new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    return { base, rates, date, source: "exchangerate-api" };
  } catch {
    return null;
  }
}

async function fetchFrankfurter(base) {
  try {
    const resp = await fetch(`https://api.frankfurter.dev/v2/rates?base=${base}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const records = await resp.json();
    if (!Array.isArray(records) || records.length === 0) return null;
    const rates = {};
    let date = null;
    for (const r of records) {
      if (!r?.quote) continue;
      const rate = Number(r.rate);
      if (!Number.isFinite(rate)) continue;
      rates[r.quote] = rate;
      if (r.date && (!date || r.date > date)) date = r.date;
    }
    if (!Object.keys(rates).length) return null;
    return { base, rates, date: date || new Date().toISOString().slice(0, 10), source: "frankfurter" };
  } catch {
    return null;
  }
}

export async function getRates(base) {
  const b = String(base ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(b)) return null;
  return cache.wrap(`fx:${b}`, FX_TTL_MS, async () => {
    const key = process.env.EXCHANGERATE_API_KEY;
    if (key) {
      const primary = await fetchExchangeRateApi(b, key);
      if (primary) return primary;
    }
    return fetchFrankfurter(b);
  });
}

export function formatConversion(ratesObj, quote, amount = 1) {
  if (!ratesObj?.rates) return "";
  const q = String(quote ?? "").toUpperCase();
  const rate = ratesObj.rates[q];
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "";
  const amt = Number(amount);
  const n = Number.isFinite(amt) ? amt : 1;
  const fmt = (v) => v.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  // Free plan ExchangeRate-API mensyaratkan atribusi link; Frankfurter (MIT) tidak wajib.
  const sourceLabel =
    ratesObj.source === "frankfurter" ? "Frankfurter" : "ExchangeRate-API — https://www.exchangerate-api.com";
  return `${fmt(n)} ${ratesObj.base} = ${fmt(n * rate)} ${q} (kurs ${ratesObj.date}, sumber: ${sourceLabel}; data diperbarui harian)`;
}
