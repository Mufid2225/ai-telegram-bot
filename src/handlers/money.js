import {
  normalizeMonthName,
  formatSummaryText,
  formatExpensesList,
  executeConfirmedAction,
} from "../services/money.js";
import { getFinanceChartImage } from "../services/chart.js";
import { tools, executeTool } from "../tools.js";
import { formatFriendlyError } from "../utils/errors.js";
import { buildSystemPrompt } from "../utils/soul.js";
import { runWithTyping } from "../utils/telegram.js";
import { runPendingConfirmation } from "./actions.js";

const MONEY_TOOL_NAMES = new Set([
  "get_current_time",
  "calculate",
  "money_get_options",
  "money_get_summary",
  "money_list_expenses",
  "money_propose_add_expenses",
  "money_propose_update_expense",
  "money_propose_delete_expense",
  "money_propose_upsert_income",
]);

const moneyTools = tools.filter((t) => MONEY_TOOL_NAMES.has(t.function.name));

export async function handleMoneyCallback({
  ctx,
  actionType,
  actionId,
  allowedUserId,
  pendingStore,
  sheetsService,
  stepMs = 100,
  finishDelayMs = 0,
}) {
  return runPendingConfirmation({
    ctx,
    actionType,
    actionId,
    allowedUserId,
    pendingStore,
    progressText: "Menyimpan ke Google Sheets...",
    executeAction: (claimed) => executeConfirmedAction(claimed, sheetsService),
    stepMs,
    finishDelayMs,
  });
}

function parseMonthYearArgs(text) {
  const parts = String(text ?? "").trim().split(/\s+/).slice(1);
  let monthArg;
  let yearArg;
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) yearArg = Number(part);
    else if (!monthArg) monthArg = part;
  }
  return {
    month: normalizeMonthName(monthArg),
    year: yearArg || new Date().getFullYear(),
  };
}

export async function sendFinanceChart(ctx, chart, caption) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
      await ctx.replyWithPhoto({ source: chart, filename: "moneytracker.png" }, { caption });
      return true;
    } catch (error) {
      console.error(`/keuangan chart attempt ${attempt + 1} error:`, error.message);
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

export function registerMoneyHandlers(bot, { config, callAI, pool, sheetsService, pendingStore, reminderStore, dateStr }) {
  bot.command("catat", async (ctx) => {
    const input = ctx.message.text.replace(/^\/catat(?:@\S+)?\s*/i, "").trim();
    if (!input) {
      return ctx.reply(
        "📝 Contoh pemakaian /catat:\n" +
        "• /catat bensin 25rb cash\n" +
        "• /catat makan siang 20rb, kopi 15rb seabank\n" +
        "• /catat income bonus 100rb bulan november\n" +
        "• /catat hapus pengeluaran baris 18"
      );
    }

    const toolContext = { userId: String(ctx.from.id), pool, sheetsService, pendingStore, reminderStore };
    await runWithTyping({
      ctx,
      task: () => callAI(
        [
          {
            role: "system",
            content: buildSystemPrompt(
              `Mode: /catat MoneyTracker.\nHari ini: ${dateStr}.\n` +
              `Aturan:\n` +
              `- Panggil money_get_options dulu untuk melihat daftar Bank dan Kategori valid di spreadsheet.\n` +
              `- Jika user mengedit atau menghapus, panggil money_list_expenses dulu untuk mencari rowNumber yang tepat.\n` +
              `- Buat draft dengan money_propose_add_expenses / money_propose_update_expense / money_propose_delete_expense / money_propose_upsert_income.\n` +
              `- Jika ada data wajib yang benar-benar kurang atau ambigu (misal nominal tidak ada), tanyakan ramah dan singkat tanpa membuat draft.`
            ),
          },
          { role: "user", content: input },
        ],
        ctx,
        { tools: moneyTools, executeTool, toolContext }
      ),
      getPendingAction: () => toolContext.pendingAction,
      onError: (error) => {
        console.error("/catat error:", error);
        return formatFriendlyError(error, "memproses /catat");
      },
    });
  });

  bot.command("keuangan", async (ctx) => {
    const { month, year } = parseMonthYearArgs(ctx.message.text);
    const summary = await runWithTyping({
      ctx,
      task: () => sheetsService.getSummary({ month, year }),
      formatText: (data) => formatSummaryText(data),
      onError: (error) => {
        console.error("/keuangan error:", error);
        return formatFriendlyError(error, "membaca ringkasan keuangan");
      },
    });
    if (!summary) return;
    const chart = await getFinanceChartImage(summary);
    if (chart) {
      const sent = await sendFinanceChart(ctx, chart, `MoneyTracker — ${summary.month} ${summary.year}`);
      if (!sent) {
        await ctx.reply("⚠️ Grafik belum bisa dikirim karena gangguan koneksi Telegram, tapi ringkasan di atas sudah data terbaru.");
      }
    }
  });

  bot.command("pengeluaran", async (ctx) => {
    const { month, year } = parseMonthYearArgs(ctx.message.text);
    await runWithTyping({
      ctx,
      task: () => sheetsService.listExpenses({ month, year, limit: 15 }),
      formatText: (rows) => formatExpensesList(rows, `${month} ${year}`),
      onError: (error) => {
        console.error("/pengeluaran error:", error);
        return formatFriendlyError(error, "membaca daftar pengeluaran");
      },
    });
  });

  bot.action(/^money:(confirm|cancel):([a-f0-9]+)$/, async (ctx) => {
    const [, actionType, actionId] = ctx.match;
    try {
      await handleMoneyCallback({
        ctx,
        actionType,
        actionId,
        allowedUserId: config.allowedUserId,
        pendingStore,
        sheetsService,
      });
    } catch (error) {
      console.error("Money callback error:", error);
      await ctx.answerCbQuery(`Error: ${error.message}`).catch(() => {});
    }
  });
}
