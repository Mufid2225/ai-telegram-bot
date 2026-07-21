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
