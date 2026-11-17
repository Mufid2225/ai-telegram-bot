import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKBService } from "../src/services/kb.js";

test("kbService enforces KB_DIR config and blocks path traversal", async () => {
  const unconfigured = createKBService({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(() => unconfigured.listDirectory(), /KB_DIR/);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kb-test-"));
  try {
    await fs.mkdir(path.join(tmpRoot, ".obsidian"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, ".obsidian", "app.json"), "{}");
    await fs.writeFile(path.join(tmpRoot, "Home.md"), "# Home\nWelcome to KB");
    await fs.mkdir(path.join(tmpRoot, "Skills"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "Skills", "Trello.md"),
      "line 1\nTrello board: Development Tracker\nline 3\nline 4\nline 5"
    );

    const kb = createKBService({ kbDir: tmpRoot });
    assert.equal(kb.isConfigured(), true);

    const root = await kb.listDirectory("");
    assert.deepEqual(root.items.map((i) => `${i.type}:${i.name}`), ["dir:Skills", "file:Home.md"]);

    const hits = await kb.searchNotes("development tracker", { limit: 5 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, "Skills/Trello.md");
    assert.match(hits[0].snippets[0].text, /Development Tracker/);

    const chunk1 = await kb.readNote("Skills/Trello.md", { startLine: 1, maxLines: 2 });
    assert.equal(chunk1.hasMore, true);
    assert.equal(chunk1.nextStartLine, 3);
    assert.match(chunk1.text, /Trello board/);

    await assert.rejects(() => kb.readNote("../outside.md"), /di luar folder Knowledge Base|tidak valid/i);
    await assert.rejects(() => kb.listDirectory("..\\..\\etc"), /di luar folder Knowledge Base|tidak valid/i);
    await assert.rejects(() => kb.readNote(path.resolve(tmpRoot, "..", "other.md")), /di luar folder Knowledge Base|tidak valid/i);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
