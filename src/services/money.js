export { createPendingActionsStore } from "./pending.js";

export const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const MONTH_ALIASES = new Map([
  ["jan", "Januari"], ["januari", "Januari"], ["january", "Januari"],
  ["feb", "Februari"], ["februari", "Februari"], ["february", "Februari"],
  ["mar", "Maret"], ["maret", "Maret"], ["march", "Maret"],
  ["apr", "April"], ["april", "April"],
  ["mei", "Mei"], ["may", "Mei"],
  ["jun", "Juni"], ["juni", "Juni"], ["june", "Juni"],
  ["jul", "Juli"], ["juli", "Juli"], ["july", "Juli"],
  ["agu", "Agustus"], ["ags", "Agustus"], ["agustus", "Agustus"], ["aug", "Agustus"], ["august", "Agustus"],
  ["sep", "September"], ["sept", "September"], ["september", "September"],
  ["okt", "Oktober"], ["oktober", "Oktober"], ["oct", "Oktober"], ["october", "Oktober"],
  ["nov", "November"], ["november", "November"],
  ["des", "Desember"], ["desember", "Desember"], ["dec", "Desember"], ["december", "Desember"],
]);

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeMonthName(input, now = new Date()) {
  if (input == null || String(input).trim() === "") {
    return MONTHS_ID[now.getMonth()];
  }
  const raw = String(input).trim().toLowerCase();
  const asNum = Number(raw);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12) {
    return MONTHS_ID[asNum - 1];
  }
  if (MONTH_ALIASES.has(raw)) return MONTH_ALIASES.get(raw);
  const partial = MONTHS_ID.find((name) => name.toLowerCase().startsWith(raw));
  if (partial) return partial;
  throw new Error(`Bulan tidak valid: "${input}". Gunakan nama bulan (contoh: November).`);
}

export function formatIDR(amount) {
  const num = Math.round(Number(amount) || 0);
  const sign = num < 0 ? "-" : "";
  return `${sign}Rp ${Math.abs(num).toLocaleString("id-ID")}`;
}

function matchOption(value, list, label) {
  const target = String(value ?? "").trim().toLowerCase();
  const hit = (list || []).find((item) => item.toLowerCase() === target);
  if (!hit) {
    throw new Error(`${label} tidak valid: "${value}". Pilihan di Database: ${(list || []).join(", ") || "-"}`);
  }
  return hit;
}

export function normalizeExpenseItem(item, options, defaultDate = todayIso()) {
  const uraian = String(item?.uraian ?? "").trim();
  if (!uraian) throw new Error("Uraian transaksi wajib diisi.");

  const nilai = Number(item?.nilai);
  if (!Number.isFinite(nilai) || nilai <= 0) {
    throw new Error(`Nilai harus lebih dari 0 untuk "${uraian}".`);
  }

  const kategori = matchOption(item?.kategori, options?.categories, "Kategori");
  const bank = matchOption(item?.bank, options?.banks, "Bank");

  let transaksi = String(item?.transaksi ?? "").trim().toLowerCase();
  if (transaksi === "cash") transaksi = "Cash";
  else if (transaksi === "transfer") transaksi = "Transfer";
  else transaksi = bank.toLowerCase() === "cash" ? "Cash" : "Transfer";

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date ?? "").trim())
    ? String(item.date).trim()
    : defaultDate;

  return {
    date,
    transaksi,
    uraian,
    kategori,
    bank,
    nilai: Math.round(nilai),
    cek: item?.cek !== false,
  };
}

