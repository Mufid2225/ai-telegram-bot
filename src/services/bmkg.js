import { createTtlCache } from "../utils/cache.js";

const BASE = "https://data.bmkg.go.id/DataMKG/TEWS/";
const cache = createTtlCache();
const BMKG_TTL_MS = 60_000;

async function fetchQuakes(endpoint) {
  return cache.wrap(`bmkg:${endpoint}`, BMKG_TTL_MS, async () => {
    try {
      const resp = await fetch(`${BASE}${endpoint}`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      const gempa = data?.Infogempa?.gempa;
      if (!gempa) return null;
      const list = Array.isArray(gempa) ? gempa : [gempa];
      return list.length ? list : null;
    } catch {
      return null;
    }
  });
}

export async function getLatestQuake() {
  return fetchQuakes("autogempa.json");
}

export async function getRecentQuakes() {
  return fetchQuakes("gempaterkini.json");
}

export async function getFeltQuakes() {
  return fetchQuakes("gempadirasakan.json");
}

export function formatQuake(q, { withShakemap = true } = {}) {
  if (!q) return "";
  const lines = [
    `Gempa M ${q.Magnitude} — ${q.Wilayah}`,
    `Waktu: ${q.Tanggal} ${q.Jam}`,
    `Kedalaman: ${q.Kedalaman}`,
  ];
  if (q.Potensi) lines.push(`Potensi: ${q.Potensi}`);
  if (q.Dirasakan) lines.push(`Dirasakan: ${q.Dirasakan}`);
  if (withShakemap && q.Shakemap) lines.push(`Shakemap: https://static.bmkg.go.id/${q.Shakemap}`);
  return lines.join("\n");
}

export function formatQuakeList(quakes, label = "Gempa") {
  if (!quakes?.length) return "";
  const body = quakes.map((q, i) => `${i + 1}. ${formatQuake(q)}`).join("\n\n");
  return `${label}:\n${body}\n\nSumber: BMKG`;
}
