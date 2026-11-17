import { buildConfirmExtra, runWithProgress } from "../utils/telegram.js";

/**
 * Shared atomic confirmation runner for pending MoneyTracker and Workspace drafts.
 */
export async function runPendingConfirmation({
  ctx,
  actionType,
  actionId,
  allowedUserId,
  pendingStore,
  progressText = "Menyimpan perubahan...",
  executeAction,
  stepMs = 100,
  finishDelayMs = 0,
}) {
  if (String(ctx.from?.id) !== String(allowedUserId)) {
    await ctx.answerCbQuery("Akses ditolak.");
    return;
  }

  const userId = String(ctx.from.id);
  const existing = await pendingStore.getById(actionId, userId);

  if (actionType === "cancel") {
    if (!existing || existing.status !== "pending") {
      await ctx.answerCbQuery("Draft sudah tidak aktif.");
      return;
    }
    await pendingStore.markStatus(actionId, "cancelled");
    await ctx.answerCbQuery("Dibatalkan.");
    const prev = ctx.callbackQuery?.message?.text || existing.summary_text || "Draft";
    await ctx.editMessageText(`${prev}\n\n❌ Dibatalkan.`);
    return;
  }

  const claimed = await pendingStore.claimForExecution(actionId, userId);
  if (!claimed) {
    const reason = !existing
      ? "Draft tidak ditemukan."
      : existing.status === "confirmed"
        ? "Draft sudah disimpan sebelumnya."
        : existing.status === "superseded"
          ? "Draft sudah digantikan oleh revisi terbaru."
          : existing.status === "cancelled"
            ? "Draft sudah dibatalkan."
            : "Draft sudah kedaluwarsa atau sedang diproses.";
    await ctx.answerCbQuery(reason);
    return;
  }

  await ctx.answerCbQuery(progressText);
  const prev = ctx.callbackQuery?.message?.text || claimed.summary_text;
  await runWithProgress({
    ctx,
    mode: "edit",
    stepMs,
    finishDelayMs,
    task: async () => {
      const resultText = await executeAction(claimed);
      await pendingStore.markStatus(actionId, "confirmed");
      return resultText;
    },
    formatResult: (resultText) => ({ text: `✅ ${resultText}` }),
    formatError: (error) => {
      pendingStore.markStatus(actionId, "pending").catch(() => {});
      return {
        text: `${prev}\n\nGagal menyimpan: ${error.message}\nSilakan klik Simpan lagi atau Batal.`,
        extra: buildConfirmExtra({ id: actionId, kind: claimed.kind }),
      };
    },
  });
}

function requireService(svc, name) {
  if (!svc) throw new Error(`Layanan ${name} tidak tersedia.`);
  return svc;
}

/**
 * Execute a confirmed Trello, Notion, or Superhuman Docs draft.
 */
export async function executeWorkspaceAction(action, services = {}) {
  const { kind, payload } = action;

  if (kind === "trello_create_card") {
    const card = await requireService(services.trelloService, "Trello").createCard(payload);
    return `Card Trello "${card.name || payload.name}" dibuat di list ${payload.listName} (${payload.boardName}).${card.shortUrl ? `\nLink: ${card.shortUrl}` : ""}`;
  }
  if (kind === "trello_move_card") {
    const card = await requireService(services.trelloService, "Trello").moveCard(payload);
    return `Card Trello "${card.name || payload.cardName}" dipindahkan ke list ${payload.targetListName} (${payload.boardName}).${card.shortUrl ? `\nLink: ${card.shortUrl}` : ""}`;
  }
  if (kind === "trello_update_card") {
    const card = await requireService(services.trelloService, "Trello").updateCard(payload);
    const label = payload.closed ? "diarsipkan" : "diperbarui";
    return `Card Trello "${card.name || payload.cardName}" berhasil ${label}.${card.shortUrl ? `\nLink: ${card.shortUrl}` : ""}`;
  }
  if (kind === "notion_create_page") {
    const page = await requireService(services.notionService, "Notion").createDatabasePage({
      databaseId: payload.databaseId,
      values: payload.values,
    });
    return `Halaman Notion "${page.title}" tersimpan di ${payload.databaseName}.${page.url ? `\nLink: ${page.url}` : ""}`;
  }
  if (kind === "notion_update_page") {
    const page = await requireService(services.notionService, "Notion").updatePage({
      pageId: payload.pageId,
      values: payload.values || {},
      archived: payload.archived,
    });
    const label = payload.archived ? "diarsipkan" : "diperbarui";
    return `Halaman Notion "${page.title || payload.pageTitle}" berhasil ${label}.${page.url ? `\nLink: ${page.url}` : ""}`;
  }
  if (kind === "superhuman_add_row") {
    const res = await requireService(services.superhumanService, "Superhuman Docs").insertRows(
      payload.docId,
      payload.tableId,
      { rows: payload.rows }
    );
    const note = res.completed ? "selesai diproses" : `dalam antrean async (requestId: ${res.requestId})`;
    return `Baris baru di Superhuman Docs "${payload.tableName}" (${payload.docName}) ${note}.`;
  }
  if (kind === "superhuman_update_row") {
    const res = await requireService(services.superhumanService, "Superhuman Docs").updateRow(
      payload.docId,
      payload.tableId,
      payload.rowId,
      { cells: payload.cells }
    );
    const note = res.completed ? "selesai diperbarui" : `dalam antrean async (requestId: ${res.requestId})`;
    return `Baris "${payload.rowName || payload.rowId}" di Superhuman Docs "${payload.tableName}" ${note}.`;
  }

  throw new Error(`Aksi workspace tidak dikenal: ${kind}`);
}

export async function handleWorkspaceActionCallback({
  ctx,
  actionType,
  actionId,
  allowedUserId,
  pendingStore,
  services,
  stepMs = 100,
  finishDelayMs = 0,
}) {
  return runPendingConfirmation({
    ctx,
    actionType,
    actionId,
    allowedUserId,
    pendingStore,
    progressText: "Mengeksekusi ke workspace...",
    executeAction: (claimed) => executeWorkspaceAction(claimed, services),
    stepMs,
    finishDelayMs,
  });
}

export function registerActionHandlers(bot, { config, pendingStore, trelloService, notionService, superhumanService }) {
  const services = { trelloService, notionService, superhumanService };
  bot.action(/^action:(confirm|cancel):([a-f0-9]+)$/, async (ctx) => {
    const [, actionType, actionId] = ctx.match;
    try {
      await handleWorkspaceActionCallback({
        ctx,
        actionType,
        actionId,
        allowedUserId: config.allowedUserId,
        pendingStore,
        services,
      });
    } catch (error) {
      console.error("Workspace action callback error:", error);
      await ctx.answerCbQuery(`Error: ${error.message}`).catch(() => {});
    }
  });
}
