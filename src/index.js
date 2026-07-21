import http from "http";
import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import pool, { cleanupConversations } from "./database.js";
import { createRepository } from "./repository.js";
import { createAIService } from "./services/ai.js";
import { registerTaskHandlers } from "./handlers/tasks.js";
import { registerMarketHandlers } from "./handlers/market.js";
import { registerFileHandlers } from "./handlers/files.js";
import { registerMessageHandlers } from "./handlers/messages.js";

const config = loadConfig();
cleanupConversations(config.retentionDays);

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const today = new Date();
const dateStr = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
const bot = new Telegraf(config.botToken);
const repository = createRepository(pool);
const callAI = createAIService(config);

bot.use(async (ctx, next) => {
  if (String(ctx.from?.id) !== config.allowedUserId) {
    console.warn(`Akses ditolak untuk user ${ctx.from?.id ?? "unknown"}`);
    return;
  }
  return next();
});

registerTaskHandlers(bot, { pool });
registerMarketHandlers(bot, { config, callAI, dateStr });
registerFileHandlers(bot, { callAI, repository });
registerMessageHandlers(bot, { pool, callAI, repository, dateStr });

process.on("unhandledRejection", (error) => console.error("UNHANDLED REJECTION:", error));
process.on("uncaughtException", (error) => console.error("UNCAUGHT EXCEPTION:", error));

let ready = false;
const server = http.createServer((request, response) => {
  response.writeHead(ready ? 200 : 503);
  response.end(ready ? "OK" : "STARTING");
});

async function shutdown(signal, code = 0) {
  ready = false;
  bot.stop(signal);
  await new Promise((resolve) => server.close(resolve));
  pool.end();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown(signal));

try {
  await bot.launch();
  ready = true;
  server.listen(config.port, () => console.log(`Bot berjalan; health check port ${config.port}`));
} catch (error) {
  console.error("Bot gagal launch:", error.message);
  await shutdown("launch failure", 1);
}
