import pool from "./database.js";

export async function storeFact(userId, entity, attribute, value, category = "umum") {
  await pool.query(
    `INSERT INTO knowledge (user_id, entity, attribute, value, category, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, entity.toLowerCase(), attribute.toLowerCase(), value, category, new Date().toISOString()]
  );
}

export async function getFacts(userId, query) {
  const words = query.toLowerCase().split(" ").filter(w => w.length > 2);
  if (words.length === 0) return [];

  const conditions = words.map((_, i) =>
    `(entity ILIKE $${i + 1} OR value ILIKE $${i + 1} OR attribute ILIKE $${i + 1} OR category ILIKE $${i + 1})`
  );
  const values = words.map(w => `%${w}%`);
  values.push(userId);

  const result = await pool.query(
    `SELECT DISTINCT entity, attribute, value, category FROM knowledge
     WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")})
     ORDER BY id DESC LIMIT 15`,
    values
  );

  return result.rows;
}

export async function deleteFacts(userId, entity, attribute = null) {
  if (attribute) {
    await pool.query(
      `DELETE FROM knowledge WHERE user_id = $1 AND entity ILIKE $2 AND attribute ILIKE $3`,
      [userId, entity, attribute]
    );
  } else {
    await pool.query(
      `DELETE FROM knowledge WHERE user_id = $1 AND entity ILIKE $2`,
      [userId, entity]
    );
  }
}

export async function getKnowledgeContext(userId) {
  const result = await pool.query(
    `SELECT entity, attribute, value, category FROM knowledge
     WHERE user_id = $1 ORDER BY id DESC LIMIT 30`,
    [userId]
  );

  if (result.rows.length === 0) return "";

  const grouped = {};
  for (const r of result.rows) {
    if (!grouped[r.entity]) grouped[r.entity] = [];
    grouped[r.entity].push(`${r.attribute}: ${r.value}`);
  }

  let ctx = "\nPengetahuan tentang user:\n";
  for (const [entity, facts] of Object.entries(grouped)) {
    ctx += `- ${entity}: ${facts.join(", ")}\n`;
  }
  return ctx;
}
