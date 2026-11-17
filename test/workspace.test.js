import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createWorkspaceStore } from "../src/services/workspace.js";
import { createPendingActionsStore } from "../src/services/pending.js";

test("workspaceStore persists active_context per user and resolves short callback refs", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const store = createWorkspaceStore(db);
    assert.equal(await store.getActiveContext("123"), null);

    await store.setActiveContext({
      userId: "123",
      platform: "trello",
      sourceId: "board_1",
      sourceName: "Development Tracker",
      extra: { listCount: 27 },
    });

    await store.setActiveContext({
      userId: "123",
      platform: "notion",
      sourceId: "00000000-0000-0000-0000-000000000001",
      sourceName: "Testing SupportTA",
      extra: { kind: "database" },
    });

    const active = await store.getActiveContext("123");
    assert.equal(active.platform, "notion");
    assert.equal(active.sourceId, "00000000-0000-0000-0000-000000000001");
    assert.equal(active.sourceName, "Testing SupportTA");
    assert.deepEqual(active.extra, { kind: "database" });

    const longPayload = {
      platform: "kb",
      action: "read",
      path: "Projects/telegram-ai-bot/very/deep/nested/ArchitectureDecisionRecord.md",
      page: 2,
    };
    const ref = await store.createCallbackRef(longPayload);
    assert.ok(ref.length <= 16);
    assert.ok(`menu:ws:r:${ref}`.length <= 64);
    assert.deepEqual(await store.resolveCallbackRef(ref), longPayload);
    assert.equal(await store.resolveCallbackRef("nonexist"), null);
  } finally {
    db.end();
  }
});

test("pending.js exports createPendingActionsStore independently", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const store = createPendingActionsStore(db);
    const created = await store.create({
      userId: "123",
      kind: "trello_move_card",
      payload: { cardId: "c1", targetListId: "l2" },
      summaryText: "Move card",
    });
    assert.equal(created.kind, "trello_move_card");
  } finally {
    db.end();
  }
});
