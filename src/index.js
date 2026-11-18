import http from "http";
import https from "https";
import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import pool, { cleanupConversations } from "./database.js";
import { createRepository } from "./repository.js";
import { createAIService } from "./services/ai.js";
import { createSheetsService } from "./services/sheets.js";
import { createCalendarService } from "./services/calendar.js";
import { createPendingActionsStore } from "./services/pending.js";
import { createWorkspaceStore } from "./services/workspace.js";
import { createTrelloService } from "./services/trello.js";
import { createNotionService } from "./services/notion.js";
import { createSuperhumanService } from "./services/superhuman.js";
import { createKBService } from "./services/kb.js";
import { createReminderStore, startReminderPoller } from "./services/reminder.js";
import { registerTaskHandlers } from "./handlers/tasks.js";
import { registerMarketHandlers } from "./handlers/market.js";
import { registerMoneyHandlers } from "./handlers/money.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerMenuHandlers, BOT_COMMANDS } from "./handlers/menu.js";
import { registerFileHandlers } from "./handlers/files.js";
import { registerMessageHandlers } from "./handlers/messages.js";

const config = loadConfig();
cleanupConversations(config.retentionDays);

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const today = new Date();
const dateStr = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
const bot = new Telegraf(config.botToken, {
  telegram: { agent: new https.Agent({ keepAlive: false, family: 4 }) },
});
const repository = createRepository(pool);
const callAI = createAIService(config);
const sheetsService = createSheetsService(config);
const calendarService = createCalendarService(config);
const pendingStore = createPendingActionsStore(pool);
const workspaceStore = createWorkspaceStore(pool);
const trelloService = createTrelloService(config);
const notionService = createNotionService(config);
const superhumanService = createSuperhumanService(config);
const kbService = createKBService(config);
const reminderStore = createReminderStore(pool);

bot.use(async (ctx, next) => {
  if (String(ctx.from?.id) !== config.allowedUserId) {
    console.warn(`Akses ditolak untuk user ${ctx.from?.id ?? "unknown"}`);
    return;
  }
  return next();
});

const workspaceDeps = { workspaceStore, trelloService, notionService, superhumanService, kbService, calendarService };
registerTaskHandlers(bot, { pool, reminderStore });
registerMarketHandlers(bot, { config, callAI, dateStr });
registerMoneyHandlers(bot, { config, callAI, pool, sheetsService, pendingStore, reminderStore, dateStr });
registerActionHandlers(bot, { config, pendingStore, trelloService, notionService, superhumanService, calendarService });
registerMenuHandlers(bot, { config, pool, sheetsService, reminderStore, ...workspaceDeps });
registerFileHandlers(bot, { callAI, repository, pool, sheetsService, pendingStore, reminderStore, ...workspaceDeps, dateStr });
registerMessageHandlers(bot, { pool, callAI, repository, sheetsService, pendingStore, reminderStore, ...workspaceDeps, dateStr });

const reminderPoller = startReminderPoller({
  pool,
  sendMessage: (userId, text) => bot.telegram.sendMessage(userId, text),
});

process.on("unhandledRejection", (error) => console.error("UNHANDLED REJECTION:", error));
process.on("uncaughtException", (error) => console.error("UNCAUGHT EXCEPTION:", error));

let ready = false;
const server = http.createServer((request, response) => {
  response.writeHead(ready ? 200 : 503);
  response.end(ready ? "OK" : "STARTING");
});

async function shutdown(signal, code = 0) {
  ready = false;
  reminderPoller.stop();
  try {
    bot.stop(signal);
  } catch {}
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  pool.end();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown(signal));

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, resolve);
  });
  await bot.telegram.setMyCommands(BOT_COMMANDS).catch((err) => {
    console.warn("Gagal sinkronisasi menu command Telegram:", err.message);
  });
  await bot.launch(() => {
    ready = true;
    console.log(`Bot berjalan; health check port ${config.port}`);
  });
} catch (error) {
  console.error("Bot gagal launch:", error.message);
  await shutdown("launch failure", 1);
}
