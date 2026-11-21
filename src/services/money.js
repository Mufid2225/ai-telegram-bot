export { createPendingActionsStore } from "./pending.js";

export const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export const TARGET_STATUSES = ["Aktif", "Tercapai", "Ditunda", "Arsip"];

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
  if (kind === "create_target") {
    return (
      `🎯 Draft Buat Target Tabungan:\n` +
      `- Nama: ${payload.name}\n` +
      `- Target: ${formatIDR(payload.targetAmount)}\n` +
      `- Status: ${payload.status || "Aktif"}\n` +
      `- Catatan: ${payload.note || "-"}`
    );
  }
  if (kind === "add_target_deposit") {
    const lines = [
      `💰 Draft Setoran Target Tabungan:`,
      `- Target: ${payload.targetName} (${payload.targetId})`,
      `- Nominal: ${formatIDR(payload.amount)}`,
      `- Tanggal: ${payload.date || todayIso()}`,
      `- Keterangan: ${payload.note || "-"}`,
    ];
    if (payload.sourcePeriod) lines.push(`- Sumber Periode: ${payload.sourcePeriod}`);
    if (payload.overSurplusWarning) lines.push(`\n⚠️ ${payload.overSurplusWarning}`);
    return lines.join("\n");
  }
  if (kind === "update_target") {
    const patch = payload.patch || {};
    const changes = Object.entries(patch)
      .map(([k, v]) => `- ${k}: ${k === "targetAmount" ? formatIDR(v) : v || "-"}`)
      .join("\n");
    return `✏️ Draft Ubah Target (${payload.targetId} • ${payload.targetName}):\n${changes}`;
  }
  if (kind === "delete_target_log") {
    const exp = payload.expected || {};
    return (
      `🗑️ Draft Hapus Log Setoran (${payload.logId}):\n` +
      `- Target: ${exp.targetName || exp.targetId || "-"}\n` +
      `- Tanggal: ${exp.date || "-"}\n` +
      `- Nominal: ${formatIDR(exp.amount || 0)}`
    );
  }
  if (kind === "update_allocations") {
    const lines = (payload.updates || []).map(
      (u) => `- ${u.kategori}: ${formatPercentLabel(u.oldPercent)} → ${formatPercentLabel(u.newPercent)}`
    );
    const totalLine = `Total Alokasi Baru: ${formatPercentLabel(payload.newTotalPercent ?? 0)}`;
    const warn = Math.abs(Number(payload.newTotalPercent || 0) - 100) > 0.01
      ? `\n⚠️ Total alokasi menjadi ${formatPercentLabel(payload.newTotalPercent)} (belum 100%).`
      : "";
    return `📊 Draft Ubah Alokasi Income:\n${lines.join("\n")}\n\n${totalLine}${warn}`;
  }
  return "📝 Draft aksi Google Sheets";
}

export function toSourcePeriod(monthName, year) {
  const normalized = normalizeMonthName(monthName);
  const idx = MONTHS_ID.indexOf(normalized);
  if (idx === -1) throw new Error(`Bulan tidak valid: "${monthName}"`);
  return `${Number(year)}-${String(idx + 1).padStart(2, "0")}`;
}

export function getPreviousMonthPeriod(now = new Date()) {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = MONTHS_ID[prev.getMonth()];
  const year = prev.getFullYear();
  return { month, year, sourcePeriod: toSourcePeriod(month, year) };
}

export async function calculateMonthlySurplus({ sheetsService, month, year }) {
  const targetMonth = normalizeMonthName(month);
  const targetYear = Number(year) || new Date().getFullYear();
  const sourcePeriod = toSourcePeriod(targetMonth, targetYear);
  const [summary, logsRes] = await Promise.all([
    sheetsService.getSummary({ month: targetMonth, year: targetYear }),
    sheetsService.listTargetLogs({ sourcePeriod, limit: 100 }),
  ]);
  const saldo = Math.round(Number(summary?.saldo || 0));
  const allocatedAmount = Math.round(Number(logsRes?.totalMatchedAmount || 0));
  const availableSurplus = Math.max(0, saldo - allocatedAmount);
  return {
    month: summary?.month || targetMonth,
    year: summary?.year || targetYear,
    sourcePeriod,
    totalIncome: Math.round(Number(summary?.totalIncome || 0)),
    totalRealisasi: Math.round(Number(summary?.totalRealisasi || 0)),
    saldo,
    allocatedAmount,
    availableSurplus,
  };
}

