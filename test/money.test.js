import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import {
  formatIDR,
  normalizeMonthName,
  normalizeExpenseItem,
  createPendingActionsStore,
  executeConfirmedAction,
  formatSummaryText,
  toSourcePeriod,
  getPreviousMonthPeriod,
  calculateMonthlySurplus,
  renderProgressBar,
  formatTargetsList,
  formatDraftPreview,
  formatIncomeOverviewText,
  formatUsageText,
} from "../src/services/money.js";
import { getFinanceChartImage } from "../src/services/chart.js";

const sampleOptions = {
  banks: ["Seabank", "Shopee Pay", "Gopay", "Dana", "Ovo", "Jago", "Cash"],
  categories: ["Transportasi", "Tabungan", "Dana Darurat", "Makan", "Jajan", "Lain-lain", "Sisa Tabungan"],
};

test("formatIDR and normalizeMonthName handle Indonesian formats", () => {
  assert.equal(formatIDR(25000), "Rp 25.000");
  assert.equal(formatIDR(0), "Rp 0");
  assert.equal(normalizeMonthName("11"), "November");
  assert.equal(normalizeMonthName("nov"), "November");
  assert.equal(normalizeMonthName("agustus"), "Agustus");
});

test("normalizeExpenseItem maps case-insensitively and rejects invalid category or bank", () => {
  const item = normalizeExpenseItem(
    { uraian: "Bensin", nilai: 25000, kategori: "transportasi", bank: "cash" },
    sampleOptions,
    "2026-11-17"
  );
  assert.deepEqual(item, {
    date: "2026-11-17",
    transaksi: "Cash",
    uraian: "Bensin",
    kategori: "Transportasi",
    bank: "Cash",
    nilai: 25000,
    cek: true,
  });

  assert.throws(
    () => normalizeExpenseItem({ uraian: "X", nilai: 1000, kategori: "Hiburan", bank: "Cash" }, sampleOptions),
    /Kategori tidak valid/
  );
  assert.throws(
    () => normalizeExpenseItem({ uraian: "X", nilai: -500, kategori: "Jajan", bank: "Cash" }, sampleOptions),
    /Nilai harus lebih dari 0/
  );
});

test("pendingActionsStore persists in SQLite, supersedes old drafts, and prevents double claim", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const store = createPendingActionsStore(db);
    const first = await store.create({
      userId: "u1",
      kind: "add_expenses",
      payload: { items: [{ uraian: "Kopi", nilai: 15000 }] },
      summaryText: "Kopi Rp 15.000",
    });
    const second = await store.create({
      userId: "u1",
      kind: "add_expenses",
      payload: { items: [{ uraian: "Kopi", nilai: 18000 }] },
      summaryText: "Kopi Rp 18.000",
    });

    const oldRow = await store.getById(first.id, "u1");
    assert.equal(oldRow.status, "superseded");
    assert.equal(await store.claimForExecution(first.id, "u1"), null);

    assert.equal(await store.claimForExecution(second.id, "other-user"), null);
    const claimed = await store.claimForExecution(second.id, "u1");
    assert.equal(claimed.id, second.id);
    assert.equal(claimed.payload.items[0].nilai, 18000);
    assert.equal(await store.claimForExecution(second.id, "u1"), null);

    await store.markStatus(second.id, "confirmed");
    const done = await store.getById(second.id, "u1");
    assert.equal(done.status, "confirmed");
  } finally {
    db.end();
  }
});

test("executeConfirmedAction calls sheetsService and formats summary", async () => {
  const calls = [];
  const fakeSheets = {
    addExpenses: async (items) => {
      calls.push({ fn: "addExpenses", items });
      return { addedRows: [18] };
    },
    upsertIncome: async (params) => {
      calls.push({ fn: "upsertIncome", params });
      return { source: params.source, month: params.month, amount: params.amount };
    },
  };

  const msg = await executeConfirmedAction(
    { kind: "add_expenses", payload: { items: [{ date: "2026-11-17", transaksi: "Cash", uraian: "Bensin", kategori: "Transportasi", bank: "Cash", nilai: 25000 }] } },
    fakeSheets
  );
  assert.equal(calls.length, 1);
  assert.match(msg, /Bensin/);
  assert.match(msg, /baris 18/);

  const summary = formatSummaryText({
    month: "November",
    year: 2026,
    totalIncome: 300000,
    totalAlokasi: 300000,
    totalRealisasi: 281572,
    saldo: 18428,
    percentUsed: 93.86,
    categories: [{ kategori: "Jajan", alokasi: 15000, realisasi: 109000, progressPercent: 726.67, overbudget: true }],
  });
  assert.match(summary, /November 2026/);
  assert.match(summary, /Jajan/);
  assert.match(summary, /OVERBUDGET/);
});

