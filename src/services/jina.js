import { createTtlCache } from "../utils/cache.js";

const cache = createTtlCache();
const JINA_TTL_MS = 600_000;
const MAX_TEXT_CHARS = 200_000;

export async function readUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  return cache.wrap(`jina:${url}`, JINA_TTL_MS, async () => {
    try {
      const headers = { Accept: "text/plain" };
      const key = process.env.JINA_API_KEY;
      if (key) headers.Authorization = `Bearer ${key}`;
      // encodeURI hanya merapikan spasi/karakter ilegal; struktur URL target tetap utuh di path.
      const resp = await fetch(`https://r.jina.ai/${encodeURI(url)}`, {
        headers,
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) return null;
      // Cap sebelum cache agar entri cache ikut terbatas.
      const text = (await resp.text()).slice(0, MAX_TEXT_CHARS);
      return text || null;
    } catch {
      return null;
    }
  });
}
