import pool from "./database.js";

export async function storeFact(userId, entity, attribute, value, category = "umum", db = pool) {
  await db.query(
    `INSERT INTO knowledge (user_id, entity, attribute, value, category, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [String(userId), entity.toLowerCase(), attribute.toLowerCase(), value, category, new Date().toISOString()]
  );
}

export async function getFacts(userId, query, db = pool) {
  const words = String(query ?? "").toLowerCase().split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return [];

  const conditions = words.map((_, i) =>
    `(entity ILIKE $${i + 1} OR value ILIKE $${i + 1} OR attribute ILIKE $${i + 1} OR category ILIKE $${i + 1})`
  );
  const values = words.map((w) => `%${w}%`);
  values.push(String(userId));

  const result = await db.query(
    `SELECT DISTINCT entity, attribute, value, category FROM knowledge
     WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")})
     ORDER BY id DESC LIMIT 15`,
    values
  );

  return result.rows;
}

export async function deleteFacts(userId, entity, attribute = null, db = pool) {
  if (attribute) {
    await db.query(
      `DELETE FROM knowledge WHERE user_id = $1 AND entity ILIKE $2 AND attribute ILIKE $3`,
      [String(userId), entity, attribute]
    );
  } else {
    await db.query(
      `DELETE FROM knowledge WHERE user_id = $1 AND entity ILIKE $2`,
      [String(userId), entity]
    );
  }
}

export async function getKnowledgeContext(userId, db = pool) {
  const result = await db.query(
    `SELECT entity, attribute, value, category FROM knowledge
     WHERE user_id = $1 ORDER BY id DESC LIMIT 30`,
    [String(userId)]
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
