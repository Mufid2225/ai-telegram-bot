import http from "http";
import pool from "./database.js";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import dayjs from "dayjs";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const client = new OpenAI({
  apiKey: process.env.ROUTER_API_KEY,
  baseURL: process.env.ROUTER_BASE_URL,
});

function isImportantMessage(text) {
  const keywords = [
    "tugas",
    "deadline",
    "ujian",
    "jadwal",
    "kuis",
    "praktikum",
    "rapat",
    "reminder",
    "dikumpulkan",
    "presentasi",
    "pr",
    "mapel",
  ];
  return keywords.some((keyword) =>
    text.toLowerCase().includes(keyword)
  );
}

function parseDeadline(text) {
  const lower = text.toLowerCase();
  const today = dayjs();

  if (lower.includes("besok")) {
    return today.add(1, "day").format("YYYY-MM-DD");
  }

  const days = {
    senin: 1,
    selasa: 2,
    rabu: 3,
    kamis: 4,
    jumat: 5,
    sabtu: 6,
    minggu: 0,
  };

  for (const day in days) {
    if (lower.includes(day)) {
      let target = today.day(days[day]);
      if (target.isBefore(today)) {
        target = target.add(7, "day");
      }
      return target.format("YYYY-MM-DD");
    }
  }

  return null;
}

function extractTaskInfo(text) {
  const lower = text.toLowerCase();
  let type = "catatan";

  if (lower.includes("tugas") || lower.includes("pr")) {
    type = "tugas";
  } else if (lower.includes("ujian") || lower.includes("kuis")) {
    type = "ujian";
  }

  const subjects = [
    "matematika",
    "fisika",
    "kimia",
    "sejarah",
    "bahasa",
    "inggris",
    "pkn",
    "agama",
  ];

  let subject = null;
  for (const s of subjects) {
    if (lower.includes(s)) {
      subject = s;
      break;
    }
  }

  const deadline = parseDeadline(text);

  return { type, subject, deadline };
}

async function saveMemory({ userId, extracted, content, fileId = null, fileType = null }) {
  await pool.query(
    `INSERT INTO memories (user_id, type, subject, deadline, content, file_id, file_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, extracted.type, extracted.subject, extracted.deadline, content, fileId, fileType, new Date().toISOString()]
  );
}

async function saveConversation({ userId, role, content }) {
  await pool.query(
    `INSERT INTO conversations (user_id, role, content, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, role, content, new Date().toISOString()]
  );
}

bot.command("tugas", async (ctx) => {
  try {
    const result = await pool.query(
      `SELECT * FROM memories
       WHERE user_id = $1 AND type = 'tugas'
       ORDER BY id DESC LIMIT 10`,
      [ctx.from.id]
    );
    const tasks = result.rows;

    if (tasks.length === 0) {
      return ctx.reply("Tidak ada tugas tersimpan.");
    }

    for (const task of tasks) {
      const text = `
🆔 ID: ${task.id}
📚 Mapel: ${task.subject || "-"}
📅 Deadline: ${task.deadline || "-"}
📝 Isi: ${task.content}
`;

      if (task.file_type === "photo") {
        await ctx.replyWithPhoto(task.file_id, { caption: text });
      } else {
        await ctx.reply(text);
      }
    }
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal mengambil tugas.");
  }
});

bot.command("hapus", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const id = args[1];

    if (!id) {
      return ctx.reply("Gunakan: /hapus ID");
    }

    const result = await pool.query(
      `DELETE FROM memories WHERE id = $1 AND user_id = $2`,
      [id, ctx.from.id]
    );

    if (result.rowCount === 0) {
      return ctx.reply("Tugas tidak ditemukan.");
    }

    await ctx.reply("Tugas berhasil dihapus.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal menghapus tugas.");
  }
});

bot.command("update", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const id = args[1];
    const field = args[2];
    const value = args.slice(3).join(" ");

    if (!id || !field || !value) {
      return ctx.reply(`Gunakan:\n/update ID field value\n\nContoh:\n/update 3 deadline 2026-05-15`);
    }

    const allowedFields = ["subject", "deadline", "content", "type"];
    if (!allowedFields.includes(field)) {
      return ctx.reply("Field tidak valid.");
    }

    const result = await pool.query(
      `UPDATE memories SET ${field} = $1 WHERE id = $2 AND user_id = $3`,
      [value, id, ctx.from.id]
    );

    if (result.rowCount === 0) {
      return ctx.reply("Task tidak ditemukan.");
    }

    await ctx.reply("Task berhasil diupdate.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal update task.");
  }
});

