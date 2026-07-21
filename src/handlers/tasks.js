import dayjs from "dayjs";
import { truncateCaption } from "../utils/telegram.js";

export function isImportantMessage(text) {
  return ["tugas", "deadline", "ujian", "jadwal", "kuis", "praktikum", "rapat", "reminder", "dikumpulkan", "presentasi", "pr", "mapel"]
    .some((keyword) => text.toLowerCase().includes(keyword));
}

export function parseDeadline(text, now = dayjs()) {
  const lower = text.toLowerCase();
  if (lower.includes("besok")) return now.add(1, "day").format("YYYY-MM-DD");
  const days = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0 };
  for (const [day, number] of Object.entries(days)) {
    if (lower.includes(day)) {
      let target = now.day(number);
      if (target.isBefore(now, "day")) target = target.add(7, "day");
      return target.format("YYYY-MM-DD");
    }
  }
  return null;
}

export function extractTaskInfo(text, now) {
  const lower = text.toLowerCase();
  let type = "catatan";
  if (lower.includes("tugas") || lower.includes("pr")) type = "tugas";
  else if (lower.includes("ujian") || lower.includes("kuis")) type = "ujian";
  const subject = ["matematika", "fisika", "kimia", "sejarah", "bahasa", "inggris", "pkn", "agama"]
    .find((value) => lower.includes(value)) ?? null;
  return { type, subject, deadline: parseDeadline(text, now) };
}

export function registerTaskHandlers(bot, { pool }) {
  bot.command("tugas", async (ctx) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM memories WHERE user_id = $1 AND type = 'tugas' ORDER BY id DESC LIMIT 10`,
        [ctx.from.id]
      );
      if (!rows.length) return ctx.reply("Tidak ada tugas tersimpan.");
      for (const task of rows) {
        const text = `\n🆔 ID: ${task.id}\n📚 Mapel: ${task.subject || "-"}\n📅 Deadline: ${task.deadline || "-"}\n📝 Isi: ${task.content}\n`;
        if (task.file_type === "photo") await ctx.replyWithPhoto(task.file_id, { caption: truncateCaption(text) });
        else await ctx.reply(text);
      }
    } catch (error) {
      console.error(error);
      await ctx.reply("Gagal mengambil tugas.");
    }
  });

  bot.command("hapus", async (ctx) => {
    try {
      const id = ctx.message.text.split(" ")[1];
      if (!id) return ctx.reply("Gunakan: /hapus ID");
      const result = await pool.query("DELETE FROM memories WHERE id = $1 AND user_id = $2", [id, ctx.from.id]);
      await ctx.reply(result.rowCount ? "Tugas berhasil dihapus." : "Tugas tidak ditemukan.");
    } catch (error) {
      console.error(error);
      await ctx.reply("Gagal menghapus tugas.");
    }
  });

  bot.command("update", async (ctx) => {
    try {
      const args = ctx.message.text.split(" ");
      const [id, field] = args.slice(1, 3);
      const value = args.slice(3).join(" ");
      if (!id || !field || !value) return ctx.reply("Gunakan:\n/update ID field value\n\nContoh:\n/update 3 deadline 2026-05-15");
      if (!["subject", "deadline", "content", "type"].includes(field)) return ctx.reply("Field tidak valid.");
      const result = await pool.query(`UPDATE memories SET ${field} = $1 WHERE id = $2 AND user_id = $3`, [value, id, ctx.from.id]);
      await ctx.reply(result.rowCount ? "Task berhasil diupdate." : "Task tidak ditemukan.");
    } catch (error) {
      console.error(error);
      await ctx.reply("Gagal update task.");
    }
  });

  bot.command("remind", async (ctx) => {
    try {
      const today = dayjs().format("YYYY-MM-DD");
      const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");
      const { rows } = await pool.query(
        `SELECT * FROM memories WHERE user_id = $1 AND type = 'tugas' AND (deadline = $2 OR deadline = $3) ORDER BY deadline ASC`,
        [ctx.from.id, today, tomorrow]
      );
      if (!rows.length) return ctx.reply("Tidak ada deadline hari ini atau besok.");
      let text = "⏰ Reminder Tugas:\n";
      for (const task of rows) text += `\n\n🆔 ${task.id}\n📚 ${task.subject || "-"}\n📅 ${task.deadline}\n📝 ${task.content}`;
      await ctx.reply(text);
    } catch (error) {
      console.error(error);
      await ctx.reply("Gagal mengambil reminder.");
    }
  });
}
