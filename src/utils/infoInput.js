// Parser deterministik untuk input teks menu info (pure functions, tanpa fetch/side effect).

const FX_STOPWORDS = new Set([
  "ke", "to", "jadi", "berapa", "kurs", "nilai", "sekarang", "dong", "ya", "please",
]);

// Alias umum (lowercase) → kode ISO 4217.
const FX_ALIASES = {
  dollar: "USD",
  dolar: "USD",
  usd: "USD",
  rupiah: "IDR",
  idr: "IDR",
  euro: "EUR",
  eur: "EUR",
  yen: "JPY",
  jpy: "JPY",
  ringgit: "MYR",
  myr: "MYR",
  sgd: "SGD",
};

// Kode ISO 4217 yang diterima sebagai token 3 huruf langsung.
const FX_ISO_CODES = new Set([
  "USD", "IDR", "EUR", "JPY", "MYR", "SGD", "GBP", "AUD", "NZD", "CAD", "CHF",
  "CNY", "HKD", "TWD", "KRW", "THB", "PHP", "VND", "INR", "PKR", "BDT", "LKR",
  "MMK", "KHR", "LAK", "BND", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD",
  "ILS", "TRY", "RUB", "UAH", "PLN", "CZK", "HUF", "RON", "BGN", "SEK", "NOK",
  "DKK", "ISK", "MXN", "BRL", "ARS", "CLP", "COP", "PEN", "ZAR", "EGP", "NGN",
  "KES", "GHS", "MAD",
]);

/**
 * Parse input kurs, mis. "USD", "usd idr", "USD/IDR", "100 USD ke IDR", "2,5 USD ke EUR",
 * "kurs dollar ke rupiah". Return {base, quote, amount} atau null bila tak ada kode valid.
 */
export function parseFxInput(text) {
  const raw = String(text ?? "").toLowerCase().trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/dolar singapore|dollar singapore/g, "sgd")
    .replace(/[/\-]/g, " ");
  const codes = [];
  let amount = null;
  for (let token of normalized.split(/\s+/)) {
    if (!token || FX_STOPWORDS.has(token)) continue;
    // Koma desimal hanya untuk token angka ("2,5" → "2.5").
    if (/^\d+,\d+$/.test(token)) token = token.replace(",", ".");
    if (/^\d+(\.\d+)?$/.test(token)) {
      if (amount == null) amount = Number(token);
      continue;
    }
    const upper = token.toUpperCase();
    const alias = Object.hasOwn(FX_ALIASES, token) ? FX_ALIASES[token] : null;
    const code = alias ?? (FX_ISO_CODES.has(upper) ? upper : null);
    if (code && !codes.includes(code)) codes.push(code);
  }
  if (!codes.length) return null;
  return { base: codes[0], quote: codes[1] ?? "IDR", amount: amount ?? 1 };
}

const US_TICKER_WHITELIST = new Set([
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "AMD", "INTC", "NFLX",
]);

/**
 * Normalisasi input ticker saham. Tanpa suffix bursa dan bukan whitelist US → tambah ".JK".
 * Return null bila bukan pola ticker (mis. nama perusahaan) agar caller memakai symbol_search.
 */
export function normalizeStockInput(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (raw.includes("=") || raw.includes("^") || raw.toUpperCase().includes("-USD")) {
    return raw.toUpperCase();
  }
  if (!/^[A-Za-z0-9]{1,6}(\.[A-Za-z]{2})?$/.test(raw)) return null;
  const symbol = raw.toUpperCase();
  if (symbol.includes(".")) return symbol;
  if (US_TICKER_WHITELIST.has(symbol)) return symbol;
  return `${symbol}.JK`;
}

