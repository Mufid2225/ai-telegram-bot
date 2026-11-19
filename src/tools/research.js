import { webSearch, newsSearch } from "../services/search.js";
import { getQuote, getNews, getMarketNews, buildMarketContext } from "../services/market.js";
import * as alpha from "../services/alpha.js";

function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

const ECONOMIC_INDICATORS = [
  "CPI",
  "FEDERAL_FUNDS_RATE",
  "INFLATION",
  "REAL_GDP",
  "REAL_GDP_PER_CAPITA",
  "TREASURY_YIELD",
  "RETAIL_SALES",
  "UNEMPLOYMENT",
  "NONFARM_PAYROLL",
];

const MAX_OUTPUT_CHARS = 4000;
const TRUNCATION_MARKER = "\n…[output dipotong]";

function cap(text) {
  const s = String(text ?? "");
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function clampMaxResults(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(Math.max(Math.round(n), 1), 8);
}

export const researchTools = [
  fnTool(
    "web_search",
    "Cari informasi terkini di web. Pakai untuk berita/peristiwa/fakta terbaru yang tidak kamu ketahui. Sebutkan sumber/URL dari hasil saat menjawab.",
    {
      query: { type: "string", description: "Kata kunci pencarian" },
      max_results: { type: "integer", description: "Jumlah hasil 1-8 (default 5)" },
    },
    ["query"]
  ),
  fnTool(
    "news_search",
    "Cari berita terbaru berdasarkan kata kunci. Pakai untuk peristiwa/berita terkini; setiap hasil menyertakan URL sumber untuk sitasi.",
    {
      query: { type: "string", description: "Kata kunci berita" },
      language: { type: "string", enum: ["id", "en"], description: "Bahasa berita (default 'id')" },
      max_results: { type: "integer", description: "Jumlah hasil 1-8 (default 5)" },
    },
    ["query"]
  ),
  fnTool(
    "stock_quote",
    "Ambil harga saham/komoditas/forex/crypto terkini beserta berita terkait. Jika kode ticker belum pasti, panggil symbol_search dulu. Saham Indonesia umumnya berakhiran .JK (mis. BBCA.JK).",
    {
      symbol: { type: "string", description: "Kode ticker, mis. 'BBCA.JK', 'AAPL', 'GC=F', 'BTC-USD'" },
    },
    ["symbol"]
  ),
  fnTool(
    "symbol_search",
    "Cari kode ticker saham berdasarkan nama perusahaan/kata kunci. Pakai sebelum stock_quote jika kode ticker belum pasti.",
    {
      keywords: { type: "string", description: "Nama perusahaan atau kata kunci, mis. 'Bank Central Asia'" },
    },
    ["keywords"]
  ),
  fnTool(
    "market_news",
    "Ambil berita pasar terkini. Jika symbol diisi, berita spesifik emiten/aset tersebut; jika kosong, berita pasar/ekonomi umum.",
    {
      symbol: { type: "string", description: "Opsional: kode ticker, mis. 'BBCA.JK'" },
    }
  ),
  fnTool(
    "news_sentiment",
    "Analisis sentimen berita (bullish/bearish/netral) untuk saham atau topik ekonomi. Wajib mengisi minimal salah satu dari symbol atau topics.",
    {
      symbol: { type: "string", description: "Kode ticker, mis. 'BBCA.JK'" },
      topics: { type: "string", description: "Topik dipisah koma, mis. 'economy,financial_markets'" },
    }
  ),
  fnTool(
    "economic_indicator",
    "Ambil data makro ekonomi AS terbaru (CPI, suku bunga Fed, inflasi, GDP, dll.). Pakai untuk pertanyaan data ekonomi; jangan mengarang angka.",
    {
      indicator: { type: "string", enum: ECONOMIC_INDICATORS, description: "Nama indikator ekonomi" },
    },
    ["indicator"]
  ),
];

const GENERIC_FAILURE = "Layanan riset sedang bermasalah. Coba lagi nanti, atau jawab dengan pengetahuan yang ada dan jujur soal keterbatasan.";

export async function executeResearchTool(name, args = {}) {
  try {
    switch (name) {
      case "web_search": {
        const query = String(args.query ?? "").trim();
        if (!query) return "Error: query wajib diisi.";
        const result = await webSearch(query, clampMaxResults(args.max_results));
        return cap(result ?? "Pencarian web sedang gagal/tidak tersedia. Coba query lain atau jawab dengan pengetahuan yang ada dan jujur soal keterbatasan.");
      }
      case "news_search": {
        const query = String(args.query ?? "").trim();
        if (!query) return "Error: query wajib diisi.";
        const language = args.language === "en" ? "en" : "id";
        const result = await newsSearch(query, clampMaxResults(args.max_results), language);
        return cap(result ?? "Pencarian berita sedang gagal/tidak tersedia. Coba web_search dengan query lain, atau jawab dengan pengetahuan yang ada dan jujur soal keterbatasan.");
      }
      case "stock_quote": {
        const symbol = String(args.symbol ?? "").trim().toUpperCase();
        if (!symbol) return "Error: symbol wajib diisi.";
        const quote = await getQuote(symbol);
        if (!quote) return `Simbol ${symbol} tidak ditemukan. Coba symbol_search untuk mencari kode ticker yang benar (saham Indonesia umumnya berakhiran .JK).`;
        const news = await getNews(symbol, 3);
        return cap(buildMarketContext(quote, news));
      }
      case "symbol_search": {
        const keywords = String(args.keywords ?? "").trim();
        if (!keywords) return "Error: keywords wajib diisi.";
        const matches = await alpha.searchSymbol(keywords);
        if (!matches || !matches.length) return `Tidak ada ticker yang cocok untuk "${keywords}". Coba kata kunci lain, mis. nama perusahaan dalam bahasa Inggris.`;
        return cap(matches.slice(0, 5).map((m) => `- ${m.symbol}: ${m.name} (${m.type}, ${m.region}, ${m.currency})`).join("\n"));
      }
      case "market_news": {
        const symbol = args.symbol ? String(args.symbol).trim().toUpperCase() : "";
        const news = symbol ? await getNews(symbol, 5) : await getMarketNews(5);
        if (!news || !news.length) return "Berita market sedang tidak tersedia. Coba lagi nanti atau gunakan web_search/news_search.";
        return cap(news.map((n) => `- ${n.title} (${n.publisher || "sumber tidak diketahui"})${n.link ? `\n  ${n.link}` : ""}`).join("\n"));
      }
      case "news_sentiment": {
        const symbol = args.symbol ? String(args.symbol).trim().toUpperCase() : "";
        const topics = args.topics ? String(args.topics).split(",").map((t) => t.trim()).filter(Boolean) : [];
        if (!symbol && !topics.length) return "Error: isi minimal salah satu dari symbol atau topics.";
        // Alpha Vantage tidak mengenali sufiks bursa (pola sama dengan handlers/market.js /saham).
        const ticker = symbol.replace(".JK", "").replace("=F", "").replace("=X", "").replace("-USD", "");
        const feed = await alpha.getNewsSentiment({ tickers: ticker ? [ticker] : [], topics, limit: 5 });
        const text = alpha.formatSentiment(feed || []);
        return cap(text || "Data sentimen berita sedang tidak tersedia (mungkin kuota/rate-limit API). Coba lagi nanti.");
      }
      case "economic_indicator": {
        const indicator = String(args.indicator ?? "").trim().toUpperCase();
        if (!ECONOMIC_INDICATORS.includes(indicator)) return `Error: indicator tidak dikenal. Pilihan: ${ECONOMIC_INDICATORS.join(", ")}.`;
        const data = await alpha.getEconomicIndicator(indicator);
        const text = alpha.formatIndicator(data, indicator);
        return cap(text || `Data ${indicator} sedang tidak tersedia (mungkin kuota/rate-limit API). Coba lagi nanti atau gunakan web_search.`);
      }
      default:
        return null;
    }
  } catch {
    return GENERIC_FAILURE;
  }
}
