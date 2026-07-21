export function stripMarkdown(text) {
  return text.replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1").replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
}

export function createAIService(config, fetchImpl = fetch) {
  return async function callAI(messages, ctx) {
    for (let retry = 0; retry < 3; retry++) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const resp = await fetchImpl(`${config.routerBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.routerApiKey}` },
        body: JSON.stringify({ model: config.routerModel, messages, stream: false }),
        signal: AbortSignal.timeout(30000),
      });
      if ((resp.status === 429 || resp.status === 503) && retry < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * (retry + 1)));
        continue;
      }
      if (!resp.ok) return `AI error (${resp.status})`;
      const raw = await resp.text();
      if (!raw.trim()) continue;
      try {
        const content = JSON.parse(raw).choices?.[0]?.message?.content;
        return content?.trim() ? stripMarkdown(content) : "Maaf, respon AI kosong.";
      } catch {
        let content = "";
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try { content += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? ""; } catch {}
        }
        return content ? stripMarkdown(content) : "Maaf, respon AI kosong.";
      }
    }
    return "AI sibuk, coba lagi nanti.";
  };
}
