import test from "node:test";
import assert from "node:assert/strict";
import { getData, formatData, POPULAR_INDICATORS } from "../src/services/worldbank.js";

test("getData normalizes WDI indicator dots/prefix and defaults country to IDN", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      count: 2,
      value: [
        { OBS_VALUE: "1319000000000", TIME_PERIOD: "2022", UNIT_MEASURE: "USD" },
        { OBS_VALUE: "1371000000000", TIME_PERIOD: "2023", UNIT_MEASURE: "USD" },
      ],
    }), { status: 200 });
  });

  const result = await getData("NY.GDP.MKTP.CD");
  assert.equal(result.indicator, "WB_WDI_NY_GDP_MKTP_CD");
  assert.equal(result.country, "IDN");
  assert.equal(result.observations[0].year, "2023");
  assert.equal(result.observations[0].value, 1371000000000);
  assert.match(urls[0], /DATABASE_ID=WB_WDI/);
  assert.match(urls[0], /INDICATOR=WB_WDI_NY_GDP_MKTP_CD/);
  assert.match(urls[0], /REF_AREA=IDN/);
  assert.equal(urls[0].includes("TIME_PERIOD"), false);

  const cached = await getData("NY.GDP.MKTP.CD");
  assert.deepEqual(cached, result);
  assert.equal(urls.length, 1);
});

test("getData adds TIME_PERIOD for a year and accepts already-prefixed indicators", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      count: 1,
      value: [{ OBS_VALUE: "281190067", TIME_PERIOD: "2023", UNIT_MEASURE: "PS", FREQ: "A" }],
    }), { status: 200 });
  });

  const withYear = await getData("SP.POP.TOTL", "IDN", 2023);
  assert.equal(withYear.observations[0].value, 281190067);
  assert.match(urls[0], /INDICATOR=WB_WDI_SP_POP_TOTL/);
  assert.match(urls[0], /TIME_PERIOD=2023/);

  const prefixed = await getData("WB_WDI_SP_POP_TOTL", "idn");
  assert.equal(prefixed.indicator, "WB_WDI_SP_POP_TOTL");
  assert.equal(prefixed.country, "IDN");
  assert.equal(urls[1].includes("WB_WDI_WB_WDI_"), false);
});

test("getData limits observations to 10 most recent years when no year given", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    count: 12,
    value: Array.from({ length: 12 }, (_, i) => ({
      OBS_VALUE: String(5 + i * 0.1), TIME_PERIOD: String(2010 + i), UNIT_MEASURE: "PT",
    })),
  }), { status: 200 }));

  const result = await getData("SL.UEM.TOTL.ZS");
  assert.equal(result.observations.length, 10);
  assert.equal(result.observations[0].year, "2021");
  assert.equal(result.observations[9].year, "2012");
});

test("getData returns null for count 0, invalid input, or fetch failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ count: 0, value: [] }), { status: 200 }));
  assert.equal(await getData("FP.CPI.TOTL"), null);

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(await getData(""), null);
  assert.equal(await getData("SP.POP.TOTL", "ID"), null);
  assert.equal(await getData("SP.POP.TOTL", "IDN", 1959), null);

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await getData("EN.ATM.CO2E.PC"), null);
});

test("getData rejects indicators with URL injection characters without fetching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(await getData("SP.POP.TOTL&REF_AREA=USA#"), null);
  assert.equal(await getData("SP.POP.TOTL&REF_AREA=USA#", "IDN", 2023), null);
  assert.equal(await getData("NY.GDP.MKTP.CD#"), null);
});

test("formatData renders id-ID numbers, unit labels, and World Bank attribution", () => {
  const result = {
    indicator: "WB_WDI_NY_GDP_MKTP_CD",
    country: "IDN",
    observations: [{ year: "2023", value: 1371000000000, unit: "USD" }],
  };
  const text = formatData(result, "PDB Indonesia");
  assert.match(text, /PDB Indonesia \(IDN\) — Bank Dunia \(WDI\)/);
  assert.match(text, /2023: 1\.371\.000\.000\.000 USD/);
  assert.match(text, /Sumber: World Bank Data360 \(CC-BY 4\.0\)/);

  const pop = formatData({ ...result, observations: [{ year: "2023", value: 281190067, unit: "PS" }] }, "Populasi");
  assert.match(pop, /281\.190\.067 jiwa/);
  const pct = formatData({ ...result, observations: [{ year: "2023", value: 5.2, unit: "PT" }] }, "Pengangguran");
  assert.match(pct, /5,2 persen/);
  const other = formatData({ ...result, observations: [{ year: "2023", value: 7, unit: "XX" }] }, "Uji");
  assert.match(other, /7 XX/);
});

test("POPULAR_INDICATORS contains all documented WDI keys with Indonesian labels", () => {
  const keys = [
    "NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD", "FP.CPI.TOTL", "SP.POP.TOTL",
    "SL.UEM.TOTL.ZS", "SI.POV.DDAY", "SP.DYN.LE00.IN", "NY.GDP.MKTP.KD.ZG",
    "NE.EXP.GNFS.ZS", "NE.IMP.GNFS.ZS", "SP.URB.TOTL.IN.ZS", "EN.ATM.CO2E.PC",
  ];
  for (const k of keys) {
    assert.equal(typeof POPULAR_INDICATORS[k], "string");
    assert.ok(POPULAR_INDICATORS[k].length > 0);
  }
});
