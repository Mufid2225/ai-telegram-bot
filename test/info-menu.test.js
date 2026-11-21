import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createInputRequestStore } from "../src/services/inputRequest.js";
import { handleMenuCallback, homeKeyboard } from "../src/handlers/menu.js";
import {
  infoKeyboard,
  handleInfoMenuCallback,
  tryHandleInfoInput,
  registerInfoInputGuard,
} from "../src/handlers/info-menu.js";

const USER_ID = "123456789";
const ENV_KEYS = ["TAVILY_API_KEY", "NEWSAPI_KEY", "ALPHA_VANTAGE_KEY"];
const savedEnv = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = "test-key";
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function makeCtx(userId, message = null) {
  const answers = [];
  const edits = [];
  const markups = [];
  const replies = [];
  return {
    from: { id: userId },
    chat: { id: userId },
    message,
    telegram: { sendChatAction: async () => {} },
    answerCbQuery: async (txt) => answers.push(txt ?? ""),
    editMessageText: async (txt, extra) => edits.push({ txt, extra }),
    editMessageReplyMarkup: async (markup) => markups.push(markup),
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 501 };
    },
    _answers: answers,
    _edits: edits,
    _markups: markups,
    _replies: replies,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeStore() {
  const db = createDatabase(":memory:", { quiet: true });
  return { db, store: createInputRequestStore(db) };
}

// Mock lengkap alur yahoo-finance2 (crumb + quote + search news) agar 100% offline.
// Catatan: halaman crumb/cookie yahoo-finance2 selalu /quote/AAPL, apa pun simbol targetnya.
function mockYahooFetch(t, { quoteResult, newsItems = [] }) {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("finance.yahoo.com/quote/AAPL")) {
      return new Response("<html></html>", {
        status: 200,
        headers: {
          "set-cookie": "A3=d=AQABBTestCookieUji; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Domain=.yahoo.com; Path=/; Secure; SameSite=None",
        },
      });
    }
    if (url.includes("/v1/test/getcrumb")) return new Response("test-crumb", { status: 200 });
    if (url.includes("/v7/finance/quote")) {
      return jsonResponse({ quoteResponse: { result: quoteResult ? [quoteResult] : [], error: null } });
    }
    if (url.includes("/v1/finance/search")) {
      return jsonResponse({
        explains: [], count: newsItems.length, quotes: [], news: newsItems, nav: [], lists: [],
        researchReports: [], totalTime: 1, timeTakenForQuotes: 1, timeTakenForNews: 1,
        timeTakenForAlgowatchlist: 1, timeTakenForPredefinedScreener: 1, timeTakenForCrunchbase: 1,
        timeTakenForNav: 1, timeTakenForResearchReports: 1, timeTakenForScreenerField: 1,
        timeTakenForCulturalAssets: 1, timeTakenForSearchLists: 1,
      });
    }
    if (url.includes("registry.npmjs.org")) return jsonResponse({ version: "3.15.3" });
    throw new Error("unexpected fetch in yahoo mock: " + url);
  });
}

function yahooQuoteResult(symbol, shortName, price) {
  return {
    symbol,
    quoteType: "EQUITY",
    shortName,
    language: "en-US",
    region: "US",
    currency: "IDR",
    market: "id_market",
    marketState: "REGULAR",
    exchange: "JKT",
    fullExchangeName: "Jakarta",
    exchangeTimezoneName: "Asia/Jakarta",
    exchangeTimezoneShortName: "WIB",
    gmtOffSetMilliseconds: 25200000,
    esgPopulated: false,
    exchangeDataDelayedBy: 0,
    sourceInterval: 15,
    tradeable: false,
    triggerable: true,
    regularMarketPrice: price,
    regularMarketChange: 10,
    regularMarketChangePercent: 1.01,
    regularMarketDayHigh: price + 10,
    regularMarketDayLow: price - 10,
    regularMarketVolume: 1234567,
  };
}

