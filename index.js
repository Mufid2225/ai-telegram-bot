import http from "http";
import pool from "./database.js";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import dayjs from "dayjs";
import { getKnowledgeContext } from "./memory.js";
import { detectSymbol, getQuote, getNews, getMarketNews, buildMarketContext } from "./market.js";
import * as alpha from "./alpha.js";
import * as fmp from "./fmp.js";
import { getHistory, getChartUrl, getPeriodLabel } from "./chart.js";
import { webSearch, detectSearchNeeded, buildSearchQuery } from "./search.js";
import Tesseract from "tesseract.js";
import pdf from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const today = new Date();
const dateStr = today.getDate() + " " + months[today.getMonth()] + " " + today.getFullYear();

const bot = new Telegraf(process.env.BOT_TOKEN);

function isImportantMessage(text) {
  const keywords = [
    "tugas",
    "deadline",
    "ujian",
    "jadwal",
    "kuis",
    "praktikum",
    "rapat",
    "reminder",
    "dikumpulkan",
    "presentasi",
    "pr",
    "mapel",
  ];
  return keywords.some((keyword) =>
    text.toLowerCase().includes(keyword)
  );
}

function parseDeadline(text) {
  const lower = text.toLowerCase();
  const today = dayjs();

  if (lower.includes("besok")) {
    return today.add(1, "day").format("YYYY-MM-DD");
  }

  const days = {
    senin: 1,
    selasa: 2,
    rabu: 3,
    kamis: 4,
    jumat: 5,
    sabtu: 6,
    minggu: 0,
  };

  for (const day in days) {
    if (lower.includes(day)) {
      let target = today.day(days[day]);
      if (target.isBefore(today)) {
        target = target.add(7, "day");
      }
      return target.format("YYYY-MM-DD");
    }
  }

  return null;
}

function extractTaskInfo(text) {
  const lower = text.toLowerCase();
  let type = "catatan";

  if (lower.includes("tugas") || lower.includes("pr")) {
    type = "tugas";
  } else if (lower.includes("ujian") || lower.includes("kuis")) {
    type = "ujian";
  }

  const subjects = [
    "matematika",
    "fisika",
    "kimia",
    "sejarah",
    "bahasa",
    "inggris",
    "pkn",
    "agama",
  ];

  let subject = null;
  for (const s of subjects) {
    if (lower.includes(s)) {
      subject = s;
      break;
    }
  }

  const deadline = parseDeadline(text);

  return { type, subject, deadline };
}

async function saveMemory({ userId, extracted, content, fileId = null, fileType = null }) {
  await pool.query(
    `INSERT INTO memories (user_id, type, subject, deadline, content, file_id, file_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, extracted.type, extracted.subject, extracted.deadline, content, fileId, fileType, new Date().toISOString()]
  );
}

async function saveConversation({ userId, role, content }) {
  await pool.query(
    `INSERT INTO conversations (user_id, role, content, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, role, content, new Date().toISOString()]
  );
}

bot.command("tugas", async (ctx) => {
  try {
    const result = await pool.query(
      `SELECT * FROM memories
       WHERE user_id = $1 AND type = 'tugas'
       ORDER BY id DESC LIMIT 10`,
      [ctx.from.id]
    );
    const tasks = result.rows;

    if (tasks.length === 0) {
      return ctx.reply("Tidak ada tugas tersimpan.");
    }

    for (const task of tasks) {
      const text = `
🆔 ID: ${task.id}
📚 Mapel: ${task.subject || "-"}
📅 Deadline: ${task.deadline || "-"}
📝 Isi: ${task.content}
`;

      if (task.file_type === "photo") {
        await ctx.replyWithPhoto(task.file_id, { caption: text });
      } else {
        await ctx.reply(text);
      }
    }
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal mengambil tugas.");
  }
});

bot.command("hapus", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const id = args[1];

    if (!id) {
      return ctx.reply("Gunakan: /hapus ID");
    }

    const result = await pool.query(
      `DELETE FROM memories WHERE id = $1 AND user_id = $2`,
      [id, ctx.from.id]
    );

    if (result.rowCount === 0) {
      return ctx.reply("Tugas tidak ditemukan.");
    }

    await ctx.reply("Tugas berhasil dihapus.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal menghapus tugas.");
  }
});

