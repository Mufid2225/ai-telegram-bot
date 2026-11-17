import Tesseract from "tesseract.js";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { extractTaskInfo } from "./tasks.js";
import { tools, executeTool } from "../tools.js";
import { formatFriendlyError } from "../utils/errors.js";
import { buildSystemPrompt } from "../utils/soul.js";
import { buildConfirmExtra, runWithProgress } from "../utils/telegram.js";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT = 30000;

export function assertFileSize(file) {
  if (file.file_size != null && file.file_size > MAX_FILE_SIZE) throw new Error("File terlalu besar. Maksimal 10 MB.");
}

export function capExtractedText(text) {
  return String(text ?? "").slice(0, MAX_EXTRACTED_TEXT);
}

export function registerFileHandlers(bot, {
  callAI,
  repository,
  pool,
  sheetsService,
  pendingStore,
  reminderStore,
  workspaceStore,
  trelloService,
  notionService,
  superhumanService,
  kbService,
  dateStr,
}) {
  async function downloadFile(fileId) {
    const link = await bot.telegram.getFileLink(fileId);
    const resp = await fetch(link, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`Download gagal (${resp.status})`);
    return Buffer.from(await resp.arrayBuffer());
  }

  bot.on("photo", async (ctx) => {
    const userId = String(ctx.from.id);
    const toolContext = {
      userId,
      pool,
      sheetsService,
      pendingStore,
      reminderStore,
      workspaceStore,
      trelloService,
      notionService,
      superhumanService,
      kbService,
    };
    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const photo = ctx.message.photo.at(-1);
        assertFileSize(photo);
        const caption = ctx.message.caption || "";
        const buffer = await downloadFile(photo.file_id);
        const { data } = await Tesseract.recognize(buffer, "ind+eng");
        const ocrText = capExtractedText(data.text.trim());
        if (caption) await repository.saveMemory({ userId, extracted: extractTaskInfo(caption), content: caption, fileId: photo.file_id, fileType: "photo" });
        const text = caption
          ? `User kirim foto. Caption: ${caption}\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`
          : `User kirim foto.\n\nHasil OCR:\n${ocrText || "(tidak ada teks)"}`;
        await repository.saveConversation({ userId, role: "user", content: text });
        const reply = await callAI(
          [
            {
              role: "system",
              content: buildSystemPrompt(
                `Hari ini: ${dateStr || ""}.\n\n` +
                `Tugas OCR Foto:\n` +
                `- Jika hasil OCR adalah struk belanja, nota, QRIS, atau bukti transfer yang nominalnya terbaca jelas, panggil money_get_options lalu buat draft pengeluaran via money_propose_add_expenses agar muncul tombol Simpan/Batal.\n` +
                `- Jika nominal tidak terbaca atau ini bukan transaksi (mis. soal tugas/dokumen), bantu jawab sesuai isi OCR tanpa membuat draft transaksi.`
              ),
            },
            { role: "user", content: text },
          ],
          ctx,
          { tools, executeTool, toolContext }
        );
        await repository.saveConversation({ userId, role: "assistant", content: reply });
        return reply;
      },
      formatResult: (reply) => ({ text: reply, extra: buildConfirmExtra(toolContext.pendingAction) }),
      formatError: (error) => {
        console.error("Photo error:", error);
        return { text: formatFriendlyError(error, "memproses foto") };
      },
    });
  });

  bot.on("document", async (ctx) => {
    const userId = String(ctx.from.id);
    const toolContext = {
      userId,
      pool,
      sheetsService,
      pendingStore,
      reminderStore,
      workspaceStore,
      trelloService,
      notionService,
      superhumanService,
      kbService,
    };
    await runWithProgress({
      ctx,
      mode: "reply",
      task: async () => {
        const doc = ctx.message.document;
        assertFileSize(doc);
        const caption = ctx.message.caption || "";
        const mime = doc.mime_type || "";
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
        await repository.saveConversation({ userId, role: "user", content: text });
        const reply = await callAI(
          [
            {
              role: "system",
              content: buildSystemPrompt(
                `User kirim file. Bantu analisis isinya; jika jelas bukti transaksi dan user minta dicatat, gunakan money_get_options dan money_propose_add_expenses.`
              ),
            },
            { role: "user", content: text },
          ],
          ctx,
          { tools, executeTool, toolContext }
        );
        await repository.saveConversation({ userId, role: "assistant", content: reply });
        return reply;
      },
      formatResult: (reply) => ({ text: reply, extra: buildConfirmExtra(toolContext.pendingAction) }),
      formatError: (error) => {
        console.error("Document handler error:", error);
        return { text: formatFriendlyError(error, "memproses file") };
      },
    });
  });
}