test("homeKeyboard keeps MoneyTracker hub, legacy rows, and adds Info & Riset before Panduan/Tutup", () => {
  const kb = homeKeyboard();
  const flat = kb.flat().map((b) => b.callback_data);
  for (const cb of [
    "menu:money", "menu:notes", "menu:reminders", "menu:ws:calendar",
    "menu:ws:trello", "menu:ws:notion", "menu:ws:superhuman", "menu:ws:kb", "menu:help", "menu:close",
  ]) {
    assert.ok(flat.includes(cb), `missing legacy callback ${cb}`);
  }
  assert.deepEqual(kb[5], [{ text: "➡️ Info & Riset", callback_data: "menu:page:info" }]);
  assert.equal(kb[4][0].callback_data, "menu:ws:superhuman");
  assert.equal(kb[6][0].callback_data, "menu:help");
});

test("handleMenuCallback page:info swaps to infoKeyboard in-place without editing text", async () => {
  const ctx = makeCtx(USER_ID);
  await handleMenuCallback({ ctx, action: "page:info", allowedUserId: USER_ID });
  assert.deepEqual(ctx._answers, [""]);
  assert.equal(ctx._markups.length, 1);
  assert.deepEqual(ctx._markups[0], { inline_keyboard: infoKeyboard() });
  assert.equal(ctx._edits.length, 0);
  assert.equal(ctx._replies.length, 0);
});

test("handleMenuCallback page:home swaps back to homeKeyboard in-place", async () => {
  const ctx = makeCtx(USER_ID);
  await handleMenuCallback({ ctx, action: "page:home", allowedUserId: USER_ID });
  assert.deepEqual(ctx._answers, [""]);
  assert.equal(ctx._markups.length, 1);
  assert.deepEqual(ctx._markups[0], { inline_keyboard: homeKeyboard() });
  assert.equal(ctx._edits.length, 0);
});

test("page navigation ignores 'message is not modified' and reports other edit failures", async () => {
  const okCtx = makeCtx(USER_ID);
  okCtx.editMessageReplyMarkup = async () => {
    throw new Error("400: Bad Request: message is not modified");
  };
  await handleMenuCallback({ ctx: okCtx, action: "page:info", allowedUserId: USER_ID });
  assert.deepEqual(okCtx._answers, [""]);

  const failCtx = makeCtx(USER_ID);
  failCtx.editMessageReplyMarkup = async () => {
    throw new Error("400: Bad Request: message to edit not found");
  };
  await handleMenuCallback({ ctx: failCtx, action: "page:home", allowedUserId: USER_ID });
  assert.deepEqual(failCtx._answers, ["", "Gagal mengubah tombol. Ketik /menu untuk membuka ulang."]);
});

test("helpView mentions the Info & Riset menu path", async () => {
  const ctx = makeCtx(USER_ID);
  await handleMenuCallback({ ctx, action: "help", allowedUserId: USER_ID, pool: {} });
  assert.match(ctx._edits[0].txt, /➡️ Info & Riset: cuaca, crypto, saham, kurs, berita, Bank Dunia, gempa & libur/);
});

test("info:weather sends force_reply prompt and stores state with the prompt message id", async () => {
  const { db, store } = makeStore();
  try {
    const ctx = makeCtx(USER_ID);
    await handleMenuCallback({ ctx, action: "info:weather", allowedUserId: USER_ID, inputStore: store });
    assert.deepEqual(ctx._answers, [""]);
    assert.equal(ctx._replies.length, 1);
    const { text, extra } = ctx._replies[0];
    assert.match(text, /🌦️ Cek Cuaca/);
    assert.match(text, /Silakan ketik nama kota\/kabupaten, mis\. Malang atau Bandung\./);
    assert.match(text, /Ketik batal untuk membatalkan \(berlaku 5 menit\)/);
    assert.equal(extra.reply_markup.force_reply, true);
    assert.equal(extra.reply_markup.input_field_placeholder, "mis. Malang, Jawa Timur");
    const state = await store.get(USER_ID);
    assert.equal(state.tool, "weather");
    assert.equal(state.promptMessageId, 501);
  } finally {
    db.end();
  }
});

