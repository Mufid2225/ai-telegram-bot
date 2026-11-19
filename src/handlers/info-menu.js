import { executeInfoTool } from "../tools/info.js";
import { executeResearchTool } from "../tools/research.js";
import { listHolidays } from "../services/holidays.js";
import { formatFriendlyError } from "../utils/errors.js";
import {
  parseFxInput,
  normalizeStockInput,
  parseWorldbankInput,
  isCancelText,
  extractFirstSymbol,
} from "../utils/infoInput.js";

export function infoKeyboard() {
  return [
    [
      { text: "🌦️ Cek Cuaca", callback_data: "menu:info:weather" },
      { text: "🪙 Cek Crypto", callback_data: "menu:info:crypto" },
    ],
    [
      { text: "📈 Cek Saham", callback_data: "menu:info:stock" },
      { text: "💱 Cek Kurs", callback_data: "menu:info:fx" },
    ],
    [
      { text: "📰 Cari Berita", callback_data: "menu:info:news" },
      { text: "🏦 Data Bank Dunia", callback_data: "menu:info:wb" },
    ],
    [
      { text: "🌍 Gempa Terbaru", callback_data: "menu:info:quake" },
      { text: "📅 Libur Bulan Ini", callback_data: "menu:info:holiday" },
    ],
    [
      { text: "⬅️ Kembali", callback_data: "menu:page:home" },
      { text: "✖️ Tutup", callback_data: "menu:close" },
    ],
  ];
}

const PROMPTS = {
  weather: {
    emoji: "🌦️",
    title: "Cek Cuaca",
    hint: "Silakan ketik nama kota/kabupaten, mis. Malang atau Bandung.",
    placeholder: "mis. Malang, Jawa Timur",
  },
  crypto: {
    emoji: "🪙",
    title: "Cek Crypto",
    hint: "Silakan ketik simbol/id koin, mis. BTC atau BTC,ETH.",
    placeholder: "mis. BTC, ETH, SOL",
  },
  stock: {
    emoji: "📈",
    title: "Cek Saham",
    hint: "Silakan ketik kode ticker atau nama perusahaan, mis. BBCA atau Bank Central Asia.",
    placeholder: "mis. BBCA atau Bank Central Asia",
  },
  fx: {
    emoji: "💱",
    title: "Cek Kurs",
    hint: "Silakan ketik pair mata uang, mis. USD IDR atau 100 USD ke IDR.",
    placeholder: "mis. 100 USD ke IDR",
  },
  news: {
    emoji: "📰",
    title: "Cari Berita",
    hint: "Silakan ketik topik berita, mis. IPO terbaru atau ekonomi Indonesia.",
    placeholder: "mis. IPO terbaru Indonesia",
  },
  wb: {
    emoji: "🏦",
    title: "Data Bank Dunia",
    hint: "Silakan ketik indikator + negara, mis. gdp malaysia atau populasi.",
    placeholder: "mis. inflasi USA",
  },
};

function holidayTypeLabel(type) {
  return type === "leave" ? "Cuti Bersama" : "Libur Nasional";
}

// Bulan kosong → tampilkan 3 libur terdekat dari daftar setahun (tanggal >= hari ini).
async function holidayThisMonthOrNearest() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const result = await executeInfoTool("holiday_info", { year, month });
  if (!String(result).startsWith("Tidak ada hari libur")) return result;

  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = `${year}-${pad(month)}-${pad(now.getDate())}`;
  const items = await listHolidays(year);
  const nearest = (items || [])
    .filter((h) => String(h.date) >= todayIso)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 3);
  if (!nearest.length) {
    return "📅 Tidak ada libur/cuti bersama bulan ini, dan data libur terdekat tahun ini belum tersedia. Coba lagi nanti ya.";
  }
  const lines = nearest.map((h) => `- ${h.date} (${h.day}): ${h.name} [${holidayTypeLabel(h.type)}]`);
  return `📅 Tidak ada libur/cuti bersama bulan ini.\nLibur terdekat:\n${lines.join("\n")}`;
}