bot.command("update", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const id = args[1];
    const field = args[2];
    const value = args.slice(3).join(" ");

    if (!id || !field || !value) {
      return ctx.reply(`Gunakan:\n/update ID field value\n\nContoh:\n/update 3 deadline 2026-05-15`);
    }

    const allowedFields = ["subject", "deadline", "content", "type"];
    if (!allowedFields.includes(field)) {
      return ctx.reply("Field tidak valid.");
    }

    const result = await pool.query(
      `UPDATE memories SET ${field} = $1 WHERE id = $2 AND user_id = $3`,
      [value, id, ctx.from.id]
    );

    if (result.rowCount === 0) {
      return ctx.reply("Task tidak ditemukan.");
    }

    await ctx.reply("Task berhasil diupdate.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal update task.");
  }
});

bot.command("remind", async (ctx) => {
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");

    const result = await pool.query(
      `SELECT * FROM memories
       WHERE user_id = $1 AND type = 'tugas'
       AND (deadline = $2 OR deadline = $3)
       ORDER BY deadline ASC`,
      [ctx.from.id, today, tomorrow]
    );
    const tasks = result.rows;

    if (tasks.length === 0) {
      return ctx.reply("Tidak ada deadline hari ini atau besok.");
    }

    let text = "⏰ Reminder Tugas:\n";
    for (const task of tasks) {
      text += `

🆔 ${task.id}
📚 ${task.subject || "-"}
📅 ${task.deadline}
📝 ${task.content}`;
    }

    await ctx.reply(text);
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal mengambil reminder.");
  }
});

bot.command("test", async (ctx) => {
  try {
    const resp = await fetch(`${process.env.ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ROUTER_API_KEY}` },
      body: JSON.stringify({ model: process.env.ROUTER_MODEL, messages: [{ role: "user", content: "hai" }], stream: false }),
    });
    if (resp.status === 429 || resp.status === 503) {
      const text = await resp.text();
      await ctx.reply(`API sibuk (${resp.status}): ${text.slice(0, 100)}`);
      return;
    }
    const text = await resp.text();
    await ctx.reply(`Status: ${resp.status}\nResponse: ${text.slice(0, 200)}`);
  } catch (e) {
    await ctx.reply(`Fetch error: ${e.cause || e.code || e.message}`);
  }
});

// ── Web Search Command ──────────────────────────────

bot.command("cari", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const rawQuery = args.slice(1).join(" ");
    if (!rawQuery) return ctx.reply("Contoh: /cari IPO terbaru Indonesia 2026");

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
    const searchQuery = buildSearchQuery(rawQuery);
    const searchResult = await webSearch(searchQuery, 8);
    console.log(`[/cari] "${rawQuery}" → "${searchQuery}" → ${searchResult ? "OK" : "NULL"}`);
    if (!searchResult) {
      return ctx.reply("Gagal dapetin info. Coba langsung buka idx.co.id atau eipo.ksei.co.id.");
    }

    const messages = [
      {
        role: "system",
        content: `
Kamu asisten yang santai dan helpful.

Gaya bicara:
- Natural, santai, kayak ngobrol
- JANGAN pakai emoji
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- JANGAN ngarang informasi

Hari ini: ${dateStr}.

Informasi terkini:
${searchResult}`,
      },
      { role: "user", content: query },
    ];

    const reply = await callAI(messages, ctx);
    await ctx.reply(reply);
  } catch (error) {
    console.error("/cari error:", error);
    await ctx.reply(`Gagal mencari: ${error.message}`);
  }
});

// ── Trading Commands ─────────────────────────────────

