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