export async function handleInfoMenuCallback({ ctx, action, userId, inputStore }) {
  if (action === "quake") {
    await ctx.answerCbQuery("Mengambil data BMKG...");
    const result = await executeInfoTool("earthquake_info", { type: "latest" });
    await ctx.reply(result);
    return;
  }

  if (action === "holiday") {
    await ctx.answerCbQuery();
    const result = await holidayThisMonthOrNearest();
    await ctx.reply(result);
    return;
  }

  // Guard prototype: hanya action milik sendiri yang boleh jadi prompt;
  // action tak dikenal tetap di-answer agar spinner tidak menggantung.
  if (!Object.hasOwn(PROMPTS, action)) {
    await ctx.answerCbQuery().catch(() => {});
    return null;
  }
  const prompt = PROMPTS[action];

  await ctx.answerCbQuery();
  const sent = await ctx.reply(
    `${prompt.emoji} ${prompt.title}\n${prompt.hint}\n\nKetik batal untuk membatalkan (berlaku 5 menit).`,
    {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: prompt.placeholder,
      },
    }
  );
  await inputStore.set(userId, action, sent.message_id);
}

async function executeStockInput(text) {
  const sym = normalizeStockInput(text);
  if (sym) {
    const r = await executeResearchTool("stock_quote", { symbol: sym });
    if (!String(r).startsWith("Simbol")) return r;
  }
  const s = await executeResearchTool("symbol_search", { keywords: text.trim() });
  const first = extractFirstSymbol(s);
  if (first) return executeResearchTool("stock_quote", { symbol: first });
  return s;
}

export async function tryHandleInfoInput({ ctx, text, userId, inputStore }) {
  if (!inputStore) return null;
  const state = await inputStore.get(userId);
  if (!state) return null;

  if (isCancelText(text)) {
    await inputStore.clear(userId);
    return "✅ Oke, permintaan info dibatalkan.";
  }

  // Reply ke pesan lain (bukan prompt) → biarkan chat normal, state dipertahankan.
  const replyId = ctx.message?.reply_to_message?.message_id;
  if (replyId != null && replyId !== state.promptMessageId) return null;

  // Hasil consume adalah klaim otoritatif (atomik): dua pesan konkuren
  // tidak boleh double-execute walau keduanya sempat melihat state via get().
  const claimed = await inputStore.consume(userId);
  if (!claimed) return null;
  try {
    switch (claimed.tool) {
      case "weather":
        return await executeInfoTool("weather_forecast", { location: text.trim(), days: 3 });
      case "crypto":
        return await executeInfoTool("crypto_price", { coins: text.trim() });
      case "stock":
        return await executeStockInput(text);
      case "fx": {
        const p = parseFxInput(text);
        if (!p) return "💱 Format kurs: ketik kode mata uang, mis. USD IDR atau 100 USD ke IDR.";
        if (p.base === p.quote) {
          return `💱 Mata uang asal dan tujuan sama (${p.base}). Coba pair lain, mis. USD IDR.`;
        }
        return await executeInfoTool("exchange_rate", p);
      }
      case "news": {
        const r = await executeResearchTool("news_search", { query: text.trim() });
        if (String(r).startsWith("Pencarian berita sedang gagal")) {
          return await executeResearchTool("web_search", { query: text.trim() });
        }
        return r;
      }
      case "wb": {
        const p = parseWorldbankInput(text);
        if (!p) return "🏦 Format: indikator + negara, mis. gdp malaysia atau populasi.";
        return await executeInfoTool("worldbank_data", {
          indicator: p.indicator,
          country: p.country,
          ...(p.year ? { year: p.year } : {}),
        });
      }
      default:
        return null;
    }
  } catch (err) {
    return formatFriendlyError(err, "memproses info");
  }
}

// Command Telegram apa pun membatalkan state input yang sedang hidup.
export function registerInfoInputGuard(bot, inputStore) {
  bot.use(async (ctx, next) => {
    if (ctx.message?.entities?.some((e) => e.type === "bot_command") && ctx.from?.id) {
      await inputStore.clear(String(ctx.from.id)).catch(() => {});
    }
    return next();
  });
}
