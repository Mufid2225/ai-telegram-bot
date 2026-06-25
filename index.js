import http from "http";
import pool from "./database.js";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import dayjs from "dayjs";
import { getKnowledgeContext } from "./memory.js";
import Tesseract from "tesseract.js";
import pdf from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

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
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || "";

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const link = await bot.telegram.getFileLink(photo.file_id);
    const resp = await fetch(link);
    const buffer = Buffer.from(await resp.arrayBuffer());

    const { data } = await Tesseract.recognize(buffer, "ind+eng");
    const ocrText = data.text.trim();

    if (caption) {
      const extracted = extractTaskInfo(caption);
      await saveMemory({ userId: ctx.from.id, extracted, content: caption, fileId: photo.file_id, fileType: "photo" });
    }

    const text = caption
      ? `User kirim foto. Caption: ${caption}\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`
      : `User kirim foto.\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`;

    await saveConversation({ userId: ctx.from.id, role: "user", content: text });

    const msg = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- Ga usah pake ** atau markdown apapun
- Ga usah kaku, santai aja

User baru kirim foto. Ini hasil OCR-nya. Bantu user.`,
      },
      { role: "user", content: text },
    ];

    const reply = await callAI(msg, ctx);
    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Photo error:", error);
    await ctx.reply(`Gagal proses foto: ${error.message}`);
  }
});

async function callAI(messages, ctx) {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

  const resp = await fetch(`${process.env.ROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.ROUTER_MODEL,
      messages,
      stream: false,
    }),
  });

  const raw = await resp.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const lines = raw.split("\n");
    let content = "";
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
            content += chunk.choices[0].delta.content;
          }
        } catch {}
      }
    }
    return content || "Maaf, respon AI kosong.";
  }

  const choice = data.choices && data.choices[0];
  if (!choice) return "Maaf, respon AI kosong.";

  const content = choice.message.content;
  return (content && content.trim()) ? content : "Maaf, respon AI kosong.";
}

bot.on("text", async (ctx) => {
  const userMessage = ctx.message.text;

  try {
    await saveConversation({ userId: ctx.from.id, role: "user", content: userMessage });

    if (isImportantMessage(userMessage)) {
      const extracted = extractTaskInfo(userMessage);
      await saveMemory({ userId: ctx.from.id, extracted, content: userMessage });
    }

    const convResult = await pool.query(
      `SELECT role, content FROM conversations
       WHERE user_id = $1 ORDER BY id DESC LIMIT 10`,
      [ctx.from.id]
    );
    const conversations = convResult.rows.reverse();

    const words = userMessage.toLowerCase().split(" ").filter(w => w.length > 2);
    let memories = [];
    if (words.length > 0) {
      const conditions = words.map((_, i) => `content ILIKE $${i + 1}`);
      const values = words.map(w => `%${w}%`);
      values.push(ctx.from.id);
      const memResult = await pool.query(
        `SELECT * FROM memories WHERE user_id = $${words.length + 1} AND (${conditions.join(" OR ")}) ORDER BY id DESC LIMIT 5`,
        values
      );
      memories = memResult.rows;
    }

    const memoryContext = memories.length > 0
      ? memories.reverse().map(m => `Type: ${m.type}\nSubject: ${m.subject || "-"}\nDeadline: ${m.deadline || "-"}\nContent: ${m.content}`).join("\n---\n")
      : "Tidak ada memory relevan.";

    const knowledgeContext = await getKnowledgeContext(ctx.from.id);

    const messages = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- Ga usah pake ** atau markdown apapun
- Ga usah kaku, santai aja
- Tetep informatif tapi mengalir
- Kalo perlu list, pake tanda - aja

Kemampuan:
- Bantu tugas, deadline, jadwal sekolah
- Baca & jelasin isi foto (OCR), PDF, DOCX
- Nyimpen catatan penting otomatis

Memory dari tugas/catatan:
${memoryContext}
${knowledgeContext}`,
      },
      ...conversations,
      { role: "user", content: userMessage },
    ];

    const reply = await callAI(messages, ctx);

    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Text handler error:", error);
    await ctx.reply(`Error: ${error.message || error.code || String(error)}`);
  }
});

// ── File Processing ──────────────────────────────────

async function downloadFile(fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  const resp = await fetch(link);
  return Buffer.from(await resp.arrayBuffer());
}

bot.on("document", async (ctx) => {
  try {
    const doc = ctx.message.document;
    const caption = ctx.message.caption || "";
    const mime = doc.mime_type || "";

    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const buffer = await downloadFile(doc.file_id);
    let extracted = "";

    if (mime === "application/pdf") {
      const data = await pdf(buffer);
      extracted = data.text;
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const { value } = await mammoth.extractRawText({ buffer });
      extracted = value;
    } else if (mime.startsWith("image/")) {
      const { data } = await Tesseract.recognize(buffer, "ind+eng");
      extracted = data.text;
    } else {
      extracted = `File terkirim: ${doc.file_name} (${mime}). Belum bisa diproses.`;
    }

    const text = caption
      ? `User kirim file: ${doc.file_name}. Caption: ${caption}\n\nIsi file:\n${extracted}`
      : `User kirim file: ${doc.file_name}.\n\nIsi file:\n${extracted}`;

    await saveConversation({ userId: ctx.from.id, role: "user", content: text });

    const messages = [
      {
        role: "system",
        content: `
Kamu asisten Telegram yang santai dan helpful.

Gaya bicara:
- Natural, kayak ngobrol sama temen
- JANGAN pakai emoji sama sekali
- Ga usah pake ** atau markdown apapun
- Ga usah kaku, santai aja

User kirim file. Ini isinya. Bantu user.`,
      },
      { role: "user", content: text },
    ];

    const reply = await callAI(messages, ctx);
    await saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error("Document handler error:", error);
    await ctx.reply(`Gagal proses file: ${error.message}`);
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
