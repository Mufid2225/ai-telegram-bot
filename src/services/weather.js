import { createTtlCache } from "../utils/cache.js";

const cache = createTtlCache();

export async function geocode(location) {
  const q = String(location ?? "").trim();
  if (!q) return null;
  return cache.wrap(`geo:${q.toLowerCase()}`, 86_400_000, async () => {
    try {
      const resp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=id`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.results?.[0] ?? null;
    } catch {
      return null;
    }
  });
}

export async function getForecast(latitude, longitude, timezone = "auto", days = 3) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const requested = Math.trunc(Number(days));
  const d = Number.isFinite(requested) ? Math.min(7, Math.max(1, requested)) : 3;
  const key = `forecast:${lat}:${lon}:${d}:${timezone}`;
  return cache.wrap(key, 900_000, async () => {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&timezone=${encodeURIComponent(timezone)}&forecast_days=${d}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data?.current || !data?.daily) return null;
      return data;
    } catch {
      return null;
    }
  });
}

const WEATHER_CODES = {
  0: "cerah",
  1: "sebagian besar cerah",
  2: "berawan sebagian",
  3: "mendung",
  45: "kabut",
  48: "kabut",
  51: "gerimis ringan",
  53: "gerimis sedang",
  55: "gerimis lebat",
  56: "gerimis beku",
  57: "gerimis beku",
  61: "hujan ringan",
  63: "hujan sedang",
  65: "hujan lebat",
  66: "hujan beku",
  67: "hujan beku",
  71: "salju",
  73: "salju",
  75: "salju",
  77: "butir salju",
  80: "hujan showers ringan",
  81: "hujan showers sedang",
  82: "hujan showers lebat",
  85: "showers salju",
  86: "showers salju",
  95: "badai petir",
  96: "badai petir disertai hujan es",
  99: "badai petir disertai hujan es",
};

export function weatherCodeText(code) {
  return WEATHER_CODES[Number(code)] ?? "tidak diketahui";
}

export function formatForecast(geo, data) {
  if (!data?.current || !data?.daily) return "";
  const loc = [geo?.name, geo?.admin1, geo?.country].filter(Boolean).join(", ");
  const c = data.current;
  const lines = [`Cuaca ${loc || "lokasi"}:`];
  lines.push(
    `Saat ini: ${weatherCodeText(c.weather_code)}, ${c.temperature_2m}°C ` +
    `(terasa seperti ${c.apparent_temperature}°C), kelembapan ${c.relative_humidity_2m}%, ` +
    `angin ${c.wind_speed_10m} km/jam`
  );
  const d = data.daily;
  lines.push("Prakiraan harian:");
  for (let i = 0; i < (d.time?.length || 0); i++) {
    const rain = d.precipitation_probability_max?.[i];
    lines.push(
      `- ${d.time[i]}: ${weatherCodeText(d.weather_code[i])}, ` +
      `${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C, ` +
      `peluang hujan ${rain ?? "-"}%`
    );
  }
  lines.push("Data: Open-Meteo (CC-BY 4.0)");
  return lines.join("\n");
}
