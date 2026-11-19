const VALID_TOOLS = new Set(["weather", "crypto", "stock", "fx", "news", "wb"]);

/**
 * Store state "menunggu input" menu info hybrid: satu baris per user, TTL pendek (default 5 menit).
 * Gempa & libur adalah aksi langsung dan tidak memakai store ini.
 */
export function createInputRequestStore(pool, { now = Date.now, ttlMs = 300000 } = {}) {
  return {
    async set(userId, tool, promptMessageId = null) {
      if (!VALID_TOOLS.has(tool)) {
        throw new Error(`Tool info tidak dikenal: ${tool}. Pilihan: ${[...VALID_TOOLS].join(", ")}.`);
      }
      const uid = String(userId);
      const expiresAt = now() + ttlMs;
      const promptId = promptMessageId == null ? null : Number(promptMessageId);
      await pool.query(
        `INSERT INTO input_requests (user_id, tool, prompt_message_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(user_id) DO UPDATE SET
           tool = excluded.tool,
           prompt_message_id = excluded.prompt_message_id,
           expires_at = excluded.expires_at`,
        [uid, tool, promptId, expiresAt]
      );
      return { userId: uid, tool, promptMessageId: promptId, expiresAt };
    },

    async get(userId) {
      const uid = String(userId);
      const { rows } = await pool.query(
        "SELECT tool, prompt_message_id, expires_at FROM input_requests WHERE user_id = $1",
        [uid]
      );
      const row = rows[0];
      if (!row) return null;
      if (row.expires_at <= now()) {
        await pool.query("DELETE FROM input_requests WHERE user_id = $1", [uid]);
        return null;
      }
      return { tool: row.tool, promptMessageId: row.prompt_message_id, expiresAt: row.expires_at };
    },

    async consume(userId) {
      // Klaim atomik satu statement (pola claimForExecution): hanya baris belum expired
      // yang terhapus dan dikembalikan; consume kedua selalu null.
      const { rows } = await pool.query(
        `DELETE FROM input_requests
         WHERE user_id = $1 AND expires_at > $2
         RETURNING tool, prompt_message_id, expires_at`,
        [String(userId), now()]
      );
      const row = rows[0];
      if (!row) return null;
      return { tool: row.tool, promptMessageId: row.prompt_message_id, expiresAt: row.expires_at };
    },

    async clear(userId) {
      await pool.query("DELETE FROM input_requests WHERE user_id = $1", [String(userId)]);
    },
  };
}
