import { getQuote, getNews, getMarketNews, buildMarketContext } from "../services/market.js";
import * as alpha from "../services/alpha.js";
import * as fmp from "../services/fmp.js";
import { getHistory, getChartImage, getPeriodLabel } from "../services/chart.js";
import { webSearch, buildSearchQuery } from "../services/search.js";
import { formatAIHttpError, formatAINetworkError, formatFriendlyError } from "../utils/errors.js";
import { buildSystemPrompt } from "../utils/soul.js";
import { runWithProgress } from "../utils/telegram.js";

export function registerMarketHandlers(bot, { config, callAI, dateStr }) {
  bot.command("test", async (ctx) => {
    try {
      const resp = await fetch(`${config.routerBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.routerApiKey}` },
        body: JSON.stringify({ model: config.routerModel, messages: [{ role: "user", content: "hai" }], stream: false }),
        signal: AbortSignal.timeout(30000),
      });
      const text = await resp.text();
      if (!resp.ok) return ctx.reply(formatAIHttpError(resp.status, text));
      await ctx.reply(`✅ AI Router aktif (${resp.status}) | Model: ${config.routerModel}\nRespon: ${text.slice(0, 180)}`);
    } catch (error) {
      await ctx.reply(formatAINetworkError(error));
    }
  });

  bot.command("cari", async (ctx) => {
    const rawQuery = ctx.message.text.split(" ").slice(1).join(" ");
    if (!rawQuery) return ctx.reply("🔎 Contoh: /cari IPO terbaru Indonesia 2026");

    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const searchQuery = buildSearchQuery(rawQuery);
        const searchResult = await webSearch(searchQuery, 8);
        console.log(`[/cari] "${rawQuery}" → "${searchQuery}" → ${searchResult ? "OK" : "NULL"}`);
        if (!searchResult) return "🔎 Maaf, belum berhasil dapetin hasil pencarian terbaru. Coba kata kunci lain atau cek langsung idx.co.id / eipo.ksei.co.id.";
        return callAI([
          { role: "system", content: buildSystemPrompt(`Hari ini: ${dateStr}.\n\nRingkas hasil pencarian berikut secara jelas dan jujur:\n${searchResult}`) },
          { role: "user", content: rawQuery },
        ], ctx);
      },
      formatError: (error) => {
        console.error("/cari error:", error);
        return { text: formatFriendlyError(error, "mencari info") };
      },
    });
  });

  bot.command("saham", async (ctx) => {
    const raw = ctx.message.text.split(" ").slice(1).join(" ");
    if (!raw) return ctx.reply("📈 Contoh: /saham BBCA atau /saham AAPL");

    let symbol = raw.toUpperCase();
    if (!symbol.includes(".") && !symbol.includes("=") && !symbol.includes("^")) {
      if (!["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "AMD", "INTC", "NFLX"].includes(symbol)) symbol += ".JK";
    }

    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const ticker = symbol.replace(".JK", "").replace("=F", "").replace("=X", "").replace("-USD", "");
        const [quote, news, sentiment, fundamental, ratios, earnings, rsi, topMovers, history] = await Promise.all([
          getQuote(symbol), getNews(symbol, 4), alpha.getNewsSentiment({ tickers: [ticker], limit: 4 }),
          fmp.getProfile(ticker).catch(() => null), fmp.getFinancialRatios(ticker).catch(() => null),
          alpha.getEarnings(ticker).catch(() => null), alpha.getRSI(ticker).catch(() => null),
          alpha.getTopGainersLosers().catch(() => null), getHistory(symbol, "1m").catch(() => null),
        ]);
        void fundamental; void ratios; void earnings; void topMovers;
        if (!quote) return `📭 Data saham "${raw}" tidak ditemukan. Coba kode yang benar (contoh: BBCA.JK, AAPL).`;
        if (history?.length >= 2) {
          const chart = await getChartImage(quote.symbol, history, "1m", "dark");
          if (chart) {
            await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
            ctx.replyWithPhoto({ source: chart, filename: `${quote.symbol}.png` }, { caption: `Chart ${quote.symbol} - ${getPeriodLabel("1m")}` }).catch(() => {});
          }
        }
        let marketCtx = buildMarketContext(quote, news) + alpha.formatSentiment(sentiment);
        if (rsi) marketCtx += "\n" + alpha.formatTechnicals(rsi, "RSI (14)");
        return callAI([
          { role: "system", content: buildSystemPrompt(`Peran tambahan: Analis trading.\nHari ini: ${dateStr}.\n\nTugas:\nAnalisa ${quote.name} (${quote.symbol}) berdasarkan DATA REAL-TIME di bawah.\nJANGAN bilang tidak punya akses data real-time — data ini dari Yahoo Finance langsung.\nBerikan pandangan teknikal singkat, sentimen pasar, dan level penting (support/resistance).\n${marketCtx}`) },
          { role: "user", content: `Analisa ${quote.symbol} (${quote.name}) untuk trading hari ini.` },
        ], ctx);
      },
      formatError: (error) => {
        console.error("/trade error:", error);
        return { text: formatFriendlyError(error, "menganalisa saham") };
      },
    });
  });

  bot.command("ekonomi", async (ctx) => {
    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const [news, cpi, fedRate, inflation, gdp, unemployment, treasury, retail, wti, goldSilver, topMovers] = await Promise.all([
          getMarketNews(6), alpha.getCPI(), alpha.getFedRate(), alpha.getInflation(), alpha.getGDP().catch(() => null),
          alpha.getUnemployment().catch(() => null), alpha.getTreasuryYield().catch(() => null), alpha.getRetailSales().catch(() => null),
          alpha.getWTI().catch(() => null), alpha.getGoldSilverSpot().catch(() => null), alpha.getTopGainersLosers().catch(() => null),
        ]);
        let context = news.length ? "Berita terkini:\n" + news.map((item, i) => `${i + 1}. ${item.title}`).join("\n") : "";
        if (cpi) context += alpha.formatIndicator(cpi, "CPI (Inflasi Konsumen)");
        if (fedRate) context += alpha.formatIndicator(fedRate, "Fed Funds Rate");
        if (inflation) context += alpha.formatIndicator(inflation, "Inflasi (CPI) Tahunan");
        if (gdp) context += alpha.formatIndicator(gdp, "GDP Riil");
        if (unemployment) context += alpha.formatIndicator(unemployment, "Tingkat Pengangguran");
        if (treasury) context += alpha.formatIndicator(treasury, "Treasury Yield");
        if (retail) context += alpha.formatIndicator(retail, "Retail Sales");
        if (wti) context += alpha.formatCommodityPrice(wti, "Minyak Mentah (WTI)");
        if (goldSilver) context += alpha.formatGoldSilver(goldSilver);
        if (topMovers) context += alpha.formatTopGainers(topMovers);
        if (!context.trim()) return "📭 Belum ada data ekonomi terkini yang tersedia.";
        return callAI([
          { role: "system", content: buildSystemPrompt(`Peran tambahan: Analis ekonomi makro.\n\nTugas:\nRangkum data ekonomi terkini di bawah dan kaitkan dengan dampaknya ke pasar saham, komoditas, dan forex.\n\n${context}`) },
          { role: "user", content: "Analisa data ekonomi hari ini dan dampaknya ke market." },
        ], ctx);
      },
      formatError: (error) => {
        console.error("/ekonomi error:", error);
        return { text: formatFriendlyError(error, "mengambil data ekonomi") };
      },
    });
  });
}
