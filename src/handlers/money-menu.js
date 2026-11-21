import {
  MONTHS_ID,
  normalizeMonthName,
  formatSummaryText,
  formatIDR,
  formatIncomeOverviewText,
  formatTargetsList,
  formatTargetLogsList,
  formatUsageText,
  formatSurplusSummary,
  getPreviousMonthPeriod,
  calculateMonthlySurplus,
} from "../services/money.js";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const PAGE_SIZE = 8;

function navRow(refreshAction) {
  return [
    { text: "🔄 Refresh", callback_data: refreshAction },
    { text: "« MoneyTracker", callback_data: "menu:money" },
    { text: "« Menu Utama", callback_data: "menu:home" },
  ];
}

export function moneyHubView() {
  return {
    text:
      "💰 MoneyTracker Hub\n\n" +
      "Pilih sheet yang mau dibuka:\n" +
      "• 📊 Ringkasan — KPI bulanan & grafik PNG\n" +
      "• 🧾 Expenses — daftar transaksi + nomor baris\n" +
      "• 💵 Income & Alokasi — sumber pemasukan & % jatah\n" +
      "• 🎯 Targets & 📒 Setoran — progres target tabungan\n" +
      "• 📋 Usage — pemakaian read-only dari rumus\n" +
      "• 💰 Sisa Bulan Lalu — hitung surplus bebas untuk target\n\n" +
      "💡 Bisa langsung lewat chat:\n" +
      "• \"bensin 25rb cash\" / \"dapet 400rb jual voucher bing\"\n" +
      "• \"ubah alokasi makan jadi 25%\" / \"nabung monitor 300rb\"\n" +
      "• \"cek sisa uang bulan kemarin\"",
    extra: {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📊 Ringkasan", callback_data: "menu:summary" },
            { text: "🧾 Expenses", callback_data: "menu:expenses:0" },
          ],
          [
            { text: "💵 Income & Alokasi", callback_data: "menu:income" },
            { text: "📋 Usage (Read-Only)", callback_data: "menu:usage" },
          ],
          [
            { text: "🎯 Targets Tabungan", callback_data: "menu:targets" },
            { text: "📒 Riwayat Setoran", callback_data: "menu:targetlogs" },
          ],
          [
            { text: "💰 Cek Sisa Bulan Lalu", callback_data: "menu:surplus" },
          ],
          [
            { text: "« Menu Utama", callback_data: "menu:home" },
          ],
        ],
      },
    },
  };
}

export async function summaryView(sheetsService) {
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
            { text: "« MoneyTracker", callback_data: "menu:money" },
          ],
          [
            { text: "« Menu Utama", callback_data: "menu:home" },
          ],
        ],
      },
    },
  };
}

export async function expensesView(sheetsService, offsetRaw) {
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

  const pagerRow = [];
  if (offset > 0) pagerRow.push({ text: "« Sebelumnya", callback_data: `menu:expenses:${Math.max(0, offset - PAGE_SIZE)}` });
  if (offset + PAGE_SIZE < total) pagerRow.push({ text: "Berikutnya »", callback_data: `menu:expenses:${offset + PAGE_SIZE}` });

  const keyboard = [];
  if (pagerRow.length) keyboard.push(pagerRow);
  keyboard.push([
    { text: "📊 Ringkasan", callback_data: "menu:summary" },
    { text: "« MoneyTracker", callback_data: "menu:money" },
    { text: "« Menu Utama", callback_data: "menu:home" },
  ]);

  return {
    text: `🧾 Pengeluaran ${month} ${year} (Hal ${page}/${totalPages} • Total ${total}):\n\n${body}`.slice(0, 4000),
    extra: { reply_markup: { inline_keyboard: keyboard } },
  };
}

function buildMonthPickerView({ prefix, title, extraRows = [] }) {
  const monthRows = [];
  for (let i = 0; i < MONTHS_ID.length; i += 4) {
    monthRows.push(
      MONTHS_ID.slice(i, i + 4).map((m, idx) => ({
        text: SHORT_MONTHS[i + idx],
        callback_data: `menu:${prefix}:${m}`,
      }))
    );
  }
  return {
    text: title,
    extra: {
      reply_markup: {
        inline_keyboard: [
          ...monthRows,
          ...extraRows,
          [
            { text: "« MoneyTracker", callback_data: "menu:money" },
            { text: "« Menu Utama", callback_data: "menu:home" },
          ],
        ],
      },
    },
  };
}