bot.command("remind", async (ctx) => {
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");

    const result = await pool.query(
      `SELECT * FROM memories
       WHERE user_id = $1 AND type = 'tugas'
       AND (deadline = $2 OR deadline = $3)
       ORDER BY deadline ASC`,
      [ctx.from.id, today, tomorrow]
    );
    const tasks = result.rows;

    if (tasks.length === 0) {
      return ctx.reply("Tidak ada deadline hari ini atau besok.");
    }

    let text = "⏰ Reminder Tugas:\n";
    for (const task of tasks) {
      text += `

🆔 ${task.id}
📚 ${task.subject || "-"}
📅 ${task.deadline}
📝 ${task.content}`;
    }

    await ctx.reply(text);
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal mengambil reminder.");
  }
});

bot.command("test", async (ctx) => {
  try {
    const resp = await fetch(`${process.env.ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ROUTER_API_KEY}` },
      body: JSON.stringify({ model: process.env.ROUTER_MODEL, messages: [{ role: "user", content: "hai" }] }),
    });
    const text = await resp.text();
    await ctx.reply(`Status: ${resp.status}\nResponse: ${text.slice(0, 200)}`);
  } catch (e) {
    await ctx.reply(`Fetch error: ${e.cause || e.code || e.message}`);
  }
});

bot.on("photo", async (ctx) => {
  try {
    const photos = ctx.message.photo;
    const biggestPhoto = photos[photos.length - 1];
    const caption = ctx.message.caption || "";
    const extracted = extractTaskInfo(caption);

    await saveMemory({
      userId: ctx.from.id,
      extracted,
      content: caption,
      fileId: biggestPhoto.file_id,
      fileType: "photo",
    });

    await ctx.reply("Foto berhasil disimpan.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Gagal menyimpan foto.");
  }
});

bot.on("text", async (ctx) => {
  try {
    const userMessage = ctx.message.text;

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    await saveConversation({
      userId: ctx.from.id,
      role: "user",
      content: userMessage,
    });

    if (isImportantMessage(userMessage)) {
      const extracted = extractTaskInfo(userMessage);
      await saveMemory({
        userId: ctx.from.id,
        extracted,
        content: userMessage,
      });
    }

    const convResult = await pool.query(
      `SELECT role, content FROM conversations
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 10`,
      [ctx.from.id]
    );
    const conversations = convResult.rows.reverse();

    const words = userMessage.toLowerCase().split(" ").filter(word => word.length > 2);

    let memories = [];
    if (words.length > 0) {
      const conditions = words.map((_, i) => `content ILIKE $${i + 1}`);
      const values = words.map(word => `%${word}%`);
      values.push(ctx.from.id);

      const memResult = await pool.query(
        `SELECT * FROM memories
         WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")})
         ORDER BY id DESC LIMIT 5`,
        values
      );
      memories = memResult.rows;
    }

    const memoryContext = memories.length > 0
      ? memories.reverse().map((m) => {
          return `
Type: ${m.type}
Subject: ${m.subject || "-"}
Deadline: ${m.deadline || "-"}
Content: ${m.content}`;
        }).join("\n")
      : "Tidak ada memory relevan.";

    const completion = await client.chat.completions.create({
      model: process.env.ROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: `
Kamu adalah asisten AI Telegram.

Tugasmu:
- membantu user mengingat tugas
- membantu deadline
- membantu jadwal
- membantu catatan penting

Pertahankan konteks percakapan.
Jawab secara natural dan nyambung.

Gunakan memory jika relevan.

Jika tidak relevan, jawab normal.

Memory User:
${memoryContext}`,
        },
        ...conversations,
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const reply = completion.choices[0].message.content;

    await saveConversation({
      userId: ctx.from.id,
      role: "assistant",
      content: reply,
    });

    await ctx.reply(reply);
  } catch (error) {
    console.error(error);
    await ctx.reply(`Error: ${error.message || error.code || String(error)}`);
  }
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

if (!process.env.BOT_TOKEN) {
  console.error("BOT_TOKEN tidak di-set!");
}

(async () => {
  try {
    await bot.launch();
    console.log("Bot berjalan...");
  } catch (error) {
    console.error("Bot gagal launch:", error.message);
  }
})();

process.once("SIGTERM", async () => {
  try { await pool.end(); } catch {}
  bot.stop("SIGTERM");
  process.exit(0);
});
