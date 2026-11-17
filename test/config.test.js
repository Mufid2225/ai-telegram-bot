import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config.js";

const valid = { BOT_TOKEN: "x", ALLOWED_USER_ID: "1", ROUTER_BASE_URL: "http://localhost", ROUTER_API_KEY: "x", ROUTER_MODEL: "x" };

test("reports all missing required variables", () => {
  assert.throws(() => validateConfig({}), /BOT_TOKEN.*ALLOWED_USER_ID.*ROUTER_BASE_URL.*ROUTER_API_KEY.*ROUTER_MODEL/);
});

test("defaults retention and accepts absent provider keys", () => {
  const config = validateConfig(valid);
  assert.equal(config.retentionDays, 90);
  assert.equal(config.sheetWebhookUrl, "");
  assert.equal(config.sheetApiSecret, "");
  assert.equal(config.trelloApiKey, "");
  assert.equal(config.trelloApiToken, "");
  assert.equal(config.notionApiKey, "");
  assert.equal(config.superhumanApiToken, "");
  assert.equal(config.kbDir, "");
});

test("normalizes optional workspace and KB configuration", () => {
  const config = validateConfig({
    ...valid,
    TRELLO_API_KEY: " k1 ",
    TRELLO_API_TOKEN: " t1 ",
    NOTION_API_KEY: " ntn_123 ",
    SUPERHUMAN_API_TOKEN: " sh_456 ",
    KB_DIR: " /vault/configure ",
  });
  assert.equal(config.trelloApiKey, "k1");
  assert.equal(config.trelloApiToken, "t1");
  assert.equal(config.notionApiKey, "ntn_123");
  assert.equal(config.superhumanApiToken, "sh_456");
  assert.equal(config.kbDir, "/vault/configure");
});

test("normalizes optional MoneyTracker webhook config", () => {
  const config = validateConfig({
    ...valid,
    SHEET_WEBHOOK_URL: " https://script.google.com/macros/s/abc/exec/ ",
    SHEET_API_SECRET: " my-secret ",
  });
  assert.equal(config.sheetWebhookUrl, "https://script.google.com/macros/s/abc/exec");
  assert.equal(config.sheetApiSecret, "my-secret");
});

test("rejects invalid retention", () => assert.throws(() => validateConfig({ ...valid, CONVERSATION_RETENTION_DAYS: "0" }), /positive integer/));
