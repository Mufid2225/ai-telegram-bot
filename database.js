import Database from "better-sqlite3";

const db = new Database("./data.db");
db.pragma("journal_mode = WAL");

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
    db.close();
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
  `);
  console.log("Database SQLite siap.");
}

initDB();

export default pool;