bot.command("saham", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const raw = args.slice(1).join(" ");
    if (!raw) return ctx.reply("Contoh: /saham BBCA atau /saham AAPL");

    let symbol = raw.toUpperCase();
    if (!symbol.includes(".") && !symbol.includes("=") && !symbol.includes("^")) {
      const usStocks = ["AAPL","MSFT","GOOGL","AMZN","TSLA","META","NVDA","AMD","INTC","NFLX"];
      if (!usStocks.includes(symbol)) symbol += ".JK";
    }

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const ticker = symbol.replace(".JK", "").replace("=F", "").replace("=X", "").replace("-USD", "");
    const [quote, news, avSentiment, fundamental, ratios, earnings, rsi, topMovers, history] = await Promise.all([
      getQuote(symbol),
      getNews(symbol, 4),
      alpha.getNewsSentiment({ tickers: [ticker], limit: 4 }),
      fmp.getProfile(ticker).catch(() => null),
      fmp.getFinancialRatios(ticker).catch(() => null),
      alpha.getEarnings(ticker).catch(() => null),
      alpha.getRSI(ticker).catch(() => null),
      alpha.getTopGainersLosers().catch(() => null),
      getHistory(symbol, "1m").catch(() => null),
    ]);

    if (!quote) return ctx.reply(`Data saham "${raw}" tidak ditemukan. Coba kode yang benar (contoh: BBCA.JK, AAPL).`);

    if (history && history.length >= 2) {
      const chartUrl = await getChartUrl(`${quote.symbol} (${getPeriodLabel("1m")})`, history, "1m", "line", "dark");
      if (chartUrl) {
        await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
        ctx.replyWithPhoto(chartUrl, { caption: `Chart ${quote.symbol} - ${getPeriodLabel("1m")}` }).catch(() => {});
      }
    }

    let marketCtx = buildMarketContext(quote, news) + alpha.formatSentiment(avSentiment);
    if (fundamental || ratios) marketCtx += "\n" + fmp.formatFundamentals(fundamental, ratios);
    if (earnings) marketCtx += "\n" + alpha.formatEarnings(earnings);
    if (rsi) marketCtx += "\n" + alpha.formatTechnicals(rsi, "RSI (14)");
    if (topMovers) marketCtx += "\n" + alpha.formatTopGainers(topMovers);
    const messages = [
      {
        role: "system",
        content: `
Kamu analis saham profesional.

Gaya bicara:
- Natural, santai, kayak ngobrol
- JANGAN pakai emoji
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- JANGAN ngarang tanggal.
- Hari ini: ${dateStr}.

Tugas:
Analisa saham ${quote.name} (${quote.symbol}) berdasarkan data real-time.
Berikan pendapat apakah saham ini menarik, potensi risikonya, dan sentimen dari berita terbaru.
${marketCtx}`,
      },
      {
        role: "user",
        content: `Analisa saham ${quote.symbol} (${quote.name}) untuk hari ini.`,
      },
    ];

    const reply = await callAI(messages, ctx);
    await ctx.reply(reply);
  } catch (error) {
    console.error("/saham error:", error);
    await ctx.reply(`Gagal analisa saham: ${error.message}`);
  }
});