export function incomePickerView() {
  return buildMonthPickerView({
    prefix: "income",
    title: "📅 Pilih Bulan Income & Alokasi:\n\nPilih bulan untuk melihat sumber pemasukan dan jatah alokasi bulan tersebut.",
  });
}

async function incomeView(sheetsService, monthArg = null) {
  const month = monthArg ? normalizeMonthName(monthArg) : undefined;
  const overview = await sheetsService.getIncomeOverview(month ? { month } : {});
  const activeMonth = overview?.month || month || normalizeMonthName(null);
  return {
    text: `${formatIncomeOverviewText(overview)}\n\n💡 Ketik chat untuk tambah income atau ubah % alokasi.`.slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 Pilih Bulan", callback_data: "menu:income:pick" }],
          navRow(`menu:income:${activeMonth}`),
        ],
      },
    },
  };
}

async function targetsView(sheetsService) {
  const res = await sheetsService.listTargets({});
  return {
    text: `${formatTargetsList(res?.targets || [])}\n\n💡 Ketik: "buat target ..." atau "nabung ..."` .slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📒 Riwayat Setoran", callback_data: "menu:targetlogs" },
            { text: "💰 Sisa Bulan Lalu", callback_data: "menu:surplus" },
          ],
          navRow("menu:targets"),
        ],
      },
    },
  };
}

async function targetLogsView(sheetsService) {
  const res = await sheetsService.listTargetLogs({ limit: 15 });
  return {
    text: formatTargetLogsList(res?.logs || []).slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 Targets Tabungan", callback_data: "menu:targets" }],
          navRow("menu:targetlogs"),
        ],
      },
    },
  };
}

export function usagePickerView() {
  return buildMonthPickerView({
    prefix: "usage",
    title: "📅 Pilih Bulan Usage (Read-Only):\n\nPilih bulan untuk melihat rincian realisasi per kategori, atau lihat rekap Jan–Des.",
    extraRows: [[{ text: "📊 Rekap Setahun (Jan–Des)", callback_data: "menu:usage:year" }]],
  });
}

async function usageView(sheetsService, monthArg = null) {
  const isYear = monthArg === "year";
  const month = !isYear && monthArg ? normalizeMonthName(monthArg) : undefined;
  const usage = await sheetsService.getUsage({ month, maxRows: 60, maxCols: 16 });
  const activeMonth = usage?.month || month || normalizeMonthName(null);
  const refreshAction = isYear ? "menu:usage:year" : usage?.structured ? `menu:usage:${activeMonth}` : "menu:usage";
  const topRow = isYear
    ? [{ text: "📅 Pilih Bulan", callback_data: "menu:usage:pick" }]
    : [
        { text: "📅 Pilih Bulan", callback_data: "menu:usage:pick" },
        { text: "📊 Rekap Setahun", callback_data: "menu:usage:year" },
      ];
  return {
    text: formatUsageText(usage, { view: isYear ? "year" : "month" }).slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [topRow, navRow(refreshAction)],
      },
    },
  };
}

async function surplusView(sheetsService) {
  const prev = getPreviousMonthPeriod();
  const [surplus, targetsRes] = await Promise.all([
    calculateMonthlySurplus({ sheetsService, month: prev.month, year: prev.year }),
    sheetsService.listTargets({ status: "Aktif" }),
  ]);
  const text =
    `${formatSurplusSummary(surplus, targetsRes?.targets || [])}\n\n` +
    `💡 Balas chat, misal: "masukin sisa bulan kemarin ke target ..."`;
  return {
    text: text.slice(0, 4000),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 Targets Tabungan", callback_data: "menu:targets" }],
          navRow("menu:surplus"),
        ],
      },
    },
  };
}

export function resolveMoneyMenuTask(action, sheetsService) {
  if (action === "summary") return () => summaryView(sheetsService);
  if (action.startsWith("expenses:")) return () => expensesView(sheetsService, action.split(":")[1]);
  if (action === "income") return () => incomeView(sheetsService);
  if (action.startsWith("income:") && action !== "income:pick") {
    return () => incomeView(sheetsService, action.slice("income:".length));
  }
  if (action === "targets") return () => targetsView(sheetsService);
  if (action === "targetlogs") return () => targetLogsView(sheetsService);
  if (action === "usage") return () => usageView(sheetsService);
  if (action.startsWith("usage:") && action !== "usage:pick") {
    return () => usageView(sheetsService, action.slice("usage:".length));
  }
  if (action === "surplus") return () => surplusView(sheetsService);
  return null;
}
