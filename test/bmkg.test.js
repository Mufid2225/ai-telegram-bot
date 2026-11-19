import test from "node:test";
import assert from "node:assert/strict";
import { getLatestQuake, getRecentQuakes, getFeltQuakes, formatQuake, formatQuakeList } from "../src/services/bmkg.js";

const quakeUji = {
  Tanggal: "19 Nov 2026",
  Jam: "13:31:50 WIB",
  DateTime: "2026-11-19T06:31:50+00:00",
  Magnitude: "3.6",
  Kedalaman: "5 km",
  Wilayah: "Pusat gempa berada di wilayah uji",
  Potensi: "Tidak berpotensi tsunami",
  Dirasakan: "III Malili",
  Shakemap: "20261119133150.mmi.jpg",
  Lintang: "2.5 LS",
  Bujur: "121.1 BT",
  Coordinates: "121.1,2.5",
};

// Uji kegagalan dulu: cache module-level belum terisi, jadi null benar-benar dari fetch gagal.
test("bmkg services return null on fetch failure or bad payload without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await getLatestQuake(), null);

  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
  assert.equal(await getRecentQuakes(), null);

  t.mock.method(globalThis, "fetch", async () => new Response("server error", { status: 500 }));
  assert.equal(await getFeltQuakes(), null);
});

test("getLatestQuake wraps the single autogempa object into an array and caches it", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ Infogempa: { gempa: quakeUji } }), { status: 200 });
  });

  const result = await getLatestQuake();
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].Magnitude, "3.6");
  assert.equal(urls[0], "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json");

  const second = await getLatestQuake();
  assert.deepEqual(second, result);
  assert.equal(urls.length, 1);
});

test("getRecentQuakes and getFeltQuakes normalize list responses from their endpoints", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ Infogempa: { gempa: [quakeUji, { ...quakeUji, Magnitude: "5.1" }] } }), { status: 200 });
  });

  const recent = await getRecentQuakes();
  assert.equal(recent.length, 2);
  assert.equal(urls[0], "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json");

  const felt = await getFeltQuakes();
  assert.equal(felt.length, 2);
  assert.equal(urls[1], "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json");
});

test("formatQuake and formatQuakeList include details, shakemap URL, and BMKG attribution", () => {
  const single = formatQuake(quakeUji);
  assert.match(single, /M 3\.6/);
  assert.match(single, /19 Nov 2026 13:31:50 WIB/);
  assert.match(single, /Kedalaman: 5 km/);
  assert.match(single, /Dirasakan: III Malili/);
  assert.match(single, /https:\/\/static\.bmkg\.go\.id\/20261119133150\.mmi\.jpg/);
  assert.equal(formatQuake(quakeUji, { withShakemap: false }).includes("static.bmkg.go.id"), false);

  const list = formatQuakeList([quakeUji], "Gempa terkini");
  assert.match(list, /Gempa terkini:/);
  assert.match(list, /Sumber: BMKG/);
  assert.match(list, /https:\/\/static\.bmkg\.go\.id\/20261119133150\.mmi\.jpg/);
});
