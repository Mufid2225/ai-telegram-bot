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
