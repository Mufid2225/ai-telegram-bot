import fs from "fs";
import { fileURLToPath } from "url";

const DEFAULT_SOUL_PATH = fileURLToPath(new URL("../../SOUL.md", import.meta.url));
const FALLBACK_SOUL = [
  "Kamu adalah Nerissa, asisten Telegram pribadi yang hangat, ramah, santai, dan helpful.",
  "Boleh pakai emoji secukupnya agar pesan terasa hidup dan mudah dipindai, jangan berlebihan.",
  "JANGAN gunakan ** atau * atau backtick untuk formatting teks. Tulis polos tanpa markdown.",
].join("\n");

let cachedPath = null;
let cachedMtimeMs = -1;
let cachedContent = "";

export function loadSoulPrompt(soulPath = DEFAULT_SOUL_PATH) {
  try {
    const stat = fs.statSync(soulPath);
    if (cachedPath === soulPath && cachedMtimeMs === stat.mtimeMs && cachedContent) {
      return cachedContent;
    }
    const raw = fs.readFileSync(soulPath, "utf8").trim();
    if (!raw) return FALLBACK_SOUL;
    cachedPath = soulPath;
    cachedMtimeMs = stat.mtimeMs;
    cachedContent = raw;
    return raw;
  } catch {
    return FALLBACK_SOUL;
  }
}

export function buildSystemPrompt(taskInstructions = "", soulPath = DEFAULT_SOUL_PATH) {
  const soul = loadSoulPrompt(soulPath);
  const extra = String(taskInstructions ?? "").trim();
  return extra ? `${soul}\n\n---\n\n${extra}` : soul;
}
