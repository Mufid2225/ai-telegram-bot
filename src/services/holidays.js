import { createTtlCache } from "../utils/cache.js";

const BASE = "https://tanggalmerah.upset.dev";
const cache = createTtlCache();
const HOLIDAY_TTL_MS = 86_400_000;

export async function checkDate(dateIso) {
  if (typeof dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  return cache.wrap(`holiday:check:${dateIso}`, HOLIDAY_TTL_MS, async () => {
    try {
      const resp = await fetch(`${BASE}/api/check?date=${dateIso}`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data?.success !== true || !data.data) return null;
      return data.data;
    } catch {
      return null;
    }
  });
}

export async function listHolidays(year, month = null, type = null) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) return null;
  const params = new URLSearchParams({ year: String(y) });
  if (month != null) params.set("month", String(month));
  if (type != null) params.set("type", String(type));
  const key = `holiday:list:${y}:${month ?? ""}:${type ?? ""}`;
  return cache.wrap(key, HOLIDAY_TTL_MS, async () => {
    try {
      const resp = await fetch(`${BASE}/api/holidays?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data?.success !== true || !Array.isArray(data.data)) return null;
      return data.data;
    } catch {
      return null;
    }
  });
}

function typeLabel(type) {
  return type === "leave" ? "Cuti Bersama" : "Libur Nasional";
}

export function formatHolidayCheck(data) {
  if (!data) return "";
  const lines = [`Tanggal ${data.date}:`];
  if (data.is_off_day) {
    lines.push(data.is_holiday ? "Libur Nasional" : data.is_leave ? "Cuti Bersama" : "Hari libur");
  } else {
    lines.push("Bukan hari libur (hari kerja)");
  }
  for (const h of data.holidays || []) {
    lines.push(`- ${h.name} (${typeLabel(h.type)}, ${h.day})`);
  }
  return lines.join("\n");
}

export function formatHolidayList(items, year, month = null) {
  if (!items?.length) return "";
  const periode = month != null ? `${year} bulan ${month}` : String(year);
  const lines = [`Tanggal merah Indonesia ${periode}:`];
  for (const h of items) {
    lines.push(`- ${h.date} (${h.day}): ${h.name} — ${typeLabel(h.type)}`);
  }
  return lines.join("\n");
}
