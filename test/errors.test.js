import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, formatAIHttpError, formatFriendlyError } from "../src/utils/errors.js";
import { requestJson } from "../src/utils/http.js";

test("redactSecrets hides bot tokens, bearer keys, Apps Script URLs, Trello query secrets, and extra secrets", () => {
  const dummyBot = ["12345", "AASECRET"].join(":");
  const dummyTrelloKey = ["abc", "123"].join("");
  const dummyTrelloTok = ["ATTAtok", "123456789"].join("");
  const dummyNotion = ["ntn_", "secret987654"].join("");
  const dirty = `https://api.telegram.org/bot${dummyBot}/sendPhoto Bearer sk-secret https://script.google.com/macros/s/AKfycb123/exec https://api.trello.com/1/boards?key=${dummyTrelloKey}&token=${dummyTrelloTok} ${dummyNotion} customVal999`;
  const clean = redactSecrets(dirty, ["customVal999"]);
  assert.equal(clean.includes("AASECRET"), false);
  assert.equal(clean.includes("sk-secret"), false);
  assert.equal(clean.includes("AKfycb123"), false);
  assert.equal(clean.includes(dummyTrelloKey), false);
  assert.equal(clean.includes(dummyTrelloTok), false);
  assert.equal(clean.includes(dummyNotion), false);
  assert.equal(clean.includes("customVal999"), false);
  assert.match(clean, /\[REDACTED\]/);
});

test("requestJson scrubs network errors and attaches status on HTTP failure", async () => {
  await assert.rejects(
    () => requestJson("https://api.trello.com/1/members/me/boards?key=mykey12&token=mytok123", {}, {
      label: "Trello",
      extraSecrets: ["mykey12", "mytok123"],
      fetchImpl: async () => {
        throw new Error("request to https://api.trello.com/1/members/me/boards?key=mykey12&token=mytok123 failed");
      },
    }),
    (err) => {
      assert.equal(err.message.includes("mykey12"), false);
      assert.equal(err.message.includes("mytok123"), false);
      assert.match(err.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("formatAIHttpError gives clear hints per HTTP status", () => {
  assert.match(formatAIHttpError(401, '{"error":{"message":"bad key"}}'), /ROUTER_API_KEY/);
  assert.match(formatAIHttpError(404, ""), /ROUTER_MODEL/);
  assert.match(formatAIHttpError(429, ""), /rate limit/i);
  assert.match(formatAIHttpError(503, ""), /gangguan/i);
});

test("formatFriendlyError explains Google Sheets auth, CalendarApp permission, and config errors clearly", () => {
  assert.match(formatFriendlyError(new Error("Unauthorized: secret tidak cocok."), "membaca ringkasan"), /SHEET_API_SECRET/);
  assert.match(formatFriendlyError(new Error("SHEET_WEBHOOK_URL kosong"), "membaca ringkasan"), /SHEET_WEBHOOK_URL/);
  assert.match(
    formatFriendlyError(new Error("Exception: You do not have permission to call CalendarApp.getDefaultCalendar"), "membaca jadwal"),
    /authorizeCalendar/
  );
  assert.match(formatFriendlyError(new Error("socket hang up"), "mengirim foto"), /terputus\/timeout/);
});