test("info action without inputStore reports feature unavailable", async () => {
  const ctx = makeCtx(USER_ID);
  await handleMenuCallback({ ctx, action: "info:crypto", allowedUserId: USER_ID });
  assert.deepEqual(ctx._answers, ["Fitur info belum tersedia."]);
  assert.equal(ctx._replies.length, 0);
});

test("unknown info action returns null without replying", async () => {
  const { db, store } = makeStore();
  try {
    const ctx = makeCtx(USER_ID);
    const out = await handleInfoMenuCallback({ ctx, action: "tidakada", userId: USER_ID, inputStore: store });
    assert.equal(out, null);
    assert.equal(ctx._replies.length, 0);
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("prototype-named info actions are not prompts; spinner answered, no state stored", async () => {
  const { db, store } = makeStore();
  try {
    for (const action of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const ctx = makeCtx(USER_ID);
      const out = await handleInfoMenuCallback({ ctx, action, userId: USER_ID, inputStore: store });
      assert.equal(out, null, `action ${action} harus null`);
      assert.equal(ctx._replies.length, 0, `action ${action} tidak boleh mengirim prompt`);
      assert.deepEqual(ctx._answers, [""], `action ${action} harus answerCbQuery`);
      assert.equal(await store.get(USER_ID), null, `action ${action} tidak boleh menyimpan state`);
    }
  } finally {
    db.end();
  }
});

test("info:quake fetches BMKG latest and replies without storing state", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    assert.match(String(input), /data\.bmkg\.go\.id\/DataMKG\/TEWS\/autogempa\.json$/);
    return jsonResponse({
      Infogempa: {
        gempa: {
          Magnitude: "5.2",
          Wilayah: "Wilayah Uji",
          Tanggal: "19 Nov 2026",
          Jam: "10:00:00 WIB",
          Kedalaman: "10 km",
          Potensi: "Tidak berpotensi tsunami",
        },
      },
    });
  });
  const { db, store } = makeStore();
  try {
    const ctx = makeCtx(USER_ID);
    await handleInfoMenuCallback({ ctx, action: "quake", userId: USER_ID, inputStore: store });
    assert.deepEqual(ctx._answers, ["Mengambil data BMKG..."]);
    assert.equal(ctx._replies.length, 1);
    assert.match(ctx._replies[0].text, /Gempa M 5\.2 — Wilayah Uji/);
    assert.match(ctx._replies[0].text, /Sumber: BMKG/);
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("info:holiday with empty month falls back to the 3 nearest upcoming holidays", async (t) => {
  const now = new Date();
  const year = now.getFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const mk = (offsetDays, name, type) => {
    const d = new Date(now.getTime() + offsetDays * 86400000);
    return { date: iso(d), day: dayNames[d.getDay()], name, type };
  };
  const past = mk(-5, "Libur Lewat Uji", "holiday");
  const h1 = mk(10, "Libur Uji Satu", "holiday");
  const h2 = mk(20, "Cuti Uji Dua", "leave");
  const h3 = mk(30, "Libur Uji Tiga", "holiday");
  const h4 = mk(40, "Libur Uji Empat", "holiday");

  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    assert.match(url, /tanggalmerah\.upset\.dev\/api\/holidays\?year=/);
    if (url.includes("month=")) return jsonResponse({ success: true, data: [] });
    // Sengaja tidak terurut agar terlihat handler yang mengurutkan.
    return jsonResponse({ success: true, data: [h4, past, h2, h1, h3] });
  });

  const { db, store } = makeStore();
  try {
    const ctx = makeCtx(USER_ID);
    await handleInfoMenuCallback({ ctx, action: "holiday", userId: USER_ID, inputStore: store });
    assert.equal(ctx._replies.length, 1);
    const text = ctx._replies[0].text;
    assert.match(text, /Tidak ada libur\/cuti bersama bulan ini/);
    assert.match(text, /Libur terdekat:/);
    assert.ok(text.includes(`- ${h1.date} (${h1.day}): Libur Uji Satu [Libur Nasional]`));
    assert.ok(text.includes(`- ${h2.date} (${h2.day}): Cuti Uji Dua [Cuti Bersama]`));
    assert.ok(text.includes(`- ${h3.date} (${h3.day}): Libur Uji Tiga [Libur Nasional]`));
    assert.ok(!text.includes(past.date), "holiday lampau harus difilter");
    assert.ok(!text.includes("Libur Uji Empat"), "hanya 3 libur terdekat");
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput weather consumes state and returns Open-Meteo forecast", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("geocoding-api.open-meteo.com")) {
      assert.match(url, /name=Malang/);
      return jsonResponse({
        results: [{ name: "Malang", latitude: -7.98, longitude: 112.63, country: "Indonesia", admin1: "Jawa Timur", timezone: "Asia/Jakarta" }],
      });
    }
    if (url.includes("api.open-meteo.com/v1/forecast")) {
      assert.match(url, /forecast_days=3/);
      return jsonResponse({
        timezone: "Asia/Jakarta",
        current: { time: "2026-11-19T13:00", temperature_2m: 28.4, relative_humidity_2m: 80, apparent_temperature: 32.1, weather_code: 61, wind_speed_10m: 7.2 },
        daily: {
          time: ["2026-11-19", "2026-11-20", "2026-11-21"],
          weather_code: [61, 3, 2],
          temperature_2m_max: [29.5, 30.1, 31.0],
          temperature_2m_min: [22.8, 23.1, 23.5],
          precipitation_probability_max: [70, 40, 20],
        },
      });
    }
    throw new Error("unexpected fetch in weather mock: " + url);
  });

  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "weather", 501);
    // Reply ke pesan prompt itu sendiri tetap diproses.
    const ctx = makeCtx(USER_ID, { text: "Malang", reply_to_message: { message_id: 501 } });
    const out = await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: store });
    assert.match(out, /Cuaca Malang, Jawa Timur, Indonesia/);
    assert.match(out, /Open-Meteo/);
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput reply to a different message returns null and keeps state alive", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch tidak boleh terpanggil untuk reply ke pesan lain");
  });
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "weather", 501);
    const ctx = makeCtx(USER_ID, { text: "Malang", reply_to_message: { message_id: 999 } });
    const out = await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: store });
    assert.equal(out, null);
    assert.equal((await store.get(USER_ID)).tool, "weather");
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput cancel text clears state and confirms", async () => {
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "fx", 501);
    const ctx = makeCtx(USER_ID, { text: "batal" });
    const out = await tryHandleInfoInput({ ctx, text: "batal", userId: USER_ID, inputStore: store });
    assert.equal(out, "✅ Oke, permintaan info dibatalkan.");
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput expired state returns null without executing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch tidak boleh terpanggil untuk state expired");
  });
  const db = createDatabase(":memory:", { quiet: true });
  try {
    let clock = 1000000;
    const store = createInputRequestStore(db, { now: () => clock });
    await store.set(USER_ID, "weather", 501);
    clock += 300001;
    const ctx = makeCtx(USER_ID, { text: "Malang" });
    const out = await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: store });
    assert.equal(out, null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput without state or without store returns null", async () => {
  const { db, store } = makeStore();
  try {
    const ctx = makeCtx(USER_ID, { text: "Malang" });
    assert.equal(await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: store }), null);
    assert.equal(await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: null }), null);
  } finally {
    db.end();
  }
});

