import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFxInput,
  normalizeStockInput,
  parseWorldbankInput,
  isCancelText,
  extractFirstSymbol,
} from "../src/utils/infoInput.js";

test("parseFxInput: kode ISO, pemisah, alias, jumlah di depan/belakang, desimal titik/koma", () => {
  assert.deepEqual(parseFxInput("USD"), { base: "USD", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("usd idr"), { base: "USD", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("USD/IDR"), { base: "USD", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("USD-IDR"), { base: "USD", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("100 USD ke IDR"), { base: "USD", quote: "IDR", amount: 100 });
  assert.deepEqual(parseFxInput("100 usd idr"), { base: "USD", quote: "IDR", amount: 100 });
  assert.deepEqual(parseFxInput("usd idr 100"), { base: "USD", quote: "IDR", amount: 100 });
  assert.deepEqual(parseFxInput("2.5 USD ke EUR"), { base: "USD", quote: "EUR", amount: 2.5 });
  assert.deepEqual(parseFxInput("2,5 USD ke EUR"), { base: "USD", quote: "EUR", amount: 2.5 });
  assert.deepEqual(parseFxInput("kurs dollar ke rupiah"), { base: "USD", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("100 dolar singapore ke rupiah"), { base: "SGD", quote: "IDR", amount: 100 });
  assert.deepEqual(parseFxInput("berapa kurs yen sekarang dong"), { base: "JPY", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("nilai ringgit ke rupiah please"), { base: "MYR", quote: "IDR", amount: 1 });
  assert.deepEqual(parseFxInput("GBP to JPY"), { base: "GBP", quote: "JPY", amount: 1 });
  assert.deepEqual(parseFxInput("eur 5000"), { base: "EUR", quote: "IDR", amount: 5000 });
});

test("parseFxInput: null bila tidak ada kode ISO valid", () => {
  assert.equal(parseFxInput("halo apa kabar"), null);
  assert.equal(parseFxInput("berapa kurs sekarang"), null);
  assert.equal(parseFxInput("abc xyz"), null);
  assert.equal(parseFxInput("constructor"), null);
  assert.equal(parseFxInput("__proto__"), null);
  assert.equal(parseFxInput(""), null);
  assert.equal(parseFxInput(null), null);
  assert.equal(parseFxInput("   "), null);
});

test("normalizeStockInput: whitelist US, suffix .JK, futures/crypto/index, nama perusahaan null", () => {
  assert.equal(normalizeStockInput("bbca"), "BBCA.JK");
  assert.equal(normalizeStockInput("tlkm"), "TLKM.JK");
  assert.equal(normalizeStockInput("aapl"), "AAPL");
  assert.equal(normalizeStockInput("MSFT"), "MSFT");
  assert.equal(normalizeStockInput("nvda"), "NVDA");
  assert.equal(normalizeStockInput(" bbri.jk "), "BBRI.JK");
  assert.equal(normalizeStockInput("ANTM.JK"), "ANTM.JK");
  assert.equal(normalizeStockInput("GC=F"), "GC=F");
  assert.equal(normalizeStockInput("BTC-USD"), "BTC-USD");
  assert.equal(normalizeStockInput("^gspc"), "^GSPC");
  assert.equal(normalizeStockInput("Bank Central Asia"), null);
  assert.equal(normalizeStockInput(""), null);
  assert.equal(normalizeStockInput(null), null);
});

test("parseWorldbankInput: indikator + negara, default IDN, tahun, kode ISO langsung", () => {
  assert.deepEqual(parseWorldbankInput("gdp malaysia"), { indicator: "gdp", country: "MYS" });
  assert.deepEqual(parseWorldbankInput("populasi"), { indicator: "populasi", country: "IDN" });
  assert.deepEqual(parseWorldbankInput("inflasi USA 2020"), { indicator: "inflasi", country: "USA", year: 2020 });
  assert.deepEqual(parseWorldbankInput("gdp JPN"), { indicator: "gdp", country: "JPN" });
  assert.deepEqual(parseWorldbankInput("pengangguran jerman"), { indicator: "pengangguran", country: "DEU" });
  assert.deepEqual(parseWorldbankInput("gdp di indonesia tahun 2023"), { indicator: "gdp", country: "IDN", year: 2023 });
  assert.deepEqual(parseWorldbankInput("ekspor south africa"), { indicator: "ekspor", country: "ZAF" });
  assert.deepEqual(parseWorldbankInput("populasi singapura"), { indicator: "populasi", country: "SGP" });
  assert.deepEqual(parseWorldbankInput("GDP AMERIKA"), { indicator: "gdp", country: "USA" });
  assert.deepEqual(parseWorldbankInput("gdp constructor"), { indicator: "gdp constructor", country: "IDN" });
});

test("parseWorldbankInput: null bila indicator kosong", () => {
  assert.equal(parseWorldbankInput("JPN"), null);
  assert.equal(parseWorldbankInput("malaysia"), null);
  assert.equal(parseWorldbankInput("indonesia 2020"), null);
  assert.equal(parseWorldbankInput(""), null);
  assert.equal(parseWorldbankInput(null), null);
});

test("isCancelText: hanya teks batal eksak (trim, case-insensitive)", () => {
  for (const text of ["batal", "Batalkan", "CANCEL", " batalin ", "gak jadi", "ga jadi", "tidak jadi"]) {
    assert.equal(isCancelText(text), true, `harus true: ${text}`);
  }
  for (const text of ["batalkan semua", "gak jadi dulu", "ya", "lanjut", "", null]) {
    assert.equal(isCancelText(text), false, `harus false: ${text}`);
  }
});

test("extractFirstSymbol: baris pertama format symbol_search, else null", () => {
  const output = "- BBCA.JK: Bank Central Asia Tbk (Equity, Indonesia, IDR)\n- BBCA: Bank Central Asia (Equity, US, USD)";
  assert.equal(extractFirstSymbol(output), "BBCA.JK");
  assert.equal(extractFirstSymbol("- GC=F: Gold (Future, COMEX, USD)"), "GC=F");
  assert.equal(extractFirstSymbol("- ^GSPC: S&P 500 (Index, US, USD)"), "^GSPC");
  assert.equal(extractFirstSymbol('Tidak ada ticker yang cocok untuk "xyz". Coba kata kunci lain.'), null);
  assert.equal(extractFirstSymbol(""), null);
  assert.equal(extractFirstSymbol(null), null);
});
