import test from "node:test";
import assert from "node:assert/strict";
import { splitTelegramText, truncateCaption } from "../src/utils/telegram.js";

test("chunks replies within Telegram limit", () => {
  const chunks = splitTelegramText("word ".repeat(2000));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), "word ".repeat(2000).trim());
});

test("caps captions", () => assert.equal(truncateCaption("x".repeat(2000)).length, 1024));
