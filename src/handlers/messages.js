import { getKnowledgeContext } from "../memory.js";
import { detectSymbol, getQuote, getNews, getMarketNews, buildMarketContext } from "../services/market.js";
import * as alpha from "../services/alpha.js";
import * as fmp from "../services/fmp.js";
import { getHistory, getChartImage, getPeriodLabel } from "../services/chart.js";
import { webSearch, detectSearchNeeded, buildSearchQuery } from "../services/search.js";
import { isImportantMessage, extractTaskInfo } from "./tasks.js";
import { replyText } from "../utils/telegram.js";

export function registerMessageHandlers(bot, { pool, callAI, repository, dateStr }) {
  bot.on("text", async (ctx) => {
    const userMessage = ctx.message.text;
    try {
      await repository.saveConversation({ userId: ctx.from.id, role: "user", content: userMessage });
      if (isImportantMessage(userMessage)) await repository.saveMemory({ userId: ctx.from.id, extracted: extractTaskInfo(userMessage), content: userMessage });
      const convResult = await pool.query("SELECT role, content FROM conversations WHERE user_id = $1 ORDER BY id DESC LIMIT 10", [ctx.from.id]);
      const conversations = convResult.rows.reverse();
      const words = userMessage.toLowerCase().split(" ").filter((word) => word.length > 2);
      let memories = [];
      if (words.length) {
        const conditions = words.map((_, i) => `content ILIKE $${i + 1}`);
        const values = words.map((word) => `%${word}%`);
        values.push(ctx.from.id);
        memories = (await pool.query(`SELECT * FROM memories WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")}) ORDER BY id DESC LIMIT 5`, values)).rows;
      }
      const memoryContext = memories.length
        ? memories.reverse().map((memory) => `Type: ${memory.type}\nSubject: ${memory.subject || "-"}\nDeadline: ${memory.deadline || "-"}\nContent: ${memory.content}`).join("\n---\n")
        : "Tidak ada memory relevan.";
      const knowledgeContext = await getKnowledgeContext(ctx.from.id);
      let marketCtx = "";
      const lowerMsg = userMessage.toLowerCase();
      const symbol = detectSymbol(userMessage);
      if (symbol) {
        const [quote, news, sentiment, rsi, profile, ratios, history] = await Promise.all([
          getQuote(symbol), getNews(symbol, 3), alpha.getNewsSentiment({ tickers: [symbol], limit: 3 }),
          alpha.getRSI(symbol).catch(() => null), fmp.getProfile(symbol).catch(() => null),
          fmp.getFinancialRatios(symbol).catch(() => null), getHistory(symbol, "1m").catch(() => null),
        ]);
        if (quote) {
          marketCtx = buildMarketContext(quote, news) + alpha.formatSentiment(sentiment);
          if (rsi) marketCtx += "\n" + alpha.formatTechnicals(rsi, "RSI (14)");
          if (profile || ratios) marketCtx += "\n" + fmp.formatFundamentals(profile, ratios);
          if (history?.length >= 2) {
            const chart = await getChartImage(quote.symbol, history, "1m", "dark");
            if (chart) ctx.replyWithPhoto(chart, { caption: `Chart ${quote.symbol} - ${getPeriodLabel("1m")}` }).catch(() => {});
          }
        }
      } else if (["saham", "forex", "komoditas", "cpi", "ppi", "inflasi", "suku bunga", "trading", "analisa", "berita ekonomi", "emas", "minyak", "xauusd", "btc", "bitcoin", "eurusd", "ihsg", "ekonomi", "pasar"].some((word) => lowerMsg.includes(word))) {
        const [news, sentiment, cpi, fedRate, goldSilver, wti] = await Promise.all([
          getMarketNews(3), alpha.getNewsSentiment({ topics: ["economy", "financial_markets"], limit: 3 }),
          lowerMsg.includes("cpi") || lowerMsg.includes("inflasi") ? alpha.getCPI().catch(() => null) : null,
          lowerMsg.includes("suku bunga") || lowerMsg.includes("fed") ? alpha.getFedRate().catch(() => null) : null,
          lowerMsg.includes("emas") || lowerMsg.includes("gold") || lowerMsg.includes("silver") ? alpha.getGoldSilverSpot().catch(() => null) : null,
          lowerMsg.includes("minyak") || lowerMsg.includes("wti") || lowerMsg.includes("crude") ? alpha.getWTI().catch(() => null) : null,
        ]);
        if (news.length) marketCtx = "\n--- Berita Ekonomi Terkini ---\n" + news.map((item) => `- ${item.title}`).join("\n");
        marketCtx += alpha.formatSentiment(sentiment);
        if (cpi) marketCtx += alpha.formatIndicator(cpi, "CPI");
        if (fedRate) marketCtx += alpha.formatIndicator(fedRate, "Fed Rate");
        if (goldSilver) marketCtx += alpha.formatGoldSilver(goldSilver);
        if (wti) marketCtx += alpha.formatCommodityPrice(wti, "Minyak Mentah (WTI)");
      }
      let searchCtx = "";
      if (detectSearchNeeded(userMessage)) {
        await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
        const searchQuery = buildSearchQuery(userMessage);
        const searchResult = await webSearch(searchQuery, 8);
        console.log(`[SEARCH] "${userMessage}" → "${searchQuery}" → ${searchResult ? "OK" : "NULL"}`);
        if (!searchResult) {
          await replyText(ctx, "Maaf, saya belum bisa dapetin info real-time soal itu.\n\nCara paling cepet dapetin data IPO / berita terbaru:\n\n1. Buka idx.co.id -> Listing -> IPO Calendar / New Listing\n2. Cek e-IPO KSEI: eipo.ksei.co.id\n3. Buka app sekuritas (Bibit, Stockbit, Ajaib, IPOT) -> menu IPO\n4. Search di Google: \"IPO Indonesia 2026\" atau \"jadwal IPO BEI\"\n\nKalo udah nemu kode sahamnya (misal: JELI, RANS), kirim ke sini pake /saham JELI atau /saham RANS.JK, nanti saya analisa.");
          return;
        }
        searchCtx = `\nInformasi terkini:\n${searchResult.trim()}`;
      }
      const reply = await callAI([
        { role: "system", content: `Kamu asisten Telegram yang santai dan helpful.\n\nGaya bicara:\n- Natural, kayak ngobrol sama temen\n- JANGAN pakai emoji sama sekali\n- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.\n- Ga usah kaku, santai aja\n- Tetep informatif tapi mengalir\n- Kalo perlu list, pake tanda - aja\n\nHari ini: ${dateStr}.\n\nAturan penting:\n- Kalo ditanya tanggal, jawab pake info hari ini di atas.\n- JANGAN ngarang tanggal/tahun kalo gak yakin.\n\nKemampuan:\n- Bantu tugas, deadline, jadwal sekolah\n- Baca & jelasin isi foto (OCR), PDF, DOCX\n- Nyimpen catatan penting otomatis\n- Analisa saham, komoditas, forex, berita ekonomi\n\nMemory dari tugas/catatan:\n${memoryContext}\n${knowledgeContext}\n${marketCtx}\n${searchCtx}` },
        ...conversations,
        { role: "user", content: userMessage },
      ], ctx);
      await repository.saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
      await replyText(ctx, reply);
    } catch (error) {
      console.error("Text handler error:", error);
      await ctx.reply(`Error: ${error.message || error.code || String(error)}`);
    }
  });
}
