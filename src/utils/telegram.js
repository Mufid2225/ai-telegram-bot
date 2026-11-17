export function splitTelegramText(text, limit = 4000) {
  const value = String(text ?? "");
  if (!value) return [];
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = remaining.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function truncateCaption(text) {
  const value = String(text ?? "");
  return value.length <= 1024 ? value : `${value.slice(0, 1021)}...`;
}

export async function replyText(ctx, text) {
  for (const chunk of splitTelegramText(text)) await ctx.reply(chunk);
}

const MONEY_PENDING_KINDS = new Set([
  "add_expenses",
  "update_expense",
  "delete_expense",
  "upsert_income",
]);

export function buildConfirmExtra(pendingAction) {
  if (!pendingAction?.id) return undefined;
  const prefix = !pendingAction.kind || MONEY_PENDING_KINDS.has(pendingAction.kind) ? "money" : "action";
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Simpan", callback_data: `${prefix}:confirm:${pendingAction.id}` },
        { text: "❌ Batal", callback_data: `${prefix}:cancel:${pendingAction.id}` },
      ]],
    },
  };
}

export async function replyMaybeWithConfirm(ctx, text, pendingAction) {
  const chunks = splitTelegramText(text);
  const extra = buildConfirmExtra(pendingAction);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await ctx.reply(chunks[i], isLast && extra ? extra : undefined);
  }
}

export function formatLoadingBar(percent, width = 20) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  return `Loading ${"█".repeat(filled)}${"▒".repeat(width - filled)} ${clamped}%`;
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

async function tryEdit(editFn, text, extra) {
  try {
    await editFn(text, extra);
  } catch (err) {
    if (String(err?.message || "").includes("message is not modified")) return;
  }
}

async function deliverFinal(ctx, editFn, mode, text, extra) {
  if (mode === "edit") {
    try {
      await editFn(String(text).slice(0, 4000), extra);
    } catch (err) {
      if (!String(err?.message || "").includes("message is not modified")) throw err;
    }
    return;
  }

  const chunks = splitTelegramText(text);
  if (!chunks.length) {
    await tryEdit(editFn, "Selesai.", extra);
    return;
  }
  await editFn(chunks[0], chunks.length === 1 ? extra : undefined);
  for (let i = 1; i < chunks.length; i++) {
    await ctx.reply(chunks[i], i === chunks.length - 1 ? extra : undefined);
  }
}

export async function runWithProgress({
  ctx,
  mode = "reply",
  stepMs = 100,
  finishDelayMs = 0,
  task,
  formatResult = (value) => ({ text: String(value ?? "") }),
  formatError,
}) {
  let editFn;
  if (mode === "edit") {
    editFn = (text, extra) => ctx.editMessageText(text, extra);
    await tryEdit(editFn, formatLoadingBar(0));
  } else {
    const sent = await ctx.reply(formatLoadingBar(0));
    editFn = (text, extra) => ctx.telegram.editMessageText(sent.chat.id, sent.message_id, undefined, text, extra);
  }

  let taskDone = false;
  const taskPromise = Promise.resolve()
    .then(() => task())
    .finally(() => { taskDone = true; });
  taskPromise.catch(() => {});

  for (const pct of [25, 50, 75]) {
    if (!taskDone) await sleep(stepMs);
    await tryEdit(editFn, formatLoadingBar(pct));
  }

  let result;
  try {
    result = await taskPromise;
  } catch (error) {
    if (formatError) {
      const errOut = formatError(error);
      await deliverFinal(ctx, editFn, mode, errOut.text, errOut.extra);
      return null;
    }
    throw error;
  }

  await tryEdit(editFn, formatLoadingBar(100));
  if (finishDelayMs > 0) await sleep(finishDelayMs);

  const formatted = formatResult(result);
  if (formatted?.text !== undefined) {
    await deliverFinal(ctx, editFn, mode, formatted.text, formatted.extra);
  }
  return result;
}
