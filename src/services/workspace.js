import crypto from "crypto";

/**
 * Store persistent active workspace context and short inline callback refs (<64 bytes).
 */
export function createWorkspaceStore(pool) {
  return {
    async setActiveContext({ userId, platform, sourceId, sourceName, extra = null }) {
      const uid = String(userId);
      const nowIso = new Date().toISOString();
      await pool.query(
        `INSERT INTO active_context (user_id, platform, source_id, source_name, extra_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(user_id) DO UPDATE SET
           platform = excluded.platform,
           source_id = excluded.source_id,
           source_name = excluded.source_name,
           extra_json = excluded.extra_json,
           updated_at = excluded.updated_at`,
        [uid, String(platform), String(sourceId), String(sourceName), extra ? JSON.stringify(extra) : null, nowIso]
      );
      return { userId: uid, platform, sourceId: String(sourceId), sourceName: String(sourceName), extra, updatedAt: nowIso };
    },

    async getActiveContext(userId) {
      const { rows } = await pool.query(
        "SELECT platform, source_id, source_name, extra_json, updated_at FROM active_context WHERE user_id = $1",
        [String(userId)]
      );
      const row = rows[0];
      if (!row) return null;
      return {
        platform: row.platform,
        sourceId: row.source_id,
        sourceName: row.source_name,
        extra: row.extra_json ? JSON.parse(row.extra_json) : null,
        updatedAt: row.updated_at,
      };
    },

    async createCallbackRef(payload) {
      const serialized = JSON.stringify(payload);
      const ref = crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 8);
      const nowIso = new Date().toISOString();
      const cutoffIso = new Date(Date.now() - 7 * 86400000).toISOString();
      await pool.query("DELETE FROM callback_refs WHERE created_at < $1", [cutoffIso]);
      await pool.query(
        `INSERT INTO callback_refs (ref, payload_json, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(ref) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
        [ref, serialized, nowIso]
      );
      return ref;
    },

    async resolveCallbackRef(ref) {
      const { rows } = await pool.query("SELECT payload_json FROM callback_refs WHERE ref = $1", [String(ref ?? "")]);
      if (!rows[0]) return null;
      try {
        return JSON.parse(rows[0].payload_json);
      } catch {
        return null;
      }
    },
  };
}
