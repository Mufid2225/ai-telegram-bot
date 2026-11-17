import test from "node:test";
import assert from "node:assert/strict";
import { createSuperhumanService } from "../src/services/superhuman.js";

const cfg = { superhumanApiToken: "sh_tok_test_789" };

test("superhumanService checks configuration cleanly", async () => {
  const unconfigured = createSuperhumanService({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(() => unconfigured.listDocs(), /SUPERHUMAN_API_TOKEN/);
});

test("getDocOverview checks ACL write status and prioritizes named tables over generic Table N", async () => {
  const service = createSuperhumanService(cfg, async (url) => {
    const u = String(url);
    if (u.endsWith("/docs/doc_sample_1")) {
      return new Response(JSON.stringify({ id: "doc_sample_1", name: "TA RPL 3", browserLink: "https://docs.superhuman.com/d/_ddoc_sample_1" }), { status: 200 });
    }
    if (u.includes("/acl/permissions")) {
      return new Response(JSON.stringify({ items: [{ access: "write" }] }), { status: 200 });
    }
    if (u.includes("/pages")) {
      return new Response(JSON.stringify({ items: [{ id: "canvas-1", name: "Website App" }] }), { status: 200 });
    }
    if (u.includes("/tables")) {
      return new Response(
        JSON.stringify({
          items: [
            { id: "grid-99", name: "Table 1" },
            { id: "grid-web", name: "Task Tim Web" },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("Not found", { status: 404 });
  });

  const ov = await service.getDocOverview("doc_sample_1");
  assert.equal(ov.doc.name, "TA RPL 3");
  assert.equal(ov.canWrite, true);
  assert.equal(ov.pages.length, 1);
  assert.equal(ov.tables[0].name, "Task Tim Web");
  assert.equal(ov.tables[1].name, "Table 1");
});

test("insertRows omits empty cells, polls mutationStatus, and blocks write when ACL is read-only", async () => {
  let postedBody = null;
  let pollCount = 0;

  const service = createSuperhumanService(
    cfg,
    async (url, init = {}) => {
      const u = String(url);
      if (u.includes("/acl/permissions")) {
        return new Response(JSON.stringify({ items: [{ access: "write" }] }), { status: 200 });
      }
      if (u.includes("/columns")) {
        return new Response(
          JSON.stringify({
            items: [
              { id: "c-1", name: "Task" },
              { id: "c-2", name: "Status" },
              { id: "c-3", name: "Tenggat" },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.includes("/rows") && init.method === "POST") {
        postedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ requestId: "req-123" }), { status: 202 });
      }
      if (u.endsWith("/mutationStatus/req-123")) {
        pollCount++;
        return new Response(JSON.stringify({ completed: pollCount >= 2 }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    },
    { pollDelayMs: 0 }
  );

  const res = await service.insertRows("doc_sample_1", "grid-web", {
    rows: [{ Task: "Fix Navbar", Status: "To Do", Tenggat: null }],
  });
  assert.equal(res.completed, true);
  assert.equal(pollCount, 2);
  assert.deepEqual(postedBody.rows[0].cells, [
    { column: "c-1", value: "Fix Navbar" },
    { column: "c-2", value: "To Do" },
  ]);

  const readOnlyService = createSuperhumanService(cfg, async (url) => {
    if (String(url).includes("/acl/permissions")) {
      return new Response(JSON.stringify({ items: [{ access: "readonly" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  await assert.rejects(
    () => readOnlyService.insertRows("doc_sample_1", "grid-web", { rows: [{ Task: "X" }] }),
    /read-only|izin tulis/i
  );
});