bot.command("trade", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const raw = args.slice(1).join(" ");
    if (!raw) return ctx.reply("Contoh: /trade XAUUSD, /trade EURUSD, /trade BTC");

    let symbol = detectSymbol(raw);
    if (!symbol) {
      const upper = raw.toUpperCase();
      if (["GC","SI","CL","NG"].includes(upper)) symbol = `${upper}=F`;
      else if (["XAUUSD","XAGUSD","EURUSD","GBPUSD","USDJPY","USDCAD","AUDUSD","NZDUSD"].includes(upper)) symbol = `${upper}=X`;
      else if (["BTC","ETH"].includes(upper)) symbol = `${upper}-USD`;
      else symbol = raw;
    }

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const isForex = symbol.includes("=X");
    const isCrypto = symbol.includes("-USD");
    const isCommodity = ["GC=F", "SI=F", "CL=F", "NG=F"].includes(symbol);

    const [quote, news, avSentiment, rsi, bb, forexData, commodityPrice, goldSilver, history] = await Promise.all([
      getQuote(symbol),
      getNews(raw, 4),
      alpha.getNewsSentiment({ topics: ["commodities", "forex", "financial_markets"], limit: 4 }),
      alpha.getRSI(symbol).catch(() => null),
      alpha.getBBANDS(symbol).catch(() => null),
      isForex ? alpha.getForexDaily(symbol.replace("=X", "").slice(0, 3), symbol.replace("=X", "").slice(3)).catch(() => null) : null,
      isCommodity && !["GC=F", "SI=F"].includes(symbol) ? alpha.getCommodity({ "CL=F": "WTI", "NG=F": "NATURAL_GAS" }[symbol]).catch(() => null) : null,
      isCommodity && ["GC=F", "SI=F"].includes(symbol) ? alpha.getGoldSilverSpot().catch(() => null) : null,
      getHistory(symbol, "1m").catch(() => null),
    ]);

    if (!quote) return ctx.reply(`Data untuk "${raw}" tidak ditemukan. Coba kode yang benar.`);

    if (history && history.length >= 2) {
      const chartUrl = await getChartUrl(`${quote.symbol} (${getPeriodLabel("1m")})`, history, "1m", "line", "dark");
      if (chartUrl) {
        await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
        ctx.replyWithPhoto(chartUrl, { caption: `Chart ${quote.symbol} - ${getPeriodLabel("1m")}` }).catch(() => {});
      }
    }

    let marketCtx = buildMarketContext(quote, news) + alpha.formatSentiment(avSentiment);
    if (rsi) marketCtx += "\n" + alpha.formatTechnicals(rsi, "RSI (14)");
    if (bb) marketCtx += "\n" + alpha.formatTechnicals(bb, "Bollinger Bands");
    if (forexData) marketCtx += "\n" + alpha.formatForex(forexData, symbol.replace("=X", ""));
    if (commodityPrice) marketCtx += "\n" + alpha.formatCommodityPrice(commodityPrice, symbol === "CL=F" ? "Minyak Mentah (WTI)" : "Natural Gas");
    if (goldSilver) marketCtx += "\n" + alpha.formatGoldSilver(goldSilver);
    const messages = [
      {
        role: "system",
        content: `
Kamu analis trading profesional.

Gaya bicara:
- Natural, santai, kayak ngobrol
- JANGAN pakai emoji
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- JANGAN ngarang tanggal.
- Hari ini: ${dateStr}.

Tugas:
Analisa ${quote.name} (${quote.symbol}) berdasarkan data real-time.
Berikan pandangan teknikal singkat, sentimen pasar, dan level penting (support/resistance).
${marketCtx}`,
      },
      {
        role: "user",
        content: `Analisa ${quote.symbol} (${quote.name}) untuk trading hari ini.`,
      },
    ];

    const reply = await callAI(messages, ctx);
    await ctx.reply(reply);
  } catch (error) {
    console.error("/trade error:", error);
    await ctx.reply(`Gagal analisa: ${error.message}`);
  }
});

bot.command("ekonomi", async (ctx) => {
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const [news, cpi, fedRate, inflation, gdp, unemployment, treasury, retail, wti, goldSilver, topMovers] = await Promise.all([
      getMarketNews(6),
      alpha.getCPI(),
      alpha.getFedRate(),
      alpha.getInflation(),
      alpha.getGDP().catch(() => null),
      alpha.getUnemployment().catch(() => null),
      alpha.getTreasuryYield().catch(() => null),
      alpha.getRetailSales().catch(() => null),
      alpha.getWTI().catch(() => null),
      alpha.getGoldSilverSpot().catch(() => null),
      alpha.getTopGainersLosers().catch(() => null),
    ]);

    let ecoCtx = "";
    if (news.length) {
      ecoCtx = "Berita terkini:\n" + news.map((n, i) => `${i + 1}. ${n.title}`).join("\n");
    }
    ecoCtx += alpha.formatIndicator(cpi, "CPI (Inflasi Konsumen)");
    ecoCtx += alpha.formatIndicator(fedRate, "Fed Funds Rate");
    ecoCtx += alpha.formatIndicator(inflation, "Inflasi (CPI) Tahunan");
    if (gdp) ecoCtx += alpha.formatIndicator(gdp, "GDP Riil");
    if (unemployment) ecoCtx += alpha.formatIndicator(unemployment, "Tingkat Pengangguran");
    if (treasury) ecoCtx += alpha.formatIndicator(treasury, "Treasury Yield");
    if (retail) ecoCtx += alpha.formatIndicator(retail, "Retail Sales");
    if (wti) ecoCtx += alpha.formatCommodityPrice(wti, "Minyak Mentah (WTI)");
    if (goldSilver) ecoCtx += alpha.formatGoldSilver(goldSilver);
    if (topMovers) ecoCtx += alpha.formatTopGainers(topMovers);

    if (!ecoCtx.trim()) return ctx.reply("Belum ada data ekonomi terkini.");

    const messages = [
      {
        role: "system",
        content: `
Kamu analis ekonomi.

Gaya bicara:
- Natural, santai, kayak ngobrol
- JANGAN pakai emoji
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- JANGAN ngarang tanggal/tahun kalo gak ada di data.

Tugas:
Rangkum data ekonomi terkini, kaitkan dengan dampaknya ke pasar saham, komoditas, dan forex.

${ecoCtx}`,
      },
      {
        role: "user",
        content: "Analisa data ekonomi hari ini dan dampaknya ke market.",
      },
    ];

    const reply = await callAI(messages, ctx);
    await ctx.reply(reply);
  } catch (error) {
    console.error("/ekonomi error:", error);
    await ctx.reply(`Gagal ambil berita: ${error.message}`);
  }
});

