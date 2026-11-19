import test from "node:test";
import assert from "node:assert/strict";
import { checkDate, listHolidays, formatHolidayCheck, formatHolidayList } from "../src/services/holidays.js";

const checkPayload = {
  success: true,
  data: {
    date: "2026-01-01",
    is_holiday: true,
    is_leave: false,
    is_off_day: true,
    holidays: [{ date: "2026-01-01", day: "Kamis", name: "Tahun Baru 2026 Masehi", type: "holiday" }],
  },
  meta: {},
};

test("checkDate validates format, fetches /api/check, formats result, and caches", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(checkPayload), { status: 200 });
  });

  assert.equal(await checkDate("01-01-2026"), null);
  assert.equal(await checkDate("2026-1-1"), null);
  assert.equal(urls.length, 0);

  const data = await checkDate("2026-01-01");
  assert.equal(data.is_holiday, true);
  assert.equal(urls[0], "https://tanggalmerah.upset.dev/api/check?date=2026-01-01");

  const text = formatHolidayCheck(data);
  assert.match(text, /Libur Nasional/);
  assert.match(text, /Tahun Baru 2026 Masehi/);

  const second = await checkDate("2026-01-01");
  assert.deepEqual(second, data);
  assert.equal(urls.length, 1);
});

test("checkDate returns null when success is false or fetch fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
  assert.equal(await checkDate("2026-02-02"), null);

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await checkDate("2026-03-03"), null);
});

test("listHolidays passes month/type params, omits them when null, and validates year", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      success: true,
      data: [
        { date: "2026-01-01", day: "Kamis", name: "Tahun Baru 2026 Masehi", type: "holiday" },
        { date: "2026-01-02", day: "Jumat", name: "Cuti Bersama Tahun Baru", type: "leave" },
      ],
      meta: {},
    }), { status: 200 });
  });

  assert.equal(await listHolidays(2019), null);
  assert.equal(await listHolidays("bukan-tahun"), null);
  assert.equal(urls.length, 0);

  const filtered = await listHolidays(2026, 1, "holiday");
  assert.equal(filtered.length, 2);
  assert.equal(urls[0], "https://tanggalmerah.upset.dev/api/holidays?year=2026&month=1&type=holiday");

  const all = await listHolidays(2026);
  assert.equal(all.length, 2);
  assert.equal(urls[1], "https://tanggalmerah.upset.dev/api/holidays?year=2026");

  const text = formatHolidayList(all, 2026, 1);
  assert.match(text, /Libur Nasional/);
  assert.match(text, /Cuti Bersama/);
  assert.match(text, /Tahun Baru 2026 Masehi/);

  const cached = await listHolidays(2026, 1, "holiday");
  assert.deepEqual(cached, filtered);
  assert.equal(urls.length, 2);
});

test("listHolidays returns null when success is false", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ success: false, data: [] }), { status: 200 }));
  assert.equal(await listHolidays(2027), null);
});