test("concurrent tryHandleInfoInput executes the tool exactly once (atomic consume)", async (t) => {
  let fetchCalls = 0;
  // Lokasi & koordinat unik agar tidak terkena cache modul weather dari test lain.
  const location = "Kota Uji Konkuren";
  t.mock.method(globalThis, "fetch", async (input) => {
    fetchCalls++;
    const url = String(input);
    if (url.includes("geocoding-api.open-meteo.com")) {
      return jsonResponse({
        results: [{ name: location, latitude: -1.234, longitude: 45.678, country: "Indonesia", admin1: "Jawa Timur", timezone: "Asia/Jakarta" }],
      });
    }
    if (url.includes("api.open-meteo.com/v1/forecast")) {
      return jsonResponse({
        timezone: "Asia/Jakarta",
        current: { time: "2026-11-19T13:00", temperature_2m: 28.4, relative_humidity_2m: 80, apparent_temperature: 32.1, weather_code: 61, wind_speed_10m: 7.2 },
        daily: {
          time: ["2026-11-19", "2026-11-20", "2026-11-21"],
          weather_code: [61, 3, 2],
          temperature_2m_max: [29.5, 30.1, 31.0],
          temperature_2m_min: [22.8, 23.1, 23.5],
          precipitation_probability_max: [70, 40, 20],
        },
      });
    }
    throw new Error("unexpected fetch in concurrency mock: " + url);
  });

  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "weather", 501);
    // Dua pesan konkuren (pola Promise.all Telegraf per batch) dengan state hidup yang sama.
    const [a, b] = await Promise.all([
      tryHandleInfoInput({ ctx: makeCtx(USER_ID, { text: location }), text: location, userId: USER_ID, inputStore: store }),
      tryHandleInfoInput({ ctx: makeCtx(USER_ID, { text: location }), text: location, userId: USER_ID, inputStore: store }),
    ]);
    const executed = [a, b].filter((r) => r !== null);
    assert.equal(executed.length, 1, "tepat satu panggilan yang mengeksekusi tool");
    assert.match(executed[0], /Cuaca Kota Uji Konkuren, Jawa Timur, Indonesia/);
    assert.equal(fetchCalls, 2, "satu eksekusi weather = geocoding + forecast saja");
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput after manual consume returns null without executing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch tidak boleh terpanggil setelah state di-consume manual");
  });
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "weather", 501);
    assert.equal((await store.consume(USER_ID)).tool, "weather");
    const ctx = makeCtx(USER_ID, { text: "Malang" });
    assert.equal(await tryHandleInfoInput({ ctx, text: "Malang", userId: USER_ID, inputStore: store }), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput fx invalid input returns format hint", async () => {
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "fx", 501);
    const ctx = makeCtx(USER_ID, { text: "halo dunia" });
    const out = await tryHandleInfoInput({ ctx, text: "halo dunia", userId: USER_ID, inputStore: store });
    assert.equal(out, "💱 Format kurs: ketik kode mata uang, mis. USD IDR atau 100 USD ke IDR.");
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput fx same base and quote returns friendly pair hint", async () => {
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "fx", 501);
    const ctx = makeCtx(USER_ID, { text: "IDR" });
    const out = await tryHandleInfoInput({ ctx, text: "IDR", userId: USER_ID, inputStore: store });
    assert.equal(out, "💱 Mata uang asal dan tujuan sama (IDR). Coba pair lain, mis. USD IDR.");
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput stock ticker BBCA normalizes to BBCA.JK and quotes via Yahoo", async (t) => {
  mockYahooFetch(t, {
    quoteResult: yahooQuoteResult("BBCA.JK", "Bank Central Asia Tbk", 9000),
    newsItems: [{
      uuid: "n-bbca-uji-1",
      title: "Berita BBCA Uji",
      publisher: "Penerbit Uji",
      link: "https://example.com/berita-bbca-uji",
      providerPublishTime: 1763500000,
      type: "STORY",
    }],
  });
  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "stock", 501);
    const ctx = makeCtx(USER_ID, { text: "BBCA" });
    const out = await tryHandleInfoInput({ ctx, text: "BBCA", userId: USER_ID, inputStore: store });
    assert.match(out, /\[BBCA\.JK\] Bank Central Asia Tbk/);
    assert.match(out, /Harga: 9000 IDR/);
    assert.match(out, /Berita BBCA Uji/);
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput stock company name searches symbol via AV then quotes via Yahoo", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("alphavantage.co/query")) {
      assert.match(url, /function=SYMBOL_SEARCH/);
      assert.match(url, /keywords=Telkom/);
      return jsonResponse({
        bestMatches: [{
          "1. symbol": "TLKM.JK",
          "2. name": "Telkom Indonesia Tbk",
          "3. type": "Equity",
          "4. region": "Indonesia",
          "8. currency": "IDR",
        }],
      });
    }
    if (url.includes("finance.yahoo.com/quote/AAPL")) {
      return new Response("<html></html>", {
        status: 200,
        headers: {
          "set-cookie": "A3=d=AQABBTestCookieUji; Expires=Fri, 31 Dec 2027 23:59:59 GMT; Domain=.yahoo.com; Path=/; Secure; SameSite=None",
        },
      });
    }
    if (url.includes("/v1/test/getcrumb")) return new Response("test-crumb", { status: 200 });
    if (url.includes("/v7/finance/quote")) {
      return jsonResponse({ quoteResponse: { result: [yahooQuoteResult("TLKM.JK", "Telkom Indonesia Tbk", 3000)], error: null } });
    }
    if (url.includes("/v1/finance/search")) {
      return jsonResponse({
        explains: [], count: 0, quotes: [], news: [], nav: [], lists: [], researchReports: [],
        totalTime: 1, timeTakenForQuotes: 1, timeTakenForNews: 1, timeTakenForAlgowatchlist: 1,
        timeTakenForPredefinedScreener: 1, timeTakenForCrunchbase: 1, timeTakenForNav: 1,
        timeTakenForResearchReports: 1, timeTakenForScreenerField: 1, timeTakenForCulturalAssets: 1,
        timeTakenForSearchLists: 1,
      });
    }
    if (url.includes("registry.npmjs.org")) return jsonResponse({ version: "3.15.3" });
    throw new Error("unexpected fetch in stock-name mock: " + url);
  });

  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "stock", 501);
    const ctx = makeCtx(USER_ID, { text: "Telkom Indonesia" });
    const out = await tryHandleInfoInput({ ctx, text: "Telkom Indonesia", userId: USER_ID, inputStore: store });
    assert.match(out, /\[TLKM\.JK\] Telkom Indonesia Tbk/);
    assert.match(out, /Harga: 3000 IDR/);
    assert.ok(urls.some((u) => u.includes("function=SYMBOL_SEARCH")), "symbol_search harus dipanggil dulu");
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("tryHandleInfoInput news failure falls back to web_search via Tavily", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("newsapi.org")) return jsonResponse({ articles: [] });
    if (url.includes("api.tavily.com/search")) {
      return jsonResponse({
        answer: "Ringkasan uji fallback",
        results: [{ title: "Judul Uji Fallback", url: "https://example.com/uji-fallback", content: "Isi hasil uji fallback" }],
      });
    }
    throw new Error("unexpected fetch in news-fallback mock: " + url);
  });

  const { db, store } = makeStore();
  try {
    await store.set(USER_ID, "news", 501);
    const query = "uji fallback berita info menu";
    const ctx = makeCtx(USER_ID, { text: query });
    const out = await tryHandleInfoInput({ ctx, text: query, userId: USER_ID, inputStore: store });
    assert.match(out, /Ringkasan: Ringkasan uji fallback/);
    assert.match(out, /https:\/\/example\.com\/uji-fallback/);
    assert.equal(await store.get(USER_ID), null);
  } finally {
    db.end();
  }
});