export function formatDraftPreview(kind, payload) {
  if (kind === "add_expenses") {
    const lines = payload.items.map(
      (it, idx) =>
        `${idx + 1}. ${it.uraian} — ${formatIDR(it.nilai)}\n   📅 ${it.date} | ${it.transaksi} | ${it.kategori} | ${it.bank}`
    );
    const total = payload.items.reduce((sum, it) => sum + it.nilai, 0);
    return `📝 Draft Catat Pengeluaran (${payload.items.length} item • Total ${formatIDR(total)}):\n\n${lines.join("\n")}`;
  }
  if (kind === "update_expense") {
    const exp = payload.expected || {};
    const patch = payload.patch || {};
    const changes = Object.entries(patch).map(([k, v]) => `- ${k}: ${k === "nilai" ? formatIDR(v) : v}`).join("\n");
    return `✏️ Draft Edit Pengeluaran (Baris #${payload.rowNumber}):\nSebelumnya: ${exp.uraian || "-"} (${formatIDR(exp.nilai || 0)})\nPerubahan:\n${changes}`;
  }
  if (kind === "delete_expense") {
    const exp = payload.expected || {};
    return `🗑️ Draft Hapus Pengeluaran (Baris #${payload.rowNumber}):\n- Tanggal: ${exp.date || "-"}\n- Uraian: ${exp.uraian || "-"}\n- Nilai: ${formatIDR(exp.nilai || 0)}`;
  }
  if (kind === "upsert_income") {
    const verb = payload.mode === "add" ? "Tambah" : "Set";
    return `💵 Draft ${verb} Income:\n- Sumber: ${payload.source}\n- Bulan: ${payload.month}${payload.year ? ` ${payload.year}` : ""}\n- Nominal: ${formatIDR(payload.amount)}`;
  }
  return "📝 Draft aksi Google Sheets";
}

export function formatSummaryText(summary) {
  const header = `📊 Ringkasan MoneyTracker (${summary.month} ${summary.year})`;
  const kpi = [
    `💵 Total Income: ${formatIDR(summary.totalIncome)}`,
    `📌 Total Alokasi: ${formatIDR(summary.totalAlokasi)}`,
    `🧾 Total Realisasi: ${formatIDR(summary.totalRealisasi)} (${Number(summary.percentUsed || 0).toFixed(1)}%)`,
    `💰 Saldo: ${formatIDR(summary.saldo)}`,
  ].join("\n");

  const cats = (summary.categories || []).map((c) => {
    const badge = c.overbudget ? " ⚠️ OVERBUDGET" : Number(c.progressPercent || 0) >= 100 ? " ✅" : "";
    return `- ${c.kategori}: ${formatIDR(c.realisasi)} / ${formatIDR(c.alokasi)} (${Number(c.progressPercent || 0).toFixed(1)}%)${badge}`;
  });

  return `${header}\n\n${kpi}\n\n📂 Per Kategori:\n${cats.join("\n") || "- Belum ada kategori"}`;
}

export function formatExpensesList(expenses, label = "") {
  if (!expenses?.length) return `📭 Tidak ada data pengeluaran${label ? ` untuk ${label}` : ""}.`;
  const lines = expenses.map(
    (e) => `#${e.rowNumber} | ${e.date} | ${e.uraian} | ${formatIDR(e.nilai)} (${e.kategori} - ${e.bank}/${e.transaksi})`
  );
  return `🧾 Pengeluaran${label ? ` (${label})` : ""}:\n\n${lines.join("\n")}`;
}

export async function executeConfirmedAction(action, sheetsService) {
  const { kind, payload } = action;
  if (kind === "add_expenses") {
    const res = await sheetsService.addExpenses(payload.items);
    const rowsLabel = res?.addedRows?.length ? ` (baris ${res.addedRows.join(", ")})` : "";
    const itemsLabel = payload.items.map((it) => `- ${it.uraian}: ${formatIDR(it.nilai)} [${it.kategori} / ${it.bank}]`).join("\n");
    return `Tersimpan ke Google Sheets Expenses${rowsLabel}:\n${itemsLabel}`;
  }
  if (kind === "update_expense") {
    await sheetsService.updateExpense(payload);
    return `Pengeluaran baris #${payload.rowNumber} berhasil diperbarui di Google Sheets.`;
  }
  if (kind === "delete_expense") {
    await sheetsService.deleteExpense(payload);
    return `Pengeluaran baris #${payload.rowNumber} (${payload.expected?.uraian || "-"}) berhasil dihapus dari Google Sheets.`;
  }
  if (kind === "upsert_income") {
    const res = await sheetsService.upsertIncome(payload);
    return `Income "${res?.source || payload.source}" bulan ${res?.month || payload.month} tersimpan: ${formatIDR(res?.amount ?? payload.amount)}.`;
  }
  throw new Error(`Aksi tidak dikenal: ${kind}`);
}
