function normalizeDueAt(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("Waktu reminder (dueAt) wajib diisi.");
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T08:00:00` : raw;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Format waktu reminder tidak valid: "${input}". Gunakan format ISO seperti 2026-11-18T08:00:00+07:00.`);
  }
  return parsed.toISOString();
}

export function createReminderStore(pool) {
  return {
    async create({ userId, message, dueAt }) {
      const text = String(message ?? "").trim();
      if (!text) throw new Error("Pesan reminder wajib diisi.");
      const dueIso = normalizeDueAt(dueAt);
      const nowIso = new Date().toISOString();
      const res = await pool.query(
        `INSERT INTO reminders (user_id, message, due_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [String(userId), text, dueIso, nowIso]
      );
      return { id: res.lastInsertRowid, userId: String(userId), message: text, dueAt: dueIso };
    },

    async listPending(userId) {
      const { rows } = await pool.query(
        `SELECT id, user_id, message, due_at, created_at
         FROM reminders
         WHERE user_id = $1 AND sent_at IS NULL
         ORDER BY due_at ASC`,
        [String(userId)]
      );
      return rows;
    },

    async listDue(now = new Date()) {
      const { rows } = await pool.query(
        `SELECT id, user_id, message, due_at
         FROM reminders
         WHERE sent_at IS NULL AND due_at <= $1
         ORDER BY due_at ASC`,
        [now.toISOString()]
      );
      return rows;
    },

    async markSent(id, sentAt = new Date()) {
      const res = await pool.query(
        `UPDATE reminders SET sent_at = $1 WHERE id = $2 AND sent_at IS NULL`,
        [sentAt.toISOString(), id]
      );
      return res.rowCount > 0;
    },

    async remove(id, userId) {
      const res = await pool.query(
        `DELETE FROM reminders WHERE id = $1 AND user_id = $2`,
        [id, String(userId)]
      );
      return res.rowCount > 0;
    },
  };
}

export async function processDueReminders(store, sendMessage, now = new Date()) {
  const due = await store.listDue(now);
  let sentCount = 0;
  for (const item of due) {
    try {
      await sendMessage(item.user_id, `Reminder: ${item.message}`);
      await store.markSent(item.id, now);
      sentCount++;
    } catch (err) {
      console.error("[REMINDER] send failed:", err.message);
    }
  }
  return sentCount;
}

export function startReminderPoller({ pool, sendMessage, intervalMs = 30000 }) {
  const store = createReminderStore(pool);
  let running = false;

  async function tick() {
    if (running) return 0;
    running = true;
    try {
      return await processDueReminders(store, sendMessage);
    } finally {
      running = false;
    }
  }

  tick().catch((err) => console.error("[REMINDER] initial tick error:", err.message));
  const timer = setInterval(() => {
    tick().catch((err) => console.error("[REMINDER] tick error:", err.message));
  }, intervalMs);

  return {
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}
