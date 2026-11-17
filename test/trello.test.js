import test from "node:test";
import assert from "node:assert/strict";
import { createTrelloService } from "../src/services/trello.js";

const cfg = { trelloApiKey: "k_test_123", trelloApiToken: "ATTAtok_test_456" };

test("trelloService checks configuration cleanly", async () => {
  const unconfigured = createTrelloService({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(() => unconfigured.listBoards(), /TRELLO_API_KEY/);
});

test("listBoards filters closed boards by default and can include closed", async () => {
  const service = createTrelloService(cfg, async (url) => {
    assert.match(String(url), /\/1\/members\/me\/boards/);
    return new Response(
      JSON.stringify([
        { id: "b1", name: "Development Tracker", desc: "", shortUrl: "https://trello.com/b/1", closed: false, prefs: { permissionLevel: "public" } },
        { id: "b2", name: "Old Archive", desc: "", shortUrl: "https://trello.com/b/2", closed: true, prefs: { permissionLevel: "org" } },
      ]),
      { status: 200 }
    );
  });

  const active = await service.listBoards();
  assert.equal(active.length, 1);
  assert.equal(active[0].name, "Development Tracker");

  const all = await service.listBoards({ includeClosed: true });
  assert.equal(all.length, 2);
});

test("getBoardOverview paginates lists, marks duplicate list names, and sorts recent cards", async () => {
  const service = createTrelloService(cfg, async (url) => {
    const s = String(url);
    if (s.includes("/1/boards/b1/lists")) {
      return new Response(
        JSON.stringify([
          { id: "l1", name: "To Do", pos: 1 },
          { id: "l2", name: "FIX", pos: 2 },
          { id: "l3", name: "FIX", pos: 3 },
          { id: "l4", name: "Done", pos: 4 },
        ]),
        { status: 200 }
      );
    }
    if (s.includes("/1/boards/b1/cards")) {
      return new Response(
        JSON.stringify([
          { id: "c1", name: "Old Card", idList: "l1", dateLastActivity: "2026-11-01T10:00:00Z", shortUrl: "https://trello.com/c/1" },
          { id: "c2", name: "New Card", idList: "l2", dateLastActivity: "2026-11-17T10:00:00Z", shortUrl: "https://trello.com/c/2" },
          { id: "c3", name: "Mid Card", idList: "l3", dateLastActivity: "2026-11-10T10:00:00Z", shortUrl: "https://trello.com/c/3" },
        ]),
        { status: 200 }
      );
    }
    if (s.includes("/1/boards/b1")) {
      return new Response(JSON.stringify({ id: "b1", name: "Development Tracker", desc: "", shortUrl: "https://trello.com/b/1" }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  });

  const p0 = await service.getBoardOverview("b1", { page: 0, pageSize: 2 });
  assert.equal(p0.board.name, "Development Tracker");
  assert.equal(p0.totalLists, 4);
  assert.equal(p0.totalOpenCards, 3);
  assert.equal(p0.totalPages, 2);
  assert.equal(p0.lists.length, 2);
  assert.equal(p0.lists[0].name, "To Do");
  assert.equal(p0.lists[0].cardCount, 1);
  assert.equal(p0.lists[1].duplicate, true);
  assert.equal(p0.recentCards[0].name, "New Card");

  const p1 = await service.getBoardOverview("b1", { page: 1, pageSize: 2 });
  assert.equal(p1.lists[0].id, "l3");
  assert.equal(p1.lists[0].duplicate, true);
});

test("searchCards filters cleanly, and write operations never call DELETE and redact network URLs", async () => {
  const calls = [];
  const service = createTrelloService(cfg, async (url, init = {}) => {
    const s = String(url);
    calls.push({ url: s, method: init.method || "GET", body: init.body });
    if (s.includes("/1/boards/b1/lists")) {
      return new Response(JSON.stringify([{ id: "l1", name: "To Do" }, { id: "l2", name: "In Progress" }]), { status: 200 });
    }
    if (s.includes("/1/boards/b1/cards")) {
      return new Response(
        JSON.stringify([
          { id: "c1", name: "Bug Login Screen", idList: "l1", dateLastActivity: "2026-11-17T10:00:00Z", shortUrl: "https://trello.com/c/1" },
          { id: "c2", name: "Setup CI", idList: "l2", dateLastActivity: "2026-11-16T10:00:00Z", shortUrl: "https://trello.com/c/2" },
        ]),
        { status: 200 }
      );
    }
    if (s.includes("/1/cards/c1") && init.method === "PUT") {
      return new Response(JSON.stringify({ id: "c1", name: "Bug Login Screen", idList: "l2", shortUrl: "https://trello.com/c/1" }), { status: 200 });
    }
    if (s.includes("/1/cards") && init.method === "POST") {
      return new Response(JSON.stringify({ id: "c3", name: "New Card", idList: "l1", shortUrl: "https://trello.com/c/3" }), { status: 200 });
    }
    throw new Error("Unexpected URL " + s);
  });

  const hits = await service.searchCards("b1", "login", { limit: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].listName, "To Do");

  const created = await service.createCard({ listId: "l1", name: "New Card", desc: "Details" });
  assert.equal(created.id, "c3");

  const moved = await service.moveCard({ cardId: "c1", targetListId: "l2" });
  assert.equal(moved.idList, "l2");

  const archived = await service.updateCard({ cardId: "c1", closed: true });
  assert.equal(archived.id, "c1");

  assert.equal(calls.some((c) => c.method === "DELETE"), false);

  const failingService = createTrelloService(cfg, async () => {
    throw new Error(`request to https://api.trello.com/1/cards?key=${cfg.trelloApiKey}&token=${cfg.trelloApiToken} failed`);
  });
  await assert.rejects(
    () => failingService.listBoards(),
    (err) => !err.message.includes(cfg.trelloApiKey) && !err.message.includes(cfg.trelloApiToken)
  );
});