export function renderProgressBar(percent, width = 10) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatPercentLabel(percent) {
  const num = Number(percent) || 0;
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(1)}%`;
}

export function formatTargetsList(targets) {
  if (!targets?.length) {
    return "🎯 Belum ada target tabungan tersimpan.\nContoh: /target beli monitor 3jt";
  }
  const lines = targets.map((t, idx) => {
    const pct = Number(t.progressPercent || 0);
    const bar = `${renderProgressBar(pct)} ${formatPercentLabel(pct)}`;
    const details = [`   Kurang: ${formatIDR(t.remainingAmount)}`];
    if (t.note) details.push(`Catatan: ${t.note}`);
    return (
      `${idx + 1}. ${t.id} • ${t.name} (${t.status})\n` +
      `   ${bar} • ${formatIDR(t.collectedAmount)} / ${formatIDR(t.targetAmount)}\n` +
      details.join(" | ")
    );
  });
  return `🎯 Daftar Target Tabungan (${targets.length} target):\n\n${lines.join("\n\n")}`;
}

export function formatTargetLogsList(logs, label = "") {
  if (!logs?.length) return `📭 Belum ada riwayat setoran${label ? ` untuk ${label}` : ""}.`;
  const lines = logs.map((l) => {
    const extras = [];
    if (l.note) extras.push(l.note);
    if (l.sourcePeriod) extras.push(`Periode ${l.sourcePeriod}`);
    const suffix = extras.length ? ` (${extras.join(" • ")})` : "";
    return `${l.logId} | ${l.date} | ${l.targetName} (${l.targetId}) | +${formatIDR(l.amount)}${suffix}`;
  });
  return `📒 Riwayat Setoran Target${label ? ` (${label})` : ""}:\n\n${lines.join("\n")}`;
}

export function formatSurplusSummary(surplus, activeTargets = []) {
  const lines = [
    `💰 Rekap Sisa Uang ${surplus.month} ${surplus.year} (${surplus.sourcePeriod}):`,
    `- Total Income: ${formatIDR(surplus.totalIncome)}`,
    `- Total Pengeluaran: ${formatIDR(surplus.totalRealisasi)}`,
    `- Saldo Akhir Bulan: ${formatIDR(surplus.saldo)}`,
    `- Sudah Dialokasikan ke Target: ${formatIDR(surplus.allocatedAmount)}`,
    `- Sisa Bebas Belum Dialokasikan: ${formatIDR(surplus.availableSurplus)}`,
  ];
  if (activeTargets.length) {
    lines.push("", "🎯 Target Aktif:");
    for (const t of activeTargets) {
      lines.push(`- ${t.id} • ${t.name}: terkumpul ${formatIDR(t.collectedAmount)} / ${formatIDR(t.targetAmount)} (kurang ${formatIDR(t.remainingAmount)})`);
    }
  } else {
    lines.push("", "Belum ada target tabungan aktif.");
  }
  return lines.join("\n");
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
  if (kind === "create_target") {
    const created = await sheetsService.createTarget(payload);
    return `Target "${created?.name || payload.name}" (${created?.id || "-"}) dibuat dengan target ${formatIDR(created?.targetAmount ?? payload.targetAmount)}.`;
  }
  if (kind === "add_target_deposit") {
    const res = await sheetsService.addTargetDeposit(payload);
    const t = res?.target || {};
    const pct = formatPercentLabel(t.progressPercent ?? 0);
    const statusNote = t.status === "Tercapai" ? "\n🎉 Selamat! Target ini sudah tercapai!" : "";
    return (
      `Setoran ${formatIDR(payload.amount)} ke target "${t.name || payload.targetName}" (${res?.log?.logId || "-"}) tersimpan.\n` +
      `Progres sekarang: ${formatIDR(t.collectedAmount ?? 0)} / ${formatIDR(t.targetAmount ?? 0)} (${pct})${statusNote}`
    );
  }
  if (kind === "update_target") {
    const updated = await sheetsService.updateTarget(payload);
    return `Target "${updated?.name || payload.targetName}" (${payload.targetId}) diperbarui (Status: ${updated?.status || "-"}).`;
  }
  if (kind === "delete_target_log") {
    await sheetsService.deleteTargetLog(payload);
    return `Log setoran ${payload.logId} berhasil dihapus dari Google Sheets TargetLogs.`;
  }
  if (kind === "update_allocations") {
    const res = await sheetsService.updateAllocations({
      updates: (payload.updates || []).map((u) => ({
        kategori: u.kategori,
        percent: u.newPercent ?? u.percent,
        expectedPercent: u.expectedPercent,
      })),
    });
    const list = (res?.updated || [])
      .map((u) => `- ${u.kategori}: ${formatPercentLabel(u.oldPercent)} → ${formatPercentLabel(u.newPercent)}`)
      .join("\n");
    const totalPct = formatPercentLabel(res?.totalPercent ?? payload.newTotalPercent ?? 0);
    return `Alokasi Income berhasil diperbarui:\n${list}\nTotal Alokasi sekarang: ${totalPct}.`;
  }
  throw new Error(`Aksi tidak dikenal: ${kind}`);
}

export function formatIncomeOverviewText(overview) {
  const sources = (overview?.incomeSources || []).map(
    (s) => `- ${s.source}: ${formatIDR(s.amount)}`
  );
  const allocs = (overview?.allocations || []).map((a) => {
    const amt = a.monthlyAmount !== undefined ? ` (${formatIDR(a.monthlyAmount)})` : "";
    return `- ${a.kategori}: ${formatPercentLabel(a.percent)}${amt}`;
  });
  return (
    `💵 Overview Tab Income (${overview?.month || "-"} ${overview?.year || ""})\n\n` +
    `Sumber Pemasukan (Total ${formatIDR(overview?.totalIncome || 0)}):\n` +
    `${sources.join("\n") || "- Belum ada sumber income"}\n\n` +
    `Alokasi Anggaran (Total Alokasi: ${formatPercentLabel(overview?.totalPercent || 0)}):\n` +
    `${allocs.join("\n") || "- Belum ada baris alokasi"}`
  );
}

export function formatUsageText(usage, { view = "month" } = {}) {
  if (usage?.structured) {
    const title = usage.title || "Penggunaan";
    if (view === "year") {
      const months = (usage.monthlyTotals || []).map((m) => `- ${m.month}: ${formatIDR(m.total)}`);
      return (
        `📊 Rekap Usage — ${title} (Jan–Des)\n\n` +
        `${months.join("\n") || "- Belum ada data"}\n\n` +
        `💰 Total: ${formatIDR(usage.yearTotal ?? 0)}`
      );
    }

    const total = Number(usage.total || 0);
    const items = (usage.items || []).map((item) => {
      const share = Number(item.percent) > 0
        ? Number(item.percent)
        : total > 0
          ? Number(((Number(item.amount || 0) / total) * 100).toFixed(1))
          : 0;
      const pctSuffix = share > 0 ? ` (${formatPercentLabel(share)})` : "";
      return `- ${item.kategori}: ${formatIDR(item.amount)}${pctSuffix}`;
    });
    return (
      `📋 Usage — ${title}\n` +
      `Bulan: ${usage.month || "-"}\n\n` +
      `${items.join("\n") || "- Belum ada kategori"}\n\n` +
      `💰 Total Realisasi ${usage.month || ""}: ${formatIDR(total)}`
    );
  }

  const rows = usage?.rows || [];
  if (!rows.length) return "📭 Tab Usage masih kosong.";
  const lines = rows.map((row) => row.join(" | "));
  const notes = [];
  if (usage?.truncatedRows) notes.push("baris terpotong");
  if (usage?.truncatedCols) notes.push("kolom terpotong");
  const suffix = notes.length ? `\n\n(Sebagian ${notes.join(" & ")} karena batas tampilan.)` : "";
  return `📒 Data Tab Usage (Read-Only):\n\n${lines.join("\n")}${suffix}`;
}
