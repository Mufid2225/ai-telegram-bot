const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

async function searchTavily(query, maxResults = 5) {
  if (!TAVILY_API_KEY) return null;
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: true,
    }),
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function searchNewsapi(query, maxResults = 5) {
  if (!NEWSAPI_KEY) return null;
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const resp = await fetch(
    `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&sortBy=publishedAt&pageSize=${maxResults}&language=id&apiKey=${NEWSAPI_KEY}`
  );
  if (!resp.ok) return null;
  return resp.json();
}

async function searchSerpapi(query, maxResults = 5) {
  if (!SERPAPI_KEY) return null;
  const resp = await fetch(
    `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&engine=google&num=${maxResults}`
  );
  if (!resp.ok) return null;
  return resp.json();
}

function formatTavily(data) {
  let text = `Ringkasan: ${data.answer || ""}\n\n`;
  data.results.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n   Sumber: ${r.url}\n   ${r.content}\n\n`;
  });
  return text;
}

function formatNewsapi(data) {
  let text = "";
  data.articles.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n   ${r.source.name} - ${r.url}\n   ${r.description || ""}\n\n`;
  });
  return text;
}

function formatSerpapi(data) {
  let text = "";
  data.organic_results.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}\n\n`;
  });
  if (data.knowledge_graph) {
    text += `Info: ${data.knowledge_graph.title} - ${data.knowledge_graph.description || ""}\n`;
  }
  return text;
}

export async function webSearch(query, maxResults = 5) {
  for (let retry = 0; retry < 2; retry++) {
    const tavData = await searchTavily(query, maxResults);
    if (tavData && tavData.results && tavData.results.length > 0) return formatTavily(tavData);
    if (retry === 0) await new Promise(r => setTimeout(r, 1000));
  }

  const newsData = await searchNewsapi(query, maxResults);
  if (newsData && newsData.articles && newsData.articles.length > 0) return formatNewsapi(newsData);

  const serpData = await searchSerpapi(query, maxResults);
  if (serpData && serpData.organic_results && serpData.organic_results.length > 0) return formatSerpapi(serpData);

  const simpleQuery = query.replace(/[?\s]+/g, " ").trim().split(" ").slice(-5).join(" ");
  if (simpleQuery !== query) {
    for (let retry = 0; retry < 2; retry++) {
      const tavData2 = await searchTavily(simpleQuery, maxResults);
      if (tavData2 && tavData2.results && tavData2.results.length > 0) return formatTavily(tavData2);
      if (retry === 0) await new Promise(r => setTimeout(r, 1000));
    }

    const serpData2 = await searchSerpapi(simpleQuery, maxResults);
    if (serpData2 && serpData2.organic_results && serpData2.organic_results.length > 0) return formatSerpapi(serpData2);
  }

  return null;
}

export async function newsSearch(query, maxResults = 5, language = "id") {
  if (!NEWSAPI_KEY) return null;
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const resp = await fetch(
    `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&sortBy=publishedAt&pageSize=${maxResults}&language=${language}&apiKey=${NEWSAPI_KEY}`
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.articles || data.articles.length === 0) return null;
  return data.articles.map(a => `- ${a.title} (${a.source.name})\n  ${a.description || ""}`).join("\n");
}

const SEARCH_TRIGGERS = [
  "terbaru", "terkini", "update", "kabar", "info terbaru",
  "berita", "news", "IPO", "listing",
  "baru", "rilis", "launching", "dirilis",
  "perusahaan apa", "siapa", "apa itu",
  "tahun ini", "tahun 202", "bulan ini", "minggu ini",
  "sekarang", "saat ini", "hari ini",
  "prospek", "kabar terbaru", "perkembangan",
  "lowongan", "cpns", "formasi",
];

export function detectSearchNeeded(text) {
  const lower = text.toLowerCase();

  if (SEARCH_TRIGGERS.some(t => lower.includes(t))) return true;

  const qWords = ["apa", "siapa", "bagaimana", "kapan", "dimana", "mengapa", "berapa", "info", "cari"];
  const isQuestion = qWords.some(w => lower.startsWith(w) || lower.includes(` ${w} `));
  const hasCompanySuffix = /[A-Z]{3,4}/.test(text);

  if (isQuestion && hasCompanySuffix) return true;

  if (lower.includes("jel") || lower.includes("rans") || lower.includes("niramas")) return true;

  return false;
}

export function buildSearchQuery(original) {
  let cleaned = original.toLowerCase().trim();

  const stopWords = ["tolong", "bantu", "kak", "bang", "bro", "sis", "gan", "om", "tante", "cariin", "carikan", "kasih tau", "jelasin", "infokan", "gua", "gw", "lu", "lo", "elo"];
  for (const w of stopWords) {
    cleaned = cleaned.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  }

  cleaned = cleaned.replace(/\bcari\b/g, " ").replace(/\binfo\b/g, " ").replace(/\bcek\b/g, " ").replace(/\bliat\b/g, " ").trim();

  cleaned = cleaned.replace(/\bapi\b/g, " ");

  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  let query = words.join(" ");

  const vagueWords = ["terbaru", "terkini", "baru", "update", "kabar", "berita", "info"];
  const onlyVague = words.every(w => vagueWords.includes(w));

  if (query.length < 5 || onlyVague) {
    const fallback = original.toLowerCase().replace(/\b(cari|info|tolong|bantu|kak|bang|bro|gua|gw|lu|lo)\b/gi, " ").replace(/\s+/g, " ").trim();
    query = fallback.length > 3 ? fallback + " Indonesia" : "berita terbaru Indonesia";
  }

  const marketTerms = ["saham", "ipo", "emiten", "forex", "komoditas", "berita ekonomi", "pasar modal", "perusahaan", "emiten"];
  const hasMarketTerm = marketTerms.some(t => query.includes(t));

  const hasYear = /\b20\d{2}\b/.test(query);

  if (hasMarketTerm && !hasYear) {
    query += ` ${new Date().getFullYear()}`;
  }

  return query;
}
