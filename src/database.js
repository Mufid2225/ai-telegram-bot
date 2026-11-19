import Database from "better-sqlite3";
import { fileURLToPath } from "url";

function prepareSqlAndParams(sql, params = []) {
  const expanded = [];
  let hasNumbered = false;
  const converted = sql
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/\$(\d+)/g, (_, idx) => {
      hasNumbered = true;
      expanded.push(params[Number(idx) - 1]);
      return "?";
    });
  return { sql: converted, params: hasNumbered ? expanded : params };
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      type TEXT,
      subject TEXT,
      deadline TEXT,
      content TEXT,
      file_id TEXT,
      file_type TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      role TEXT,
      content TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      entity TEXT,
      attribute TEXT,
      value TEXT,
      category TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      due_at TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS active_context (
      user_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      extra_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS callback_refs (
      ref TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS input_requests (
      user_id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      prompt_message_id INTEGER,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id_id ON conversations(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_memories_user_id_type_id ON memories(user_id, type, id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_user_id_id ON knowledge(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_pending_actions_user_status ON pending_actions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent_at, due_at);
    CREATE INDEX IF NOT EXISTS idx_callback_refs_created ON callback_refs(created_at);
  `);
}

export function createDatabase(dbPath, { quiet = false } = {}) {
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  initSchema(db);
  if (!quiet) console.log("Database SQLite siap.");
  let closed = false;

  return {
    query(sql, params = []) {
      const prepared = prepareSqlAndParams(sql, params);
      if (/^\s*SELECT/i.test(prepared.sql) || /\bRETURNING\b/i.test(prepared.sql)) {
        const rows = db.prepare(prepared.sql).all(...prepared.params);
        return { rows, rowCount: rows.length };
      }
      const info = db.prepare(prepared.sql).run(...prepared.params);
      return { rowCount: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    end() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}

let defaultPool = null;
function getDefaultPool() {
  if (!defaultPool) {
    defaultPool = createDatabase(fileURLToPath(new URL("../data.db", import.meta.url)));
  }
  return defaultPool;
}

const pool = {
  query(sql, params = []) {
    return getDefaultPool().query(sql, params);
  },
  end() {
    if (defaultPool) {
      defaultPool.end();
      defaultPool = null;
    }
  },
};

export function cleanupConversations(retentionDays = 90) {
  return pool.query("DELETE FROM conversations WHERE created_at < $1", [
    new Date(Date.now() - retentionDays * 86400000).toISOString(),
  ]).rowCount;
}

export default pool;