test("registerInfoInputGuard clears live state on bot commands and always calls next", async () => {
  const { db, store } = makeStore();
  try {
    let middleware;
    const bot = { use: (fn) => { middleware = fn; } };
    registerInfoInputGuard(bot, store);
    assert.equal(typeof middleware, "function");

    let nextCalls = 0;
    const next = async () => { nextCalls++; };

    await store.set(USER_ID, "stock", 501);
    await middleware(
      { from: { id: 123456789 }, message: { text: "/menu", entities: [{ type: "bot_command", offset: 0, length: 5 }] } },
      next
    );
    assert.equal(nextCalls, 1);
    assert.equal(await store.get(USER_ID), null);

    // Teks biasa (tanpa entity command) tidak menghapus state.
    await store.set(USER_ID, "fx", 502);
    await middleware({ from: { id: 123456789 }, message: { text: "USD IDR", entities: [] } }, next);
    assert.equal(nextCalls, 2);
    assert.equal((await store.get(USER_ID)).tool, "fx");

    // Update tanpa message (mis. callback) tetap meneruskan next.
    await middleware({ from: { id: 123456789 } }, next);
    assert.equal(nextCalls, 3);
    assert.equal((await store.get(USER_ID)).tool, "fx");
  } finally {
    db.end();
  }
});
