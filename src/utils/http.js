import { redactSecrets } from "./errors.js";

/**
 * Execute an HTTP request and parse JSON response with timeout and secret redaction.
 */
export async function requestJson(
  url,
  options = {},
  { label = "API", timeoutMs = 15000, fetchImpl = fetch, extraSecrets = [] } = {}
) {
  const { headers = {}, method = "GET", body } = options;
  let resp;
  try {
    resp = await fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(redactSecrets(`${label} request failed: ${err.message || String(err)}`, extraSecrets));
  }

  const raw = await resp.text().catch(() => "");
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {}
  }

  if (!resp.ok) {
    const upstreamMsg = parsed?.message || parsed?.error?.message || parsed?.error || raw || `HTTP ${resp.status}`;
    const detail = redactSecrets(String(upstreamMsg), extraSecrets).slice(0, 180);
    const err = new Error(`${label} HTTP error (${resp.status}): ${detail}`);
    err.status = resp.status;
    err.body = parsed ?? raw;
    throw err;
  }

  if (raw && parsed === null) {
    throw new Error(`${label} mengembalikan respon bukan JSON.`);
  }
  return parsed ?? {};
}
