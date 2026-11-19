import { formatAIHttpError, formatAINetworkError, redactSecrets } from "../utils/errors.js";

export function stripMarkdown(text) {
  return text.replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1").replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
}

function parseSseContent(raw) {
  let content = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try { content += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? ""; } catch {}
  }
  return content;
}

async function fetchWithRetry(config, fetchImpl, payload, ctx) {
  for (let retry = 0; retry < 3; retry++) {
    await ctx?.telegram?.sendChatAction(ctx.chat.id, "typing");
    let resp;
    try {
      resp = await fetchImpl(`${config.routerBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.routerApiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (retry < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
        continue;
      }
      return { errorReply: formatAINetworkError(error) };
    }

    if ((resp.status === 429 || resp.status === 503) && retry < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2500 * (retry + 1)));
      continue;
    }
    const raw = await resp.text().catch(() => "");
    if (!resp.ok) return { errorReply: formatAIHttpError(resp.status, raw) };
    if (!raw.trim()) continue;
    try {
      return { data: JSON.parse(raw) };
    } catch {
      const content = parseSseContent(raw);
      return { textReply: content ? stripMarkdown(content) : "Maaf, respon AI kosong. Coba ulangi sebentar lagi ya." };
    }
  }
  return { errorReply: "⏳ AI sedang sibuk dan belum merespons setelah beberapa percobaan. Coba lagi sebentar ya." };
}

async function runToolCall(tc, executeTool, toolContext) {
  let args = {};
  try {
    args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
  } catch (err) {
    return `Error: argumen tool bukan JSON valid (${err.message}).`;
  }
  try {
    const out = await executeTool(tc.function?.name, args, toolContext);
    return typeof out === "string" ? out : JSON.stringify(out);
  } catch (err) {
    return `Error: ${redactSecrets(err.message)}`;
  }
}

export function createAIService(config, fetchImpl = fetch) {
  return async function callAI(messages, ctx, options = {}) {
    const hasTools = Boolean(options.tools?.length && typeof options.executeTool === "function");
    const maxSteps = options.maxSteps ?? 6;
    const conversation = [...messages];

    for (let step = 0; step < (hasTools ? maxSteps : 1); step++) {
      const payload = { model: config.routerModel, messages: conversation, stream: false };
      if (hasTools) payload.tools = options.tools;

      const res = await fetchWithRetry(config, fetchImpl, payload, ctx);
      if (res.errorReply) return res.errorReply;
      if (res.textReply !== undefined) return res.textReply;

      const message = res.data?.choices?.[0]?.message;
      if (hasTools && message?.tool_calls?.length) {
        conversation.push(message);
        for (const tc of message.tool_calls) {
          const output = await runToolCall(tc, options.executeTool, options.toolContext);
          conversation.push({ role: "tool", tool_call_id: tc.id, content: output });
        }
        continue;
      }

      const content = message?.content;
      return content?.trim() ? stripMarkdown(content) : "Maaf, respon AI kosong. Coba tanyakan dengan kalimat lain ya.";
    }

    return "⚠️ Permintaan memicu terlalu banyak langkah (batas langkah tercapai). Coba pecah pertanyaannya jadi lebih singkat ya.";
  };
}
