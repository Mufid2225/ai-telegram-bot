import dayjs from "dayjs";
import { normalizeMonthName, formatSummaryText, formatIDR } from "../services/money.js";
import { getFinanceChartImage } from "../services/chart.js";
import { formatFriendlyError } from "../utils/errors.js";
import { runWithProgress } from "../utils/telegram.js";
import { sendFinanceChart } from "./money.js";
import { createWorkspaceStore } from "../services/workspace.js";
import { handleWorkspaceMenuAction } from "./workspace-menu.js";
import { infoKeyboard, handleInfoMenuCallback } from "./info-menu.js";

const PAGE_SIZE = 8;

export const BOT_COMMANDS = [
  { command: "menu", description: "Buka menu interaktif Nerissa" },
  { command: "keuangan", description: "Ringkasan MoneyTracker & grafik" },
  { command: "pengeluaran", description: "Daftar pengeluaran terbaru" },
  { command: "catat", description: "Catat pengeluaran atau income" },
  { command: "catatan", description: "Lihat catatan & tugas tersimpan" },
  { command: "remind", description: "Lihat reminder & deadline aktif" },
  { command: "tugas", description: "Lihat daftar tugas" },
  { command: "saham", description: "Analisis saham (mis. /saham BBCA)" },
  { command: "ekonomi", description: "Ringkasan data ekonomi global" },
  { command: "cari", description: "Cari berita atau info terkini" },
  { command: "test", description: "Tes koneksi AI router" },
];

const PLATFORM_LABELS = {
  trello: "Trello",
  notion: "Notion",
  superhuman: "Superhuman Docs",
  kb: "Knowledge Base",
  calendar: "Google Calendar",
};

