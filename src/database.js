import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const db = new Database(fileURLToPath(new URL("../data.db", import.meta.url)));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
let closed = false;

function convertSql(sql) {
  return sql.replace(/\$(\d+)/g, "?").replace(/\bILIKE\b/g, "LIKE");
}

const pool = {
  query(sql, params = []) {
    const s = convertSql(sql);
    if (/^\s*SELECT/i.test(s) || /\bRETURNING\b/i.test(s)) {
      const rows = db.prepare(s).all(...params);
      return { rows, rowCount: rows.length };
    }
    const info = db.prepare(s).run(...params);
    return { rowCount: info.changes };
  },
  end() {
    if (!closed) {
      db.close();
      closed = true;
    }
  },
};

function initDB() {
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
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id_id ON conversations(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_memories_user_id_type_id ON memories(user_id, type, id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_user_id_id ON knowledge(user_id, id);
  `);
  console.log("Database SQLite siap.");
}

initDB();

export function cleanupConversations(retentionDays = 90) {
  return pool.query("DELETE FROM conversations WHERE created_at < $1", [
    new Date(Date.now() - retentionDays * 86400000).toISOString(),
  ]).rowCount;
}

export default pool;