bot.on("photo", async (ctx) => {
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || "";

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const link = await bot.telegram.getFileLink(photo.file_id);
    const resp = await fetch(link);
    const buffer = Buffer.from(await resp.arrayBuffer());

    const { data } = await Tesseract.recognize(buffer, "ind+eng");
    const ocrText = data.text.trim();

    if (caption) {
      const extracted = extractTaskInfo(caption);
      await saveMemory({ userId: ctx.from.id, extracted, content: caption, fileId: photo.file_id, fileType: "photo" });
    }

    const text = caption
      ? `User kirim foto. Caption: ${caption}\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`
      : `User kirim foto.\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`;

    await saveConversation({ userId: ctx.from.id, role: "user", content: text });

    const msg = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- Ga usah kaku, santai aja

User baru kirim foto. Ini hasil OCR-nya. Bantu user.`,
      },
      { role: "user", content: text },
    ];

    const reply = await callAI(msg, ctx);
    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Photo error:", error);
    await ctx.reply(`Gagal proses foto: ${error.message}`);
  }
});

function stripMarkdown(text) {
  return text.replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1").replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
}

async function callAI(messages, ctx) {
  for (let retry = 0; retry < 3; retry++) {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const resp = await fetch(`${process.env.ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.ROUTER_MODEL,
        messages,
        stream: false,
      }),
    });

    if ((resp.status === 429 || resp.status === 503) && retry < 2) {
      await new Promise(r => setTimeout(r, 3000 * (retry + 1)));
      continue;
    }

    if (!resp.ok) {
      return `AI error (${resp.status})`;
    }

    const raw = await resp.text();
    if (!raw.trim()) continue;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      const lines = raw.split("\n");
      let content = "";
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
              content += chunk.choices[0].delta.content;
            }
          } catch {}
        }
      }
      if (content) return stripMarkdown(content);
      return "Maaf, respon AI kosong.";
    }

    const choice = data.choices && data.choices[0];
    if (!choice) return "Maaf, respon AI kosong.";

    const content = choice.message.content;
    if (content && content.trim()) return stripMarkdown(content);
    return "Maaf, respon AI kosong.";
  }
  return "AI sibuk, coba lagi nanti.";
}

bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text;

  try {
    await saveConversation({ userId: ctx.from.id, role: "user", content: userMessage });

    if (isImportantMessage(userMessage)) {
      const extracted = extractTaskInfo(userMessage);
      await saveMemory({ userId: ctx.from.id, extracted, content: userMessage });
    }

    const convResult = await pool.query(
      `SELECT role, content FROM conversations
       WHERE user_id = $1 ORDER BY id DESC LIMIT 10`,
      [ctx.from.id]
    );
    const conversations = convResult.rows.reverse();

    const words = userMessage.toLowerCase().split(" ").filter(w => w.length > 2);
    let memories = [];
    if (words.length > 0) {
      const conditions = words.map((_, i) => `content ILIKE $${i + 1}`);
      const values = words.map(w => `%${w}%`);
      values.push(ctx.from.id);
      const memResult = await pool.query(
        `SELECT * FROM memories WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")}) ORDER BY id DESC LIMIT 5`,
        values
      );
      memories = memResult.rows;
    }

    const memoryContext = memories.length > 0
      ? memories.reverse().map(m => `Type: ${m.type}\nSubject: ${m.subject || "-"}\nDeadline: ${m.deadline || "-"}\nContent: ${m.content}`).join("\n---\n")
      : "Tidak ada memory relevan.";

    const knowledgeContext = await getKnowledgeContext(ctx.from.id);

    let marketCtx = "";
    const lowerMsg = userMessage.toLowerCase();
    const detectedSymbol = detectSymbol(userMessage);
    if (detectedSymbol) {
      const [q, n, av, rsi, profile, ratios, history] = await Promise.all([
        getQuote(detectedSymbol),
        getNews(detectedSymbol, 3),
        alpha.getNewsSentiment({ tickers: [detectedSymbol], limit: 3 }),
        alpha.getRSI(detectedSymbol).catch(() => null),
        fmp.getProfile(detectedSymbol).catch(() => null),
        fmp.getFinancialRatios(detectedSymbol).catch(() => null),
        getHistory(detectedSymbol, "1m").catch(() => null),
      ]);
      if (q) {
        marketCtx = buildMarketContext(q, n) + alpha.formatSentiment(av);
        if (rsi) marketCtx += "\n" + alpha.formatTechnicals(rsi, "RSI (14)");
        if (profile || ratios) marketCtx += "\n" + fmp.formatFundamentals(profile, ratios);
        if (history && history.length >= 2) {
          const chartUrl = await getChartUrl(`${q.symbol} (${getPeriodLabel("1m")})`, history, "1m", "line", "dark");
          if (chartUrl) {
            ctx.replyWithPhoto(chartUrl, { caption: `Chart ${q.symbol} - ${getPeriodLabel("1m")}` }).catch(() => {});
          }
        }
      }
    } else {
      const marketWords = ["saham", "forex", "komoditas", "cpi", "ppi", "inflasi", "suku bunga", "trading", "analisa", "berita ekonomi", "emas", "minyak", "xauusd", "btc", "bitcoin", "eurusd", "ihsg", "ekonomi", "pasar"];
      if (marketWords.some(w => lowerMsg.includes(w))) {
        const [macroNews, avMacro, cpi, fedRate, goldSilver, wti] = await Promise.all([
          getMarketNews(3),
          alpha.getNewsSentiment({ topics: ["economy", "financial_markets"], limit: 3 }),
          lowerMsg.includes("cpi") || lowerMsg.includes("inflasi") ? alpha.getCPI().catch(() => null) : null,
          lowerMsg.includes("suku bunga") || lowerMsg.includes("fed") ? alpha.getFedRate().catch(() => null) : null,
          lowerMsg.includes("emas") || lowerMsg.includes("gold") || lowerMsg.includes("silver") ? alpha.getGoldSilverSpot().catch(() => null) : null,
          lowerMsg.includes("minyak") || lowerMsg.includes("wti") || lowerMsg.includes("crude") ? alpha.getWTI().catch(() => null) : null,
        ]);
        if (macroNews.length) {
          marketCtx = "\n--- Berita Ekonomi Terkini ---\n" + macroNews.map(n => `- ${n.title}`).join("\n");
        }
        marketCtx += alpha.formatSentiment(avMacro);
        if (cpi) marketCtx += alpha.formatIndicator(cpi, "CPI");
        if (fedRate) marketCtx += alpha.formatIndicator(fedRate, "Fed Rate");
        if (goldSilver) marketCtx += alpha.formatGoldSilver(goldSilver);
        if (wti) marketCtx += alpha.formatCommodityPrice(wti, "Minyak Mentah (WTI)");
      }
    }

    let searchCtx = "";
    let skipAI = false;
    if (detectSearchNeeded(userMessage)) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const searchQuery = buildSearchQuery(userMessage);
      const searchResult = await webSearch(searchQuery, 8);
      console.log(`[SEARCH] "${userMessage}" → "${searchQuery}" → ${searchResult ? "OK" : "NULL"}`);
      if (searchResult) {
        searchCtx = `\nInformasi terkini:\n${searchResult.trim()}`;
      } else {
        skipAI = true;
      }
    }

    if (skipAI) {
      const reply = `Maaf, saya belum bisa dapetin info real-time soal itu.

Cara paling cepet dapetin data IPO / berita terbaru:

1. Buka idx.co.id -> Listing -> IPO Calendar / New Listing
2. Cek e-IPO KSEI: eipo.ksei.co.id
3. Buka app sekuritas (Bibit, Stockbit, Ajaib, IPOT) -> menu IPO
4. Search di Google: "IPO Indonesia 2026" atau "jadwal IPO BEI"

Kalo udah nemu kode sahamnya (misal: JELI, RANS), kirim ke sini pake /saham JELI atau /saham RANS.JK, nanti saya analisa.`;
      await ctx.reply(reply);
      return;
    }

    const messages = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- Ga usah kaku, santai aja
