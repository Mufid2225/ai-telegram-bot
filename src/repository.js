export function createRepository(pool) {
  return {
    saveMemory({ userId, extracted, content, fileId = null, fileType = null }) {
      return pool.query(
        `INSERT INTO memories (user_id, type, subject, deadline, content, file_id, file_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, extracted.type, extracted.subject, extracted.deadline, content, fileId, fileType, new Date().toISOString()]
      );
    },
    saveConversation({ userId, role, content }) {
      return pool.query(
        `INSERT INTO conversations (user_id, role, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, role, content, new Date().toISOString()]
      );
    },
  };
}
