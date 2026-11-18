import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createPendingActionsStore } from "../src/services/pending.js";
import { handleWorkspaceActionCallback, executeWorkspaceAction } from "../src/handlers/actions.js";

function makeCallbackCtx(userId, messageText = "Draft Workspace") {
  const answers = [];
  const edits = [];
  return {
    from: { id: userId },
    callbackQuery: { message: { text: messageText } },
    answerCbQuery: async (txt) => answers.push(txt),
    editMessageText: async (txt, extra) => edits.push({ txt, extra }),
    _answers: answers,
    _edits: edits,
  };
}

test("executeWorkspaceAction executes trello, notion, and superhuman confirmed actions", async () => {
  let moved = null;
  let notionCreated = null;
  let superInserted = null;

  const services = {
    trelloService: {
      moveCard: async (p) => {
        moved = p;
        return { id: p.cardId, name: "Fix Auth", shortUrl: "https://trello.com/c/abc" };
      },
    },
    notionService: {
      createDatabasePage: async (p) => {
        notionCreated = p;
        return { id: "pg1", title: "Test Login", url: "https://notion.so/pg1" };
      },
    },
    superhumanService: {
      insertRows: async (docId, tableId, body) => {
        superInserted = { docId, tableId, body };
        return { completed: true };
      },
    },
    calendarService: {
      createEvent: async (p) => ({ id: "ev1", title: p.title, calendarName: "Kalender Utama" }),
      deleteEvent: async (p) => ({ deleted: true, eventId: p.eventId, title: p.expectedTitle }),
    },
  };

  const tMsg = await executeWorkspaceAction(
    { kind: "trello_move_card", payload: { boardName: "Dev", cardId: "c1", cardName: "Fix Auth", targetListId: "l2", targetListName: "In Progress" } },
    services
  );
  assert.match(tMsg, /Fix Auth.*In Progress/);
  assert.equal(moved.targetListId, "l2");

  const nMsg = await executeWorkspaceAction(
    { kind: "notion_create_page", payload: { databaseId: "db1", databaseName: "QA", values: { Name: "Test Login" } } },
    services
  );
  assert.match(nMsg, /Test Login/);
  assert.equal(notionCreated.databaseId, "db1");

  const sMsg = await executeWorkspaceAction(
    { kind: "superhuman_add_row", payload: { docId: "d1", docName: "TA", tableId: "t1", tableName: "Task Web", rows: [{ Task: "Build" }] } },
    services
  );
  assert.match(sMsg, /Task Web/);
  assert.equal(superInserted.rows, undefined);
  assert.equal(superInserted.body.rows[0].Task, "Build");

  const cCreateMsg = await executeWorkspaceAction(
    { kind: "calendar_create_event", payload: { calendarId: "primary", calendarName: "Kalender Utama", title: "Sidang TA", startIso: "2026-11-21T09:00:00+07:00", endIso: "2026-11-21T11:00:00+07:00" } },
    services
  );
  assert.match(cCreateMsg, /Sidang TA/);

  const cDelMsg = await executeWorkspaceAction(
    { kind: "calendar_delete_event", payload: { calendarId: "primary", eventId: "ev1", expectedTitle: "Sidang TA" } },
    services
  );
  assert.match(cDelMsg, /Sidang TA.*dihapus/i);
});

test("handleWorkspaceActionCallback confirms once, restores action buttons on error, and handles cancel", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    const draft = await pendingStore.create({
      userId: "123",
      kind: "trello_create_card",
      payload: { boardName: "Dev", listId: "l1", listName: "To Do", name: "Bug #1", desc: "" },
      summaryText: "Tambah card Bug #1",
    });

    const failCtx = makeCallbackCtx("123", "Draft Bug #1");
    await handleWorkspaceActionCallback({
      ctx: failCtx,
      actionType: "confirm",
      actionId: draft.id,
      allowedUserId: "123",
      pendingStore,
      services: {
        trelloService: {
          createCard: async () => { throw new Error("Network reset"); },
        },
      },
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.match(failCtx._edits.at(-1).txt, /Gagal menyimpan: Network reset/);
    assert.equal(failCtx._edits.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, `action:confirm:${draft.id}`);
    assert.equal((await pendingStore.getById(draft.id, "123")).status, "pending");

    const okCtx = makeCallbackCtx("123", "Draft Bug #1");
    await handleWorkspaceActionCallback({
      ctx: okCtx,
      actionType: "confirm",
      actionId: draft.id,
      allowedUserId: "123",
      pendingStore,
      services: {
        trelloService: {
          createCard: async (p) => ({ id: "c9", name: p.name, shortUrl: "https://trello.com/c/9" }),
        },
      },
      stepMs: 0,
      finishDelayMs: 0,
    });
    assert.match(okCtx._edits.at(-1).txt, /Bug #1/);
    assert.equal((await pendingStore.getById(draft.id, "123")).status, "confirmed");
  } finally {
    db.end();
  }
});
