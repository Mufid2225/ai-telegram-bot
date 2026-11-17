import test from "node:test";
import assert from "node:assert/strict";
import { createNotionService } from "../src/services/notion.js";

const cfg = { notionApiKey: "ntn_test_secret_123" };

test("notionService enforces configuration", async () => {
  const unconfigured = createNotionService({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(() => unconfigured.listConnectedSources(), /NOTION_API_KEY/);
});

test("listConnectedSources paginates search and separates databases/root pages from row pages", async () => {
  const service = createNotionService(cfg, async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    assert.match(String(url), /\/v1\/search$/);
    if (!body.start_cursor) {
      return new Response(
        JSON.stringify({
          results: [
            { object: "database", id: "db-1", title: [{ plain_text: "Test Cases" }], url: "https://notion.so/db1", parent: { type: "page_id", page_id: "root-1" } },
            { object: "page", id: "row-1", url: "https://notion.so/row1", parent: { type: "database_id", database_id: "db-1" }, properties: { Name: { type: "title", title: [{ plain_text: "Row 1" }] } } },
          ],
          has_more: true,
          next_cursor: "cur2",
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        results: [
          { object: "page", id: "root-1", url: "https://notion.so/root1", parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "Testing SupportTA" }] } } },
        ],
        has_more: false,
        next_cursor: null,
      }),
      { status: 200 }
    );
  });

  const sources = await service.listConnectedSources();
  assert.equal(sources.databases.length, 1);
  assert.equal(sources.databases[0].title, "Test Cases");
  assert.equal(sources.pages.length, 1);
  assert.equal(sources.pages[0].title, "Testing SupportTA");
});

test("getDatabaseOverview parses schema, validates select options, and verifies create/update with GET read-back", async () => {
  const calls = [];
  const schemaDb = {
    id: "db-1",
    title: [{ plain_text: "Testing SupportTA - Test Cases" }],
    url: "https://notion.so/db1",
    properties: {
      "Name Scenario": { type: "title" },
      "ID scenario": { type: "number" },
      "Status Test": { type: "status", status: { options: [{ name: "Not Started" }, { name: "Pass" }] } },
      Modul: { type: "select", select: { options: [{ name: "Auth" }, { name: "Billing" }] } },
      "Trello Card": { type: "url" },
    },
  };

  const service = createNotionService(cfg, async (url, init = {}) => {
    const u = String(url);
    const m = init.method || "GET";
    calls.push({ url: u, method: m, body: init.body ? JSON.parse(init.body) : null });

    if (u.endsWith("/databases/db-1") && m === "GET") {
      return new Response(JSON.stringify(schemaDb), { status: 200 });
    }
    if (u.endsWith("/databases/db-1/query") && m === "POST") {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "pg-1",
              url: "https://notion.so/pg1",
              properties: {
                "Name Scenario": { type: "title", title: [{ plain_text: "Login Valid" }] },
                "Status Test": { type: "status", status: { name: "Pass" } },
                Modul: { type: "select", select: { name: "Auth" } },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 }
      );
    }
    if (u.endsWith("/pages") && m === "POST") {
      return new Response(JSON.stringify({ id: "pg-2", url: "https://notion.so/pg2", properties: {} }), { status: 200 });
    }
    if (u.endsWith("/pages/pg-2") && m === "GET") {
      return new Response(
        JSON.stringify({
          id: "pg-2",
          url: "https://notion.so/pg2",
          parent: { type: "database_id", database_id: "db-1" },
          properties: {
            "Name Scenario": { type: "title", title: [{ plain_text: "Logout Flow" }] },
            Modul: { type: "select", select: { name: "Auth" } },
          },
        }),
        { status: 200 }
      );
    }
    if (u.endsWith("/pages/pg-2") && m === "PATCH") {
      return new Response(JSON.stringify({ id: "pg-2", url: "https://notion.so/pg2", archived: false }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  });

  const ov = await service.getDatabaseOverview("db-1");
  assert.equal(ov.title, "Testing SupportTA - Test Cases");
  assert.equal(ov.schema.length, 5);
  assert.equal(ov.rows[0].title, "Login Valid");

  await assert.rejects(
    () => service.createDatabasePage({ databaseId: "db-1", values: { "Name Scenario": "X", Modul: "UnknownMod" } }),
    /Modul/
  );

  const created = await service.createDatabasePage({
    databaseId: "db-1",
    values: { "Name Scenario": "Logout Flow", Modul: "Auth", "ID scenario": 12 },
  });
  assert.equal(created.id, "pg-2");
  assert.equal(created.verified, true);
  assert.equal(calls.some((c) => c.method === "GET" && c.url.endsWith("/pages/pg-2")), true);

  const updated = await service.updatePage({ pageId: "pg-2", values: { "Status Test": "Pass" } });
  assert.equal(updated.verified, true);
  assert.equal(calls.some((c) => c.method === "DELETE"), false);
});
