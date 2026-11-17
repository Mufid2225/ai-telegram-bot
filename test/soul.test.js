import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { loadSoulPrompt, buildSystemPrompt } from "../src/utils/soul.js";

test("loadSoulPrompt loads SOUL.md content from project root and falls back if missing", () => {
  const soul = loadSoulPrompt();
  assert.match(soul, /Nerissa/i);
  assert.ok(soul.length > 40);

  const fallback = loadSoulPrompt(path.join(process.cwd(), "non-existent-soul.md"));
  assert.match(fallback, /Nerissa/i);
});

test("buildSystemPrompt combines SOUL.md with handler instructions", () => {
  const full = buildSystemPrompt("Tugas: bantu cek keuangan.");
  assert.match(full, /Nerissa/i);
  assert.match(full, /Tugas: bantu cek keuangan\./);
});
