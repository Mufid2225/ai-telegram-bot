import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.query(`
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

pool.query(`
  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    role TEXT,
    content TEXT,
    created_at TEXT
  )
`);

export default pool;
