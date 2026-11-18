export function redactSecrets(text, extraSecrets = []) {
  let out = String(text ?? "")
    .replace(/\/(bot|user)(\d+):[^/\s]+/g, "/$1$2:[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|token)=)[^&\s"'`)]+/gi, "$1[REDACTED]")
    .replace(/\b(?:ntn|secret|ATTA)_[A-Za-z0-9_-]{8,}|\bATTA[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec/gi, "https://script.google.com/macros/s/[REDACTED]/exec");

  for (const secret of extraSecrets || []) {
    const val = String(secret ?? "").trim();
    if (val.length >= 6) out = out.split(val).join("[REDACTED]");
  }
  return out;
}

function extractUpstreamMessage(rawBody) {
  if (!rawBody) return "";
  try {
    const parsed = JSON.parse(rawBody);
    const msg = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof msg === "string" && msg.trim()) return redactSecrets(msg.trim()).slice(0, 140);
  } catch {}
  return redactSecrets(String(rawBody).trim()).slice(0, 120);
}

export function formatAIHttpError(status, rawBody = "") {
  const detail = extractUpstreamMessage(rawBody);
  const suffix = detail ? `\nDetail: ${detail}` : "";

  if (status === 401 || status === 403) {
    return (
      `⚠️ Akses ke AI Router ditolak (${status}).\n` +
      `Kemungkinan ROUTER_API_KEY di .env.local salah, kedaluwarsa, atau belum aktif. Cek key-nya lalu coba /test.${suffix}`
    );
  }
  if (status === 404) {
    return (
      `⚠️ Endpoint atau model AI tidak ditemukan (404).\n` +
      `Periksa ROUTER_BASE_URL dan ROUTER_MODEL di .env.local.${suffix}`
    );
  }
  if (status === 429) {
    return (
      `⏳ AI Router sedang kena batas permintaan / rate limit (429).\n` +
      `Tunggu sebentar lalu coba kirim ulang ya.${suffix}`
    );
  }
  if (status >= 500) {
    return (
      `⚠️ Server AI Router sedang gangguan (${status}).\n` +
      `Coba lagi sebentar lagi atau cek koneksi dengan /test.${suffix}`
    );
  }
  return `⚠️ AI Router mengembalikan error (${status}).${suffix}`;
}

export function formatAINetworkError(error) {
  const code = error?.cause?.code || error?.code || error?.name || "UNKNOWN";
  const msg = redactSecrets(error?.message || String(error));

  if (error?.name === "TimeoutError" || error?.name === "AbortError" || code === "ETIMEDOUT") {
    return "⏳ Koneksi ke AI Router timeout (>30 detik). Server router mungkin sedang lambat atau tidak merespons.";
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") {
    return (
      `🔌 Tidak bisa terhubung ke AI Router (${code}).\n` +
      `Pastikan layanan router menyala dan ROUTER_BASE_URL di .env.local benar.`
    );
  }
  return `⚠️ Gangguan koneksi ke AI Router (${code}): ${msg.slice(0, 140)}`;
}

export function formatFriendlyError(error, contextLabel = "memproses permintaan") {
  const raw = redactSecrets(error?.message || error?.code || String(error));
  const lower = raw.toLowerCase();

  if (lower.includes("calendarapp") || (lower.includes("permission") && lower.includes("calendar"))) {
    return (
      "🔐 Google Calendar belum diberi izin di Apps Script.\n" +
      "Buka editor Apps Script MoneyTracker -> jalankan fungsi authorizeCalendar sekali (klik Allow) -> Deploy -> Manage deployments -> Edit -> pilih New version."
    );
  }
  if (lower.includes("sheet_webhook_url") || lower.includes("belum dikonfigurasi")) {
    return "⚙️ Google Sheets belum terhubung. Lengkapi SHEET_WEBHOOK_URL dan SHEET_API_SECRET di .env.local dulu ya.";
  }
  if (lower.includes("unauthorized") || lower.includes("secret tidak cocok")) {
    return "🔐 Secret Google Sheets tidak cocok. Pastikan SHEET_API_SECRET di .env.local sama persis dengan Properti Skrip di Apps Script.";
  }
  if (lower.includes("bukan json")) {
    return "⚠️ Respon Apps Script tidak valid (bukan JSON). Pastikan Web App di-deploy dengan akses 'Siapa saja (Anyone)'.";
  }
  if (error?.status === 429 || lower.includes("(429)") || lower.includes("rate limit")) {
    return `⏳ Terlalu banyak request saat ${contextLabel} (429). Tunggu beberapa detik lalu ulangi ya.`;
  }
  if (lower.includes("401") || lower.includes("403")) {
    if (lower.includes("notion")) {
      return "🔐 Akses Notion ditolak (401/403). Cek NOTION_API_KEY dan pastikan halaman sudah di-connect (... -> Connections -> Connect to Opencode).";
    }
    return `🔐 Autentikasi ditolak saat ${contextLabel}: ${raw}`;
  }
  if (error?.name === "TimeoutError" || lower.includes("timeout") || lower.includes("econnreset") || lower.includes("socket hang up")) {
    return `⏳ Koneksi saat ${contextLabel} terputus/timeout. Coba ulangi sebentar lagi ya.`;
  }
  return `⚠️ Gagal ${contextLabel}: ${raw}`;
}