test("getFinanceChartImage renders PNG buffer for category breakdown", async () => {
  const buf = await getFinanceChartImage({
    month: "November",
    year: 2026,
    categories: [
      { kategori: "Transportasi", alokasi: 150000, realisasi: 92000, overbudget: false },
      { kategori: "Jajan", alokasi: 15000, realisasi: 109000, overbudget: true },
    ],
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 4).toString("hex"), "89504e47");
});

test("getPreviousMonthPeriod handles standard and January-to-December rollovers", () => {
  assert.deepEqual(getPreviousMonthPeriod(new Date(2026, 10, 21)), {
    month: "Oktober",
    year: 2026,
    sourcePeriod: "2026-10",
  });
  assert.deepEqual(getPreviousMonthPeriod(new Date(2026, 0, 5)), {
    month: "Desember",
    year: 2025,
    sourcePeriod: "2025-12",
  });
  assert.equal(toSourcePeriod("Februari", 2026), "2026-02");
});

test("calculateMonthlySurplus subtracts already-allocated logs for that sourcePeriod", async () => {
  const fakeSheets = {
    getSummary: async ({ month, year }) => ({
      month,
      year,
      totalIncome: 2000000,
      totalRealisasi: 1250000,
      saldo: 750000,
    }),
    listTargetLogs: async ({ sourcePeriod }) => {
      assert.equal(sourcePeriod, "2026-10");
      return {
        logs: [{ logId: "LOG-001", amount: 300000 }],
        totalMatchedAmount: 300000,
      };
    },
  };

  const surplus = await calculateMonthlySurplus({
    sheetsService: fakeSheets,
    month: "Oktober",
    year: 2026,
  });
  assert.equal(surplus.saldo, 750000);
  assert.equal(surplus.allocatedAmount, 300000);
  assert.equal(surplus.availableSurplus, 450000);
});

test("renderProgressBar, formatTargetsList, formatDraftPreview, and executeConfirmedAction support savings targets", async () => {
  assert.equal(renderProgressBar(60, 10), "[██████░░░░]");
  const listText = formatTargetsList([
    {
      id: "TGT-001",
      name: "Monitor 27",
      targetAmount: 3000000,
      collectedAmount: 1800000,
      remainingAmount: 1200000,
      progressPercent: 60,
      status: "Aktif",
      note: "Promo 12.12",
    },
  ]);
  assert.match(listText, /TGT-001/);
  assert.match(listText, /\[██████░░░░\] 60%/);
  assert.match(listText, /Rp 1\.800\.000/);

  const preview = formatDraftPreview("add_target_deposit", {
    targetId: "TGT-001",
    targetName: "Monitor 27",
    amount: 450000,
    date: "2026-11-21",
    note: "Sisa uang bulan Oktober",
    sourcePeriod: "2026-10",
    overSurplusWarning: "Nominal melebihi sisa bebas bulan Oktober 2026 (Rp 400.000).",
  });
  assert.match(preview, /Monitor 27/);
  assert.match(preview, /Sisa uang bulan Oktober/);
  assert.match(preview, /Nominal melebihi/);

  const calls = [];
  const fakeSheets = {
    createTarget: async (p) => { calls.push(["createTarget", p]); return { id: "TGT-002", name: p.name, targetAmount: p.targetAmount }; },
    addTargetDeposit: async (p) => {
      calls.push(["addTargetDeposit", p]);
      return {
        log: { logId: "LOG-002", amount: p.amount },
        target: { id: p.targetId, name: "Monitor 27", collectedAmount: 2250000, targetAmount: 3000000, progressPercent: 75, status: "Aktif" },
      };
    },
    updateTarget: async (p) => { calls.push(["updateTarget", p]); return { id: p.targetId, name: "Monitor 27", status: "Ditunda" }; },
    deleteTargetLog: async (p) => { calls.push(["deleteTargetLog", p]); return { deleted: true, logId: p.logId }; },
  };

  const r1 = await executeConfirmedAction({ kind: "create_target", payload: { name: "SSD", targetAmount: 1500000 } }, fakeSheets);
  assert.match(r1, /TGT-002/);
  const r2 = await executeConfirmedAction({ kind: "add_target_deposit", payload: { targetId: "TGT-001", targetName: "Monitor 27", amount: 450000 } }, fakeSheets);
  assert.match(r2, /75\.0%|75%/);
  const r3 = await executeConfirmedAction({ kind: "update_target", payload: { targetId: "TGT-001", targetName: "Monitor 27", patch: { status: "Ditunda" } } }, fakeSheets);
  assert.match(r3, /Monitor 27/);
  const r4 = await executeConfirmedAction({ kind: "delete_target_log", payload: { logId: "LOG-002" } }, fakeSheets);
  assert.match(r4, /LOG-002/);
  assert.equal(calls.length, 4);
});