function formatNowHeader(now = new Date()) {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} • ${hh}.${mm} WIB`;
}

export function homeKeyboard() {
  return [
    [
      { text: "💰 Ringkasan Keuangan", callback_data: "menu:summary" },
      { text: "🧾 Pengeluaran Terbaru", callback_data: "menu:expenses:0" },
    ],
    [
      { text: "📝 Catatan & Tugas", callback_data: "menu:notes" },
      { text: "⏰ Reminder Aktif", callback_data: "menu:reminders" },
    ],
    [
      { text: "📅 Google Calendar", callback_data: "menu:ws:calendar" },
    ],
    [
      { text: "📋 Trello", callback_data: "menu:ws:trello" },
      { text: "📓 Notion", callback_data: "menu:ws:notion" },
    ],
    [
      { text: "📄 Superhuman Docs", callback_data: "menu:ws:superhuman" },
      { text: "🧠 Knowledge Base", callback_data: "menu:ws:kb" },
    ],
    [
      { text: "➡️ Info & Riset", callback_data: "menu:page:info" },
    ],
    [
      { text: "📖 Panduan Pakai", callback_data: "menu:help" },
      { text: "✖️ Tutup", callback_data: "menu:close" },
    ],
  ];
}

async function homeView({
  pool,
  userId,
  reminderStore,
  workspaceStore,
  sheetsService,
  calendarService,
  trelloService,
  notionService,
  superhumanService,
  kbService,
} = {}) {
  let notesCount = 0;
  let dueSoonCount = 0;
  let remindersCount = 0;
  let activeLabel = "Belum dipilih";

  if (pool?.query && userId) {
    const uid = String(userId);
    const today = dayjs().format("YYYY-MM-DD");
    const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");
    const totalRes = await pool.query("SELECT COUNT(*) AS cnt FROM memories WHERE user_id = $1", [uid]);
    const dueRes = await pool.query(
      "SELECT COUNT(*) AS cnt FROM memories WHERE user_id = $1 AND type = 'tugas' AND (deadline = $2 OR deadline = $3)",
      [uid, today, tomorrow]
    );
    notesCount = Number(totalRes.rows?.[0]?.cnt || 0);
    dueSoonCount = Number(dueRes.rows?.[0]?.cnt || 0);
  }

  if (reminderStore?.listPending && userId) {
    const pending = await reminderStore.listPending(userId);
    remindersCount = pending.length;
  }

  if (workspaceStore?.getActiveContext && userId) {
    const active = await workspaceStore.getActiveContext(userId);
    if (active) {
      const pName = PLATFORM_LABELS[active.platform] || active.platform;
      activeLabel = `${pName} — ${active.sourceName}`;
    }
  }

  const readyServices = [
    sheetsService?.isConfigured?.() && "Sheets",
    calendarService?.isConfigured?.() && "Calendar",
    trelloService?.isConfigured?.() && "Trello",
    notionService?.isConfigured?.() && "Notion",
    superhumanService?.isConfigured?.() && "Superhuman",
    kbService?.isConfigured?.() && "KB",
  ].filter(Boolean);

  const dueSuffix = dueSoonCount > 0 ? ` (${dueSoonCount} deadline dekat)` : "";
  const integrationsLine = readyServices.length ? readyServices.join(" • ") : "Catatan & Memori Lokal";

  return {
    text:
      `✨ Nerissa Personal Hub\n` +
      `🗓️ ${formatNowHeader()}\n\n` +
      `📊 Status Cepat:\n` +
      `• 📝 Catatan & Tugas: ${notesCount} tersimpan${dueSuffix}\n` +
      `• ⏰ Reminder Aktif: ${remindersCount} pengingat terjadwal\n` +
      `• 🎯 Konteks Terakhir: ${activeLabel}\n` +
      `• 🔌 Integrasi Siap: ${integrationsLine}\n\n` +
      `💡 Pintasan:\n` +
      `• Chat langsung untuk tanya budget, cek jadwal kosong, atau kelola task\n` +
      `• Kirim foto struk / QRIS untuk otomatis dibuatkan draft pengeluaran\n` +
      `• Pilih tombol di bawah untuk jelajahi data live:`,
    extra: {
      reply_markup: {
        inline_keyboard: homeKeyboard(),
      },
    },
  };
}

function helpView() {
  return {
    text:
      "📖 PANDUAN PAKAI NERISSA\n\n" +
      "1️⃣ Kelola MoneyTracker (Google Sheets)\n" +
      "• /keuangan — Ringkasan budget & grafik bulan ini\n" +
      "• /pengeluaran — Lihat daftar transaksi + nomor baris\n" +
      "• /catat bensin 25rb cash — Catat cepat (muncul tombol Simpan/Batal)\n" +
      "• Kirim foto struk / QRIS → otomatis dibaca & disiapkan draft-nya\n\n" +
      "2️⃣ Tanya & Simulasi Budget (Tanpa Nyatat)\n" +
      "• \"Budget 300rb dibagi 4 minggu, transport 50rb/minggu sisanya gimana?\"\n" +
      "• \"Sisa jatah makan bulan ini berapa?\"\n\n" +
      "3️⃣ Catatan & Reminder Persisten\n" +
      "• \"Ingetin besok jam 8 pagi sisihin tabungan\"\n" +
      "• \"Catat: minggu depan servis motor\"\n" +
      "• /catatan & /remind — Cek daftar catatan & pengingat aktif\n\n" +
      "4️⃣ Google Calendar, Workspace & Knowledge Base\n" +
      "• Pilih Google Calendar / Trello / Notion / Superhuman Docs / KB di /menu untuk cek data live\n" +
      "• Setelah dibuka, langsung ketik perintah natural (mis. \"jadwalin rapat besok 10.00-11.00\" atau \"pindah card ... ke In Progress\")\n\n" +
      "5️⃣ Saham, Ekonomi & Cari Info\n" +
      "• /saham BBCA • /ekonomi • /cari jadwal IPO terbaru\n" +
      "• /menu → ➡️ Info & Riset: cuaca, crypto, saham, kurs, berita, Bank Dunia, gempa & libur (klik lalu ketik inputnya)\n\n" +
      "💡 Tips:\n" +
      "• Semua pencatatan ke spreadsheet selalu minta konfirmasi tombol dulu.\n" +
      "• Salah detail sebelum klik Simpan? Cukup balas chat, misal \"ganti bank ke Jago\".\n" +
      "• Cek koneksi AI router kapan saja lewat /test.",
    extra: {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💰 Cek Keuangan", callback_data: "menu:summary" },
            { text: "« Menu Utama", callback_data: "menu:home" },
          ],
        ],
      },
    },
  };
}

async function summaryView(sheetsService) {
  const now = new Date();
  const summary = await sheetsService.getSummary({
    month: normalizeMonthName(null, now),
    year: now.getFullYear(),
  });
  return {
    text: formatSummaryText(summary).slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Refresh", callback_data: "menu:summary" },
            { text: "🧾 Pengeluaran", callback_data: "menu:expenses:0" },
          ],
          [
            { text: "📈 Kirim Grafik PNG", callback_data: "menu:chart" },
            { text: "« Menu Utama", callback_data: "menu:home" },
          ],
        ],
      },
    },
  };
}

async function expensesView(sheetsService, offsetRaw) {
  const now = new Date();
  const month = normalizeMonthName(null, now);
  const year = now.getFullYear();
  const rows = await sheetsService.listExpenses({ month, year, limit: 100 });
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = Math.max(0, Math.min(Number(offsetRaw) || 0, (totalPages - 1) * PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const slice = rows.slice(offset, offset + PAGE_SIZE);

  const body = slice.length
    ? slice
        .map(
          (e) =>
            `#${e.rowNumber} | ${e.date} | ${e.uraian} | ${formatIDR(e.nilai)} (${e.kategori} - ${e.bank})`
        )
        .join("\n")
    : "Belum ada pengeluaran untuk bulan ini.";

  const navRow = [];
  if (offset > 0) navRow.push({ text: "« Sebelumnya", callback_data: `menu:expenses:${Math.max(0, offset - PAGE_SIZE)}` });
  if (offset + PAGE_SIZE < total) navRow.push({ text: "Berikutnya »", callback_data: `menu:expenses:${offset + PAGE_SIZE}` });

  const keyboard = [];
  if (navRow.length) keyboard.push(navRow);
  keyboard.push([
    { text: "💰 Ringkasan", callback_data: "menu:summary" },
    { text: "« Menu Utama", callback_data: "menu:home" },
  ]);

  return {
    text: `🧾 Pengeluaran ${month} ${year} (Hal ${page}/${totalPages} • Total ${total}):\n\n${body}`.slice(0, 4000),
    extra: { reply_markup: { inline_keyboard: keyboard } },
  };
}

