import test from "node:test";
import assert from "node:assert/strict";
import { createAIService } from "../src/services/ai.js";

const cfg = {
  routerBaseUrl: "https://router.local/v1",
  routerApiKey: "test-key",
  routerModel: "test-model",
};

const fakeCtx = {
  chat: { id: 1 },
  telegram: { sendChatAction: async () => {} },
};

test("callAI works without tools and strips markdown", async () => {
  const bodies = [];
  const callAI = createAIService(cfg, async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Halo **dunia** dan `kode`" } }],
    }), { status: 200 });
  });

  const reply = await callAI([{ role: "user", content: "hi" }], fakeCtx);
  assert.equal(reply, "Halo dunia dan kode");
  assert.equal("tools" in bodies[0], false);
});

test("callAI runs tool_calls loop and returns final assistant reply", async () => {
  const payloads = [];
  let turn = 0;
  const callAI = createAIService(cfg, async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    turn++;
    if (turn === 1) {
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "get_sum", arguments: '{"a":2,"b":3}' } }],
          },
        }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hasilnya 5." } }],
    }), { status: 200 });
  });

  const executed = [];
  const reply = await callAI(
    [{ role: "user", content: "2+3?" }],
    fakeCtx,
    {
      tools: [{ type: "function", function: { name: "get_sum", parameters: { type: "object" } } }],
      executeTool: async (name, args, ctx) => {
        executed.push({ name, args, ctx });
        return String(args.a + args.b);
      },
      toolContext: { userId: "1" },
    }
  );

  assert.equal(reply, "Hasilnya 5.");
  assert.equal(executed.length, 1);
  assert.deepEqual(executed[0], { name: "get_sum", args: { a: 2, b: 3 }, ctx: { userId: "1" } });
  assert.equal(payloads.length, 2);
  const toolMsg = payloads[1].messages.at(-1);
  assert.deepEqual(toolMsg, { role: "tool", tool_call_id: "call_1", content: "5" });
});

test("callAI handles malformed tool arguments and enforces maxSteps", async () => {
  let step = 0;
  const callAI = createAIService(cfg, async () => {
    step++;
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `c_${step}`, type: "function", function: { name: "loop", arguments: "{invalid" } }],
        },
      }],
    }), { status: 200 });
  });

  const seen = [];
  const reply = await callAI([{ role: "user", content: "loop" }], fakeCtx, {
    tools: [{ type: "function", function: { name: "loop", parameters: { type: "object" } } }],
    executeTool: async (_name, args) => {
      seen.push(args);
      return "ok";
    },
    maxSteps: 2,
  });

  assert.equal(step, 2);
  assert.equal(seen.length, 0);
  assert.match(reply, /batas langkah|terlalu banyak/i);
});

test("callAI returns informative Indonesian errors on 401, 429, and network failures", async () => {
  const err401 = createAIService(cfg, async () => new Response(
    JSON.stringify({ error: { message: "Invalid gateway API key." } }),
    { status: 401 }
  ));
  const msg401 = await err401([{ role: "user", content: "hi" }], fakeCtx);
  assert.match(msg401, /401/);
  assert.match(msg401, /ROUTER_API_KEY/);
  assert.match(msg401, /Invalid gateway API key/);

  const errNet = createAIService(cfg, async () => {
    const e = new Error("connect ECONNREFUSED");
    e.code = "ECONNREFUSED";
    throw e;
  });
  const msgNet = await errNet([{ role: "user", content: "hi" }], fakeCtx);
  assert.match(msgNet, /terhubung ke AI Router/i);
  assert.match(msgNet, /ECONNREFUSED/);
});
