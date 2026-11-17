import { getKnowledgeContext } from "../memory.js";
import { detectSymbol, getQuote, getNews, getMarketNews, buildMarketContext } from "../services/market.js";
import * as alpha from "../services/alpha.js";
import * as fmp from "../services/fmp.js";
import { getHistory, getChartImage, getPeriodLabel } from "../services/chart.js";
import { webSearch, detectSearchNeeded, buildSearchQuery } from "../services/search.js";
import { tools, executeTool } from "../tools.js";
import { formatFriendlyError } from "../utils/errors.js";
import { buildSystemPrompt } from "../utils/soul.js";
import { buildConfirmExtra, runWithProgress } from "../utils/telegram.js";

export function registerMessageHandlers(bot, {
  pool,
  callAI,
  repository,
  sheetsService,
  pendingStore,
  reminderStore,
  workspaceStore,
  trelloService,
  notionService,
  superhumanService,
  kbService,
  dateStr,
}) {
  bot.on("text", async (ctx) => {
    const userMessage = ctx.message.text;
    const userId = String(ctx.from.id);
    const toolContext = {
      userId,
      pool,
      sheetsService,
      pendingStore,
      reminderStore,
      workspaceStore,
      trelloService,
      notionService,
      superhumanService,
      kbService,
    };

    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const convResult = await pool.query(
          "SELECT role, content FROM conversations WHERE user_id = $1 ORDER BY id DESC LIMIT 10",
          [userId]
        );
        const conversations = convResult.rows.reverse();
        await repository.saveConversation({ userId, role: "user", content: userMessage });

        const words = userMessage.toLowerCase().split(" ").filter((word) => word.length > 2);
        let memories = [];
        if (words.length) {
          const conditions = words.map((_, i) => `content ILIKE $${i + 1}`);
          const values = words.map((word) => `%${word}%`);
          values.push(userId);
          memories = (await pool.query(
            `SELECT * FROM memories WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")}) ORDER BY id DESC LIMIT 5`,
            values
          )).rows;
        }
        const memoryContext = memories.length
          ? memories.reverse().map((memory) => `Type: ${memory.type}\nSubject: ${memory.subject || "-"}\nDeadline: ${memory.deadline || "-"}\nContent: ${memory.content}`).join("\n---\n")
          : "Tidak ada catatan relevan.";
        const knowledgeContext = await getKnowledgeContext(userId, pool);

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
          const searchQuery = buildSearchQuery(userMessage);
          const searchResult = await webSearch(searchQuery, 8);
          console.log(`[SEARCH] "${userMessage}" → "${searchQuery}" → ${searchResult ? "OK" : "NULL"}`);
          if (!searchResult) {
            return "Maaf, saya belum bisa dapetin info real-time soal itu.\n\nCara paling cepet dapetin data IPO / berita terbaru:\n\n1. Buka idx.co.id -> Listing -> IPO Calendar / New Listing\n2. Cek e-IPO KSEI: eipo.ksei.co.id\n3. Buka app sekuritas (Bibit, Stockbit, Ajaib, IPOT) -> menu IPO\n4. Search di Google: \"IPO Indonesia 2026\" atau \"jadwal IPO BEI\"\n\nKalo udah nemu kode sahamnya (misal: JELI, RANS), kirim ke sini pake /saham JELI atau /saham RANS.JK, nanti saya analisa.";
          }
          searchCtx = `\nInformasi terkini:\n${searchResult.trim()}`;
        }

        const activeWs = workspaceStore ? await workspaceStore.getActiveContext(userId) : null;
        const activeWsLine = activeWs
          ? `Sumber workspace aktif terakhir: ${activeWs.platform} -> "${activeWs.sourceName}" (ID: ${activeWs.sourceId}${activeWs.extra?.tableName ? `, Tabel: ${activeWs.extra.tableName}` : ""}).\n`
          : "";
        const nowTime = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
        const reply = await callAI(
          [
            {
              role: "system",
              content: buildSystemPrompt(
                `Hari ini: ${dateStr}, jam ${nowTime}.\n\n` +
                activeWsLine +
                `Aturan tugas chat utama:\n` +
                `- MoneyTracker (Google Sheets) adalah sumber utama data keuangan.\n` +
                `- Setiap user bertanya soal budget, saldo, pengeluaran, rencana/simulasi pembagian uang (mis. bagi budget 4 minggu), WAJIB panggil money_get_summary / money_list_expenses dulu agar jawabannya akurat sesuai data spreadsheet terbaru, lalu hitung pakai calculate bila perlu. JANGAN buat draft transaksi jika user hanya bertanya atau simulasi rencana.\n` +
                `- Jika user jelas meminta mencatat, mengedit, atau menghapus transaksi/income (atau mengoreksi draft sebelumnya), panggil money_get_options (dan money_list_expenses jika edit/hapus) lalu panggil money_propose_* supaya muncul tombol Simpan/Batal.\n` +
                `- Untuk Trello, Notion, Superhuman Docs, dan Knowledge Base (read-only), panggil tool pencarian/baca secara terarah (trello_search_cards, notion_query_database, superhuman_query_table, kb_search, kb_read_note); jangan menebak ID atau membaca seluruh board sekaligus.\n` +
                `- Semua penulisan/edit/arsip ke Trello, Notion, atau Superhuman Docs WAJIB melalui *_propose_* agar muncul tombol Simpan/Batal. Jika ada >1 kandidat atau nama list duplikat, tanyakan ke user sebelum membuat draft.\n` +
                `- Untuk catatan biasa, fakta preferensi user, atau reminder di luar spreadsheet, gunakan save_note / list_notes / remember / recall / save_reminder / list_reminders (panggil get_current_time dulu bila perlu menghitung waktu relatif).\n\n` +
                `Catatan terkait:\n${memoryContext}\n${knowledgeContext}\n${marketCtx}\n${searchCtx}`
              ),
            },
            ...conversations,
            { role: "user", content: userMessage },
          ],
          ctx,
          { tools, executeTool, toolContext }
        );
        await repository.saveConversation({ userId, role: "assistant", content: reply });
        return reply;
      },
      formatResult: (reply) => ({ text: reply, extra: buildConfirmExtra(toolContext.pendingAction) }),
      formatError: (error) => {
        console.error("Text handler error:", error);
        return { text: formatFriendlyError(error, "memproses pesan") };
      },
    });
  });
}
