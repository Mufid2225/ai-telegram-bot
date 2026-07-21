import Tesseract from "tesseract.js";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { extractTaskInfo } from "./tasks.js";
import { replyText } from "../utils/telegram.js";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT = 30000;

export function assertFileSize(file) {
  if (file.file_size != null && file.file_size > MAX_FILE_SIZE) throw new Error("File terlalu besar. Maksimal 10 MB.");
}

export function capExtractedText(text) {
  return String(text ?? "").slice(0, MAX_EXTRACTED_TEXT);
}

export function registerFileHandlers(bot, { callAI, repository }) {
  async function downloadFile(fileId) {
    const link = await bot.telegram.getFileLink(fileId);
    const resp = await fetch(link, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`Download gagal (${resp.status})`);
    return Buffer.from(await resp.arrayBuffer());
  }

  bot.on("photo", async (ctx) => {
    try {
      const photo = ctx.message.photo.at(-1);
      assertFileSize(photo);
      const caption = ctx.message.caption || "";
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const buffer = await downloadFile(photo.file_id);
      const { data } = await Tesseract.recognize(buffer, "ind+eng");
      const ocrText = capExtractedText(data.text.trim());
      if (caption) await repository.saveMemory({ userId: ctx.from.id, extracted: extractTaskInfo(caption), content: caption, fileId: photo.file_id, fileType: "photo" });
      const text = caption
        ? `User kirim foto. Caption: ${caption}\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`
        : `User kirim foto.\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`;
      await repository.saveConversation({ userId: ctx.from.id, role: "user", content: text });
      const reply = await callAI([
        { role: "system", content: "Kamu asisten Telegram yang santai dan helpful.\n\nGaya bicara:\n- Natural, kayak ngobrol sama temen\n- JANGAN pakai emoji sama sekali\n- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.\n- Ga usah kaku, santai aja\n\nUser baru kirim foto. Ini hasil OCR-nya. Bantu user." },
        { role: "user", content: text },
      ], ctx);
      await repository.saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
      await replyText(ctx, reply);
    } catch (error) {
      console.error("Photo error:", error);
      await ctx.reply(`Gagal proses foto: ${error.message}`);
    }
  });

  bot.on("document", async (ctx) => {
    try {
      const doc = ctx.message.document;
      assertFileSize(doc);
      const caption = ctx.message.caption || "";
      const mime = doc.mime_type || "";
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const buffer = await downloadFile(doc.file_id);
      let extracted;
      if (mime === "application/pdf") extracted = (await pdf(buffer)).text;
      else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") extracted = (await mammoth.extractRawText({ buffer })).value;
      else if (mime.startsWith("image/")) extracted = (await Tesseract.recognize(buffer, "ind+eng")).data.text;
      else extracted = `File terkirim: ${doc.file_name} (${mime}). Belum bisa diproses.`;
      extracted = capExtractedText(extracted);
      const text = caption
        ? `User kirim file: ${doc.file_name}. Caption: ${caption}\n\nIsi file:\n${extracted}`
        : `User kirim file: ${doc.file_name}.\n\nIsi file:\n${extracted}`;
      await repository.saveConversation({ userId: ctx.from.id, role: "user", content: text });
      const reply = await callAI([
        { role: "system", content: "Kamu asisten Telegram yang santai dan helpful.\n\nGaya bicara:\n- Natural, kayak ngobrol sama temen\n- JANGAN pakai emoji sama sekali\n- JANGAN gunakan ** atau * atau apapun untuk formatting teks. Tulis polos tanpa markdown.\n- Ga usah kaku, santai aja\n\nUser kirim file. Ini isinya. Bantu user." },
        { role: "user", content: text },
      ], ctx);
      await repository.saveConversation({ userId: ctx.from.id, role: "assistant", content: reply });
      await replyText(ctx, reply);
    } catch (error) {
      console.error("Document handler error:", error);
      await ctx.reply(`Gagal proses file: ${error.message}`);
    }
  });
}
