import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/database.js";
import { createWorkspaceStore } from "../src/services/workspace.js";
import { createKBService } from "../src/services/kb.js";
import { handleWorkspaceMenuAction } from "../src/handlers/workspace-menu.js";

function assertAllCallbacksSafe(view) {
  const rows = view?.extra?.reply_markup?.inline_keyboard || [];
  for (const btn of rows.flat()) {
    assert.ok(Buffer.byteLength(btn.callback_data, "utf8") <= 64, `callback_data > 64 bytes: ${btn.callback_data}`);
  }
}

test("workspace menu handles Trello live picker, board overview pagination, and active_context", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  try {
    const workspaceStore = createWorkspaceStore(db);
    const trelloService = {
      listBoards: async () => [{ id: "board_long_id_123", name: "Development Tracker", closed: false }],
      getBoardOverview: async (boardId, { page = 0 }) => ({
        board: { id: boardId, name: "Development Tracker", shortUrl: "https://trello.com/b/1" },
        page,
        pageSize: 10,
        totalLists: 15,
        totalPages: 2,
        totalOpenCards: 584,
        lists: page === 0
          ? [{ id: "l1", name: "To Do", cardCount: 14, duplicate: false }, { id: "l2", name: "FIX", cardCount: 5, duplicate: true }]
          : [{ id: "l11", name: "In Progress", cardCount: 3, duplicate: false }],
        recentCards: [{ id: "c1", name: "Bug Login", listName: "To Do" }],
      }),
    };

    const listView = await handleWorkspaceMenuAction({ action: "ws:trello", userId: "123", workspaceStore, trelloService });
    assertAllCallbacksSafe(listView);
    const boardBtn = listView.extra.reply_markup.inline_keyboard[0][0];
    assert.match(boardBtn.text, /Development Tracker/);

    const boardAction = boardBtn.callback_data.replace(/^menu:/, "");
    const ovView = await handleWorkspaceMenuAction({ action: boardAction, userId: "123", workspaceStore, trelloService });
    assertAllCallbacksSafe(ovView);
    assert.match(ovView.text, /Development Tracker/);
    assert.match(ovView.text, /584 card aktif/);
    assert.match(ovView.text, /Hal 1\/2/);
    assert.match(ovView.text, /ketik perintah/i);

    const active = await workspaceStore.getActiveContext("123");
    assert.equal(active.platform, "trello");
    assert.equal(active.sourceName, "Development Tracker");
  } finally {
    db.end();
  }
});

