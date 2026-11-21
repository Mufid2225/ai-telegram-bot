import test from "node:test";
import assert from "node:assert/strict";
import { createSheetsService } from "../src/services/sheets.js";

test("sheets service reports unconfigured state and throws clear error", async () => {
  const sheets = createSheetsService({ sheetWebhookUrl: "", sheetApiSecret: "" });
  assert.equal(sheets.isConfigured(), false);
  await assert.rejects(() => sheets.getSummary({}), /SHEET_WEBHOOK_URL/);
});

test("sheets service sends POST with redirect follow and secret", async () => {
  const calls = [];
  const sheets = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec-123" },
    async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, data: { banks: ["Cash", "Seabank"] } }), { status: 200 });
    }
  );

  assert.equal(sheets.isConfigured(), true);
  const res = await sheets.getContext();
  assert.deepEqual(res, { banks: ["Cash", "Seabank"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://script.google.com/macros/s/test/exec");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "follow");
  assert.deepEqual(JSON.parse(calls[0].init.body), { secret: "sec-123", action: "get_context" });
});

test("sheets service surfaces Apps Script errors and HTTP failures", async () => {
  const errSheets = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec" },
    async () => new Response(JSON.stringify({ ok: false, error: "Invalid secret" }), { status: 200 })
  );
  await assert.rejects(() => errSheets.listExpenses({}), /Invalid secret/);

  const httpFail = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec" },
    async () => new Response("Server error", { status: 500 })
  );
  await assert.rejects(() => httpFail.addExpenses([]), /500/);
});

test("sheets service dispatches targets_* actions with expected payloads", async () => {
  const calls = [];
  const sheets = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec-123" },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true, data: { action: body.action } }), { status: 200 });
    }
  );

  await sheets.listTargets({ status: "Aktif" });
  await sheets.listTargetLogs({ targetId: "TGT-001", sourcePeriod: "2026-10", limit: 50 });
  await sheets.createTarget({ name: "Monitor", targetAmount: 2500000, note: "Promo" });
  await sheets.addTargetDeposit({ targetId: "TGT-001", amount: 500000, note: "Sisa Okt", sourcePeriod: "2026-10" });
  await sheets.updateTarget({ targetId: "TGT-001", expected: { name: "Monitor" }, patch: { status: "Ditunda" } });
  await sheets.deleteTargetLog({ logId: "LOG-001", rowNumber: 2, expected: { amount: 500000 } });

  assert.deepEqual(
    calls.map((c) => c.action),
    [
      "targets_list",
      "targets_logs",
      "targets_create",
      "targets_add_deposit",
      "targets_update",
      "targets_delete_log",
    ]
  );
  assert.equal(calls[0].status, "Aktif");
  assert.equal(calls[1].sourcePeriod, "2026-10");
  assert.equal(calls[2].targetAmount, 2500000);
  assert.equal(calls[3].sourcePeriod, "2026-10");
  assert.equal(calls[4].patch.status, "Ditunda");
  assert.equal(calls[5].logId, "LOG-001");
});

test("sheets service dispatches get_income_overview, update_allocations, and get_usage", async () => {
  const calls = [];
  const sheets = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec-123" },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true, data: { action: body.action } }), { status: 200 });
    }
  );

  await sheets.getIncomeOverview({ month: "November", year: 2026 });
  await sheets.updateAllocations({ updates: [{ kategori: "Makan", percent: 25, expectedPercent: 20 }] });
  await sheets.getUsage({ maxRows: 40 });

  assert.deepEqual(
    calls.map((c) => c.action),
    ["get_income_overview", "update_allocations", "get_usage"]
  );
  assert.equal(calls[0].month, "November");
  assert.equal(calls[1].updates[0].percent, 25);
  assert.equal(calls[2].maxRows, 40);
});
