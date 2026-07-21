import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config.js";

const valid = { BOT_TOKEN: "x", ALLOWED_USER_ID: "1", ROUTER_BASE_URL: "http://localhost", ROUTER_API_KEY: "x", ROUTER_MODEL: "x" };

test("reports all missing required variables", () => {
  assert.throws(() => validateConfig({}), /BOT_TOKEN.*ALLOWED_USER_ID.*ROUTER_BASE_URL.*ROUTER_API_KEY.*ROUTER_MODEL/);
});

test("defaults retention and accepts absent provider keys", () => assert.equal(validateConfig(valid).retentionDays, 90));
test("rejects invalid retention", () => assert.throws(() => validateConfig({ ...valid, CONVERSATION_RETENTION_DAYS: "0" }), /positive integer/));
