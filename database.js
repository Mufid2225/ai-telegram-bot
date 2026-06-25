import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tidak di-set!");
} else {
  const masked = url.replace(/:[^:@]+@/, ":***@");
  console.log("DATABASE_URL:", masked);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Pool error:", err.message);
});

async function initDB() {
  try {
    const client = await pool.connect();
    await client.query(`
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
      )
    `);
    client.release();
    console.log("Database siap.");
  } catch (error) {
    console.error("Database gagal init:", error.message);
  }
}

initDB();

export default pool;