async function notesView(pool, userId) {
  const { rows } = await pool.query(
    "SELECT id, type, deadline, content FROM memories WHERE user_id = $1 ORDER BY id DESC LIMIT 12",
    [String(userId)]
  );
  const body = rows.length
    ? rows.map((r) => `#${r.id} [${r.type}]${r.deadline ? ` (${r.deadline})` : ""}: ${r.content}`).join("\n")
    : "Belum ada catatan atau tugas tersimpan.";
  return {
    text: `📝 Catatan & Tugas Tersimpan:\n\n${body}`.slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔄 Refresh", callback_data: "menu:notes" },
          { text: "« Menu Utama", callback_data: "menu:home" },
        ]],
      },
    },
  };
}

async function remindersView(pool, reminderStore, userId) {
  const scheduled = await reminderStore.listPending(userId);
  const today = dayjs().format("YYYY-MM-DD");
  const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");
  const { rows: dueTasks } = await pool.query(
    "SELECT id, subject, deadline, content FROM memories WHERE user_id = $1 AND type = 'tugas' AND (deadline = $2 OR deadline = $3) ORDER BY deadline ASC",
    [String(userId), today, tomorrow]
  );

  const parts = [];
  if (scheduled.length) {
    parts.push(
      "⏰ Reminder Terjadwal:\n" +
      scheduled
        .map((r) => `- #${r.id} (${new Date(r.due_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}): ${r.message}`)
        .join("\n")
    );
  }
  if (dueTasks.length) {
    parts.push(
      "📚 Deadline Tugas (Hari Ini / Besok):\n" +
      dueTasks.map((t) => `- #${t.id} [${t.subject || "-"}] (${t.deadline}): ${t.content}`).join("\n")
    );
  }

  return {
    text: (parts.length ? parts.join("\n\n") : "⏰ Tidak ada reminder aktif atau deadline hari ini/besok.").slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔄 Refresh", callback_data: "menu:reminders" },
          { text: "« Menu Utama", callback_data: "menu:home" },
        ]],
      },
    },
  };
}

async function safeEdit(ctx, view) {
  try {
    await ctx.editMessageText(view.text, view.extra);
  } catch (err) {
    if (!String(err?.message || "").includes("message is not modified")) throw err;
  }
}