test("formatIncomeOverviewText, formatUsageText, and update_allocations preview/execution work cleanly", async () => {
  const overviewText = formatIncomeOverviewText({
    month: "November",
    year: 2026,
    incomeSources: [{ source: "Gaji", amount: 5000000 }],
    totalIncome: 5000000,
    allocations: [
      { kategori: "Makan", percent: 30, monthlyAmount: 1500000 },
      { kategori: "Tabungan", percent: 20, monthlyAmount: 1000000 },
    ],
    totalPercent: 50,
  });
  assert.match(overviewText, /Gaji: Rp 5\.000\.000/);
  assert.match(overviewText, /Makan: 30%/);
  assert.match(overviewText, /Total Alokasi: 50%/);

  const usageText = formatUsageText({
    sheetName: "Usage",
    rows: [
      ["Bank", "Terpakai", "Sisa"],
      ["Seabank", "Rp 200.000", "Rp 800.000"],
    ],
    truncatedRows: false,
    truncatedCols: false,
  });
  assert.match(usageText, /Bank \| Terpakai \| Sisa/);
  assert.match(usageText, /Seabank \| Rp 200\.000 \| Rp 800\.000/);

  const preview = formatDraftPreview("update_allocations", {
    updates: [{ kategori: "Makan", oldPercent: 30, newPercent: 35, expectedPercent: 30 }],
    newTotalPercent: 55,
  });
  assert.match(preview, /Makan: 30% → 35%/);
  assert.match(preview, /Total Alokasi Baru: 55%/);
  assert.match(preview, /belum 100%/i);

  let sentPayload = null;
  const fakeSheets = {
    updateAllocations: async (p) => {
      sentPayload = p;
      return { updated: [{ kategori: "Makan", oldPercent: 30, newPercent: 35 }], totalPercent: 55 };
    },
  };
  const msg = await executeConfirmedAction(
    { kind: "update_allocations", payload: { updates: [{ kategori: "Makan", percent: 35, expectedPercent: 30 }] } },
    fakeSheets
  );
  assert.equal(sentPayload.updates[0].percent, 35);
  assert.match(msg, /Makan.*35%/);
  assert.match(msg, /55%/);

  const structuredUsage = {
    sheetName: "Usage",
    structured: true,
    title: "Penggunaan Tahun 2026",
    month: "November",
    availableMonths: ["Januari", "November", "Desember"],
    items: [
      { kategori: "Transportasi", percent: 0, amount: 120000 },
      { kategori: "Makan", percent: 0, amount: 30000 },
    ],
    total: 150000,
    monthlyTotals: [
      { month: "Januari", total: 0 },
      { month: "November", total: 150000 },
      { month: "Desember", total: 0 },
    ],
    yearTotal: 150000,
  };
  const monthText = formatUsageText(structuredUsage, { view: "month" });
  assert.match(monthText, /Penggunaan Tahun 2026/);
  assert.match(monthText, /Bulan: November/);
  assert.match(monthText, /Transportasi: Rp 120\.000/);
  assert.match(monthText, /Total Realisasi November: Rp 150\.000/);

  const yearText = formatUsageText(structuredUsage, { view: "year" });
  assert.match(yearText, /Rekap Usage/);
  assert.match(yearText, /November: Rp 150\.000/);
  assert.match(yearText, /Total: Rp 150\.000/);
});
