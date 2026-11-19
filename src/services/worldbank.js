import { createTtlCache } from "../utils/cache.js";

const BASE = "https://data360api.worldbank.org";
const cache = createTtlCache();
const WB_TTL_MS = 86_400_000;

export const POPULAR_INDICATORS = {
  "NY.GDP.MKTP.CD": "PDB (GDP) nominal USD",
  "NY.GDP.PCAP.CD": "PDB per kapita USD",
  "FP.CPI.TOTL": "Indeks Harga Konsumen (inflasi)",
  "SP.POP.TOTL": "Populasi total",
  "SL.UEM.TOTL.ZS": "Pengangguran (% angkatan kerja)",
  "SI.POV.DDAY": "Kemiskinan ekstrem ($2.15/hari, %)",
  "SP.DYN.LE00.IN": "Harapan hidup (tahun)",
  "NY.GDP.MKTP.KD.ZG": "Pertumbuhan PDB (%)",
  "NE.EXP.GNFS.ZS": "Ekspor (% PDB)",
  "NE.IMP.GNFS.ZS": "Impor (% PDB)",
  "SP.URB.TOTL.IN.ZS": "Urbanisasi (%)",
  "EN.ATM.CO2E.PC": "Emisi CO2 per kapita (ton)",
};

export async function getData(indicator, country = "IDN", year = null) {
  let id = String(indicator ?? "").trim().toUpperCase().replace(/\./g, "_");
  if (!id) return null;
  if (!id.startsWith("WB_WDI_")) id = `WB_WDI_${id}`;
  // Whitelist alfanumerik/underscore: tolak karakter injeksi (&, #, spasi, dll) sebelum fetch.
  if (!/^[A-Z0-9_]+$/.test(id)) return null;
  const c = String(country ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  let y = null;
  if (year != null) {
    y = Number(year);
    if (!Number.isInteger(y) || y < 1960 || y > 2100) return null;
  }
  const key = `wb:${id}:${c}:${y ?? ""}`;
  return cache.wrap(key, WB_TTL_MS, async () => {
    try {
      let url = `${BASE}/data360/data?DATABASE_ID=WB_WDI&INDICATOR=${id}&REF_AREA=${c}`;
      if (y != null) url += `&TIME_PERIOD=${y}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data?.count || !Array.isArray(data.value) || data.value.length === 0) return null;
      const observations = data.value
        .map((v) => ({ year: v.TIME_PERIOD, value: Number(v.OBS_VALUE), unit: v.UNIT_MEASURE }))
        .filter((o) => Number.isFinite(o.value))
        .sort((a, b) => Number(b.year) - Number(a.year));
      const limited = y != null ? observations : observations.slice(0, 10);
      if (!limited.length) return null;
      return { indicator: id, country: c, observations: limited };
    } catch {
      return null;
    }
  });
}

const UNIT_LABELS = { PS: "jiwa", USD: "USD", PT: "persen" };

export function formatData(result, label) {
  if (!result?.observations?.length) return "";
  const name = label || result.indicator;
  const parts = result.observations.map((o) => {
    const unit = UNIT_LABELS[o.unit] || o.unit || "";
    return `${o.year}: ${o.value.toLocaleString("id-ID")}${unit ? ` ${unit}` : ""}`;
  });
  return `${name} (${result.country}) — Bank Dunia (WDI): ${parts.join("; ")}\nSumber: World Bank Data360 (CC-BY 4.0)`;
}
