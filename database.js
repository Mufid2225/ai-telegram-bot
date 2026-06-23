import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Pool error:", err.message);
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        type TEXT,
        subject TEXT,
        deadline TEXT,
        content TEXT,
        file_id TEXT,
        file_type TEXT,
        created_at TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
      )
    `);
    console.log("Database siap.");
  } catch (error) {
    console.error("Database gagal init:", error.message);
  }
}

initDB();

export default pool;