// Map negara dipangkas ke ~52 negara paling umum (ASEAN, G20, Eropa, Timur Tengah)
// demi maintainability; tetap pure data publik. Default country: IDN.
const WB_COUNTRIES = {
  indonesia: "IDN", idn: "IDN",
  malaysia: "MYS", mys: "MYS",
  singapore: "SGP", singapura: "SGP", sgp: "SGP",
  usa: "USA", amerika: "USA", america: "USA", us: "USA",
  japan: "JPN", jepang: "JPN", jpn: "JPN",
  china: "CHN", tiongkok: "CHN", chn: "CHN",
  india: "IND", ind: "IND",
  germany: "DEU", jerman: "DEU", deu: "DEU",
  uk: "GBR", inggris: "GBR", britania: "GBR", gbr: "GBR",
  australia: "AUS", aus: "AUS",
  korea: "KOR", kor: "KOR",
  thailand: "THA", tha: "THA",
  vietnam: "VNM", vnm: "VNM",
  philippines: "PHL", filipina: "PHL", phl: "PHL",
  brazil: "BRA", bra: "BRA",
  france: "FRA", prancis: "FRA", fra: "FRA",
  italy: "ITA", italia: "ITA", ita: "ITA",
  canada: "CAN", can: "CAN",
  mexico: "MEX", meksiko: "MEX", mex: "MEX",
  turkey: "TUR", turki: "TUR", tur: "TUR",
  saudi: "SAU", arab: "SAU", sau: "SAU",
  egypt: "EGY", mesir: "EGY", egy: "EGY",
  nigeria: "NGA", nga: "NGA",
  pakistan: "PAK", pak: "PAK",
  bangladesh: "BGD", bgd: "BGD",
  netherlands: "NLD", belanda: "NLD", nld: "NLD",
  spain: "ESP", spanyol: "ESP", esp: "ESP",
  russia: "RUS", rusia: "RUS", rus: "RUS",
  iran: "IRN", irn: "IRN",
  iraq: "IRQ", irq: "IRQ",
  argentina: "ARG", arg: "ARG",
  "south africa": "ZAF", "afrika selatan": "ZAF", zaf: "ZAF",
  "new zealand": "NZL", "selandia baru": "NZL", nzl: "NZL",
  swiss: "CHE", switzerland: "CHE", che: "CHE",
  sweden: "SWE", swe: "SWE",
  norway: "NOR", nor: "NOR",
  denmark: "DNK", dnk: "DNK",
  finland: "FIN", fin: "FIN",
  poland: "POL", polandia: "POL", pol: "POL",
  ukraine: "UKR", ukraina: "UKR", ukr: "UKR",
  greece: "GRC", yunani: "GRC", grc: "GRC",
  portugal: "PRT", prt: "PRT",
  austria: "AUT", aut: "AUT",
  belgium: "BEL", bel: "BEL",
  ireland: "IRL", irl: "IRL",
  hungary: "HUN", hungaria: "HUN", hun: "HUN",
  czech: "CZE", ceko: "CZE", cze: "CZE",
  romania: "ROU", rou: "ROU",
  israel: "ISR", isr: "ISR",
  qatar: "QAT", qat: "QAT",
  emirates: "ARE", uae: "ARE", are: "ARE",
  kuwait: "KWT", kwt: "KWT",
};

// Frasa multi-kata dicek lebih dulu, terpanjang dulu.
const WB_PHRASES = Object.keys(WB_COUNTRIES)
  .filter((key) => key.includes(" "))
  .sort((a, b) => b.length - a.length);

// Kata penghubung yang dibuang dari sisa teks indikator.
const WB_STOPWORDS = new Set([
  "di", "tahun", "negara", "untuk", "dari", "yang", "dan",
  "the", "of", "in", "for", "year", "data",
]);

/**
 * Parse input Bank Dunia, mis. "gdp malaysia" → {indicator:"gdp", country:"MYS"},
 * "inflasi USA 2020" → {indicator:"inflasi", country:"USA", year:2020}.
 * Country default "IDN"; return null bila indicator kosong.
 */
export function parseWorldbankInput(text) {
  let raw = String(text ?? "").trim();
  if (!raw) return null;

  let year = null;
  const yearMatch = raw.match(/\b(?:19|20)\d{2}\b/);
  if (yearMatch) {
    year = Number(yearMatch[0]);
    raw = raw.replace(yearMatch[0], " ");
  }

  let country = null;
  let lower = raw.toLowerCase();
  for (const phrase of WB_PHRASES) {
    if (lower.includes(phrase)) {
      country = WB_COUNTRIES[phrase];
      lower = lower.replace(phrase, " ");
      break;
    }
  }

  const rest = [];
  for (const token of lower.split(/\s+/)) {
    // Buang tanda baca di tepi token; titik di dalam dipertahankan (kode WDI).
    const cleaned = token.replace(/^[^a-z0-9.]+|[^a-z0-9.]+$/g, "");
    if (!cleaned) continue;
    const iso = Object.hasOwn(WB_COUNTRIES, cleaned) ? WB_COUNTRIES[cleaned] : null;
    if (iso) {
      if (!country) country = iso;
      continue;
    }
    if (WB_STOPWORDS.has(cleaned)) continue;
    rest.push(cleaned);
  }

  const indicator = rest.join(" ").trim().toLowerCase();
  if (!indicator) return null;
  const result = { indicator, country: country ?? "IDN" };
  if (year != null) result.year = year;
  return result;
}

const CANCEL_TEXTS = new Set([
  "batal", "batalkan", "cancel", "batalin", "gak jadi", "ga jadi", "tidak jadi",
]);

/** True bila teks adalah perintah batal eksak (trim, case-insensitive). */
export function isCancelText(text) {
  return CANCEL_TEXTS.has(String(text ?? "").trim().toLowerCase());
}

/**
 * Ambil simbol pertama dari output symbol_search berformat "- SYMBOL: Name (...)".
 * Return null bila tidak ada baris yang cocok.
 */
export function extractFirstSymbol(searchResultText) {
  for (const line of String(searchResultText ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+([^\s:]+):/);
    if (match) return match[1];
  }
  return null;
}