test("workspace menu handles Notion, Superhuman Docs, KB, and expired refs safely", async () => {
  const db = createDatabase(":memory:", { quiet: true });
  const tmpKb = await fs.mkdtemp(path.join(os.tmpdir(), "kb-menu-"));
  try {
    await fs.writeFile(path.join(tmpKb, "Home.md"), "Line 1\nLine 2\nLine 3");
    const workspaceStore = createWorkspaceStore(db);
    const kbService = createKBService({ kbDir: tmpKb });

    const notionService = {
      listConnectedSources: async () => ({
        databases: [{ id: "00000000-0000-0000-0000-000000000001", title: "Testing SupportTA - Test Cases" }],
        pages: [],
      }),
      getDatabaseOverview: async (id) => ({
        id,
        title: "Testing SupportTA - Test Cases",
        schema: [{ name: "Name Scenario", type: "title", options: [] }, { name: "Modul", type: "select", options: ["Auth"] }],
        rows: [{ id: "r1", title: "Scenario 1", fields: { Modul: "Auth" } }],
        hasMore: false,
      }),
    };

    const superhumanService = {
      listDocs: async () => [{ id: "doc_sample_1", name: "TA RPL 3" }],
      getDocOverview: async () => ({
        doc: { id: "doc_sample_1", name: "TA RPL 3" },
        canWrite: true,
        pages: [{ id: "p1", name: "Website App" }],
        tables: [{ id: "grid-web", name: "Task Tim Web" }],
      }),
      getTableOverview: async () => ({
        columns: [{ id: "c1", name: "Task" }],
        rows: [{ id: "rw1", name: "Navbar", values: { Task: "Navbar" } }],
        nextPageToken: null,
      }),
    };

    const ntList = await handleWorkspaceMenuAction({ action: "ws:notion", userId: "123", workspaceStore, notionService });
    assertAllCallbacksSafe(ntList);
    const ntDbAction = ntList.extra.reply_markup.inline_keyboard[0][0].callback_data.replace(/^menu:/, "");
    const ntOv = await handleWorkspaceMenuAction({ action: ntDbAction, userId: "123", workspaceStore, notionService });
    assertAllCallbacksSafe(ntOv);
    assert.match(ntOv.text, /Testing SupportTA - Test Cases/);
    assert.equal((await workspaceStore.getActiveContext("123")).platform, "notion");

    const shList = await handleWorkspaceMenuAction({ action: "ws:superhuman", userId: "123", workspaceStore, superhumanService });
    const shDocAction = shList.extra.reply_markup.inline_keyboard[0][0].callback_data.replace(/^menu:/, "");
    const shOv = await handleWorkspaceMenuAction({ action: shDocAction, userId: "123", workspaceStore, superhumanService });
    assertAllCallbacksSafe(shOv);
    assert.match(shOv.text, /TA RPL 3/);
    assert.match(shOv.text, /Baca & Tulis/);

    const tblBtn = shOv.extra.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("Task Tim Web"));
    const shTbl = await handleWorkspaceMenuAction({ action: tblBtn.callback_data.replace(/^menu:/, ""), userId: "123", workspaceStore, superhumanService });
    assert.match(shTbl.text, /Navbar/);

    const kbRoot = await handleWorkspaceMenuAction({ action: "ws:kb", userId: "123", workspaceStore, kbService });
    assertAllCallbacksSafe(kbRoot);
    const homeBtn = kbRoot.extra.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("Home.md"));
    const kbNote = await handleWorkspaceMenuAction({ action: homeBtn.callback_data.replace(/^menu:/, ""), userId: "123", workspaceStore, kbService });
    assert.match(kbNote.text, /Line 1/);

    const expired = await handleWorkspaceMenuAction({ action: "ws:r:deadbeef", userId: "123", workspaceStore });
    assert.match(expired.text, /kedaluwarsa|tidak ditemukan/i);

    const calendarService = {
      listCalendars: async () => [
        { id: "primary", name: "Kalender Utama", isPrimary: true, isOwnedByMe: true },
        { id: "cal_kuliah_long_id_001", name: "Jadwal Kuliah", isPrimary: false, isOwnedByMe: true },
      ],
      listEvents: async () => [
        {
          id: "ev1",
          calendarId: "primary",
          calendarName: "Kalender Utama",
          title: "Bimbingan Skripsi",
          startIso: "2026-11-19T10:00:00+07:00",
          endIso: "2026-11-19T11:00:00+07:00",
          isAllDay: false,
          location: "R. Dosen",
        },
      ],
    };

    const calOv = await handleWorkspaceMenuAction({ action: "ws:calendar", userId: "123", workspaceStore, calendarService });
    assertAllCallbacksSafe(calOv);
    assert.match(calOv.text, /Google Calendar/);
    assert.match(calOv.text, /Bimbingan Skripsi/);
    assert.equal((await workspaceStore.getActiveContext("123")).platform, "calendar");

    const pickBtn = calOv.extra.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("Pilih Kalender"));
    const calPick = await handleWorkspaceMenuAction({ action: pickBtn.callback_data.replace(/^menu:/, ""), userId: "123", workspaceStore, calendarService });
    assertAllCallbacksSafe(calPick);
    const subCalBtn = calPick.extra.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("Jadwal Kuliah"));
    const subCalOv = await handleWorkspaceMenuAction({ action: subCalBtn.callback_data.replace(/^menu:/, ""), userId: "123", workspaceStore, calendarService });
    assert.match(subCalOv.text, /Jadwal Kuliah/);
    assert.equal((await workspaceStore.getActiveContext("123")).sourceId, "cal_kuliah_long_id_001");
  } finally {
    db.end();
    await fs.rm(tmpKb, { recursive: true, force: true });
  }
});