export async function handleMenuCallback({
  ctx,
  action,
  allowedUserId,
  pool,
  sheetsService,
  reminderStore,
  workspaceStore,
  trelloService,
  notionService,
  superhumanService,
  kbService,
  calendarService,
  inputStore,
  stepMs = 100,
  finishDelayMs = 0,
}) {
  if (String(ctx.from?.id) !== String(allowedUserId)) {
    await ctx.answerCbQuery("Akses ditolak.");
    return;
  }

  const userId = String(ctx.from.id);

  // Navigasi halaman info: ganti tombol saja in-place, tanpa memuat ulang teks.
  if (action === "page:info" || action === "page:home") {
    await ctx.answerCbQuery();
    const keyboard = action === "page:info" ? infoKeyboard() : homeKeyboard();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
    } catch (err) {
      if (!String(err?.message || "").includes("message is not modified")) {
        await ctx.answerCbQuery("Gagal mengubah tombol. Ketik /menu untuk membuka ulang.");
      }
    }
    return;
  }

  if (action.startsWith("info:")) {
    if (!inputStore) {
      await ctx.answerCbQuery("Fitur info belum tersedia.");
      return;
    }
    await handleInfoMenuCallback({ ctx, action: action.slice(5), userId, inputStore });
    return;
  }

  if (action === "close") {
    await ctx.answerCbQuery();
    await safeEdit(ctx, { text: "Menu ditutup. Ketik /menu kapan saja untuk membuka kembali." });
    return;
  }

  if (action === "chart") {
    await ctx.answerCbQuery("Membuat grafik...");
    let summaryData = null;
    const chart = await runWithProgress({
      ctx,
      mode: "reply",
      stepMs,
      finishDelayMs,
      task: async () => {
        const now = new Date();
        summaryData = await sheetsService.getSummary({
          month: normalizeMonthName(null, now),
          year: now.getFullYear(),
        });
        return getFinanceChartImage(summaryData);
      },
      formatResult: (buf) => ({
        text: buf
          ? `📈 Grafik MoneyTracker — ${summaryData.month} ${summaryData.year}:`
          : "📭 Belum ada data kategori untuk dibuat grafik.",
      }),
      formatError: (err) => ({ text: formatFriendlyError(err, "membuat grafik") }),
    });
    if (chart) {
      const sent = await sendFinanceChart(ctx, chart, `MoneyTracker — ${summaryData.month} ${summaryData.year}`);
      if (!sent) await ctx.reply("⚠️ Grafik gagal dikirim karena gangguan koneksi Telegram.");
    }
    return;
  }

  await ctx.answerCbQuery();
  const wsStore = workspaceStore || (pool?.query ? createWorkspaceStore(pool) : null);
  const homeDeps = {
    pool,
    userId,
    reminderStore,
    workspaceStore: wsStore,
    sheetsService,
    calendarService,
    trelloService,
    notionService,
    superhumanService,
    kbService,
  };
  if (action === "home") return await safeEdit(ctx, await homeView(homeDeps));
  if (action === "help") return await safeEdit(ctx, helpView());

  const loadView = () => {
    if (action === "summary") return summaryView(sheetsService);
    if (action.startsWith("expenses:")) return expensesView(sheetsService, action.split(":")[1]);
    if (action === "notes") return notesView(pool, userId);
    if (action === "reminders") return remindersView(pool, reminderStore, userId);
    if (action.startsWith("ws:")) {
      return handleWorkspaceMenuAction({
        action,
        userId,
        workspaceStore: wsStore,
        trelloService,
        notionService,
        superhumanService,
        kbService,
        calendarService,
      });
    }
    return homeView(homeDeps);
  };

  await runWithProgress({
    ctx,
    mode: "edit",
    stepMs,
    finishDelayMs,
    task: loadView,
    formatResult: (view) => view,
    formatError: (error) => ({
      text: formatFriendlyError(error, "memuat menu"),
      extra: { reply_markup: { inline_keyboard: [[{ text: "« Menu Utama", callback_data: "menu:home" }]] } },
    }),
  });
}

export function registerMenuHandlers(bot, {
  config,
  pool,
  sheetsService,
  reminderStore,
  workspaceStore,
  trelloService,
  notionService,
  superhumanService,
  kbService,
  calendarService,
  inputStore,
}) {
  const sendHome = async (ctx) => {
    const wsStore = workspaceStore || (pool?.query ? createWorkspaceStore(pool) : null);
    const view = await homeView({
      pool,
      userId: String(ctx.from?.id || ""),
      reminderStore,
      workspaceStore: wsStore,
      sheetsService,
      calendarService,
      trelloService,
      notionService,
      superhumanService,
      kbService,
    });
    await ctx.reply(view.text, view.extra);
  };

  bot.start(sendHome);
  bot.command("menu", sendHome);

  bot.action(/^menu:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    try {
      await handleMenuCallback({
        ctx,
        action,
        allowedUserId: config.allowedUserId,
        pool,
        sheetsService,
        reminderStore,
        workspaceStore,
        trelloService,
        notionService,
        superhumanService,
        kbService,
        calendarService,
        inputStore,
      });
    } catch (error) {
      console.error("Menu callback error:", error);
      await ctx.answerCbQuery(`Error: ${error.message}`).catch(() => {});
    }
  });
}