- Tetep informatif tapi mengalir
- Kalo perlu list, pake tanda - aja

Hari ini: ${dateStr}.

Aturan penting:
- Kalo ditanya tanggal, jawab pake info hari ini di atas.
- JANGAN ngarang tanggal/tahun kalo gak yakin.

Kemampuan:
- Bantu tugas, deadline, jadwal sekolah
- Baca & jelasin isi foto (OCR), PDF, DOCX
- Nyimpen catatan penting otomatis
- Analisa saham, komoditas, forex, berita ekonomi

Memory dari tugas/catatan:
${memoryContext}
${knowledgeContext}
${marketCtx}
${searchCtx}`,
      },
      ...conversations,
      { role: "user", content: userMessage },
    ];

    const reply = await callAI(messages, ctx);

    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Text handler error:", error);
    await ctx.reply(`Error: ${error.message || error.code || String(error)}`);
  }
});

// ── File Processing ──────────────────────────────────

async function downloadFile(fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  const resp = await fetch(link);
  return Buffer.from(await resp.arrayBuffer());
}

bot.on("document", async (ctx) => {
  try {
    const doc = ctx.message.document;
    const caption = ctx.message.caption || "";
    const mime = doc.mime_type || "";

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const buffer = await downloadFile(doc.file_id);
    let extracted = "";

    if (mime === "application/pdf") {
      const data = await pdf(buffer);
      extracted = data.text;
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const { value } = await mammoth.extractRawText({ buffer });
      extracted = value;
    } else if (mime.startsWith("image/")) {
      const { data } = await Tesseract.recognize(buffer, "ind+eng");
      extracted = data.text;
    } else {
      extracted = `File terkirim: ${doc.file_name} (${mime}). Belum bisa diproses.`;
    }

    const text = caption
      ? `User kirim file: ${doc.file_name}. Caption: ${caption}\n\nIsi file:\n${extracted}`
      : `User kirim file: ${doc.file_name}.\n\nIsi file:\n${extracted}`;

    await saveConversation({ userId: ctx.from.id, role: "user", content: text });

    const messages = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.
- Ga usah kaku, santai aja

User kirim file. Ini isinya. Bantu user.`,
      },
      { role: "user", content: text },
    ];

    const reply = await callAI(messages, ctx);
    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Document handler error:", error);
    await ctx.reply(`Gagal proses file: ${error.message}`);
  }
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

if (!process.env.BOT_TOKEN) {
  console.error("BOT_TOKEN tidak di-set!");
}

(async () => {
  try {
    await bot.launch();
    console.log("Bot berjalan...");
  } catch (error) {
    console.error("Bot gagal launch:", error.message);
  }
})();

process.once("SIGTERM", async () => {
  try { await pool.end(); } catch {}
  bot.stop("SIGTERM");
  process.exit(0);
});
