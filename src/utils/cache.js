export function createTtlCache({ maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map();

  return {
    async wrap(key, ttlMs, fn) {
      const hit = entries.get(key);
      if (hit) {
        if (hit.expiresAt > now()) return hit.value;
        entries.delete(key);
      }
      const value = await fn();
      if (value == null) return value;
      entries.set(key, { value, expiresAt: now() + ttlMs });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    },
  };
}
