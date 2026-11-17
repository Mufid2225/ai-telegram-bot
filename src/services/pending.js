import crypto from "crypto";

function parsePendingRow(row) {
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload_json) };
}

/**
 * Shared SQLite store for user-confirmed drafts across MoneyTracker and workspaces.
 */
export function createPendingActionsStore(pool) {
  return {
    async create({ userId, kind, payload, summaryText, ttlHours = 24 }) {
      const uid = String(userId);
      const id = crypto.randomBytes(4).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlHours * 3600000).toISOString();

      await pool.query(
        "UPDATE pending_actions SET status = 'superseded' WHERE user_id = $1 AND status = 'pending'",
        [uid]
      );
      await pool.query(
        `INSERT INTO pending_actions (id, user_id, kind, payload_json, summary_text, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
        [id, uid, kind, JSON.stringify(payload), summaryText, now.toISOString(), expiresAt]
      );
      return { id, userId: uid, kind, payload, summaryText, status: "pending", expiresAt };
    },

    async getById(id, userId) {
      const { rows } = await pool.query(
        "SELECT * FROM pending_actions WHERE id = $1 AND user_id = $2",
        [id, String(userId)]
      );
      return parsePendingRow(rows[0]);
    },

    async claimForExecution(id, userId) {
      const nowIso = new Date().toISOString();
      const res = await pool.query(
        `UPDATE pending_actions
         SET status = 'processing'
         WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > $3`,
        [id, String(userId), nowIso]
      );
      if (!res.rowCount) return null;
      return this.getById(id, userId);
    },

    async markStatus(id, status) {
      await pool.query("UPDATE pending_actions SET status = $1 WHERE id = $2", [status, id]);
    },
  };
}
