import {
  MONTHS_ID,
  TARGET_STATUSES,
  todayIso,
  normalizeMonthName,
  getPreviousMonthPeriod,
  calculateMonthlySurplus,
  formatIDR,
  formatDraftPreview,
  formatTargetsList,
  formatTargetLogsList,
  formatSurplusSummary,
} from "../services/money.js";

function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

export const targetTools = [
  fnTool(
    "money_list_targets",
    "Read live savings targets and progress from Google Sheets Targets tab.",
    {
      status: { type: "string", enum: TARGET_STATUSES, description: "Optional status filter" },
      includeArchived: { type: "boolean", description: "Include archived targets (default false)" },
    }
  ),
  fnTool(
    "money_list_target_logs",
    "Read deposit history from Google Sheets TargetLogs tab.",
    {
      targetId: { type: "string", description: "Optional target ID (e.g. TGT-001)" },
      sourcePeriod: { type: "string", description: "Optional YYYY-MM surplus source period filter" },
      limit: { type: "integer", description: "Max rows to return (default 20)" },
    }
  ),
  fnTool(
    "money_check_surplus",
    "Check remaining monthly balance (saldo) minus amounts already allocated to savings targets for a given month (defaults to previous month) plus active targets list.",
    {
      month: { type: "string", description: "Indonesian month name (optional; defaults to previous month)" },
      year: { type: "integer", description: "Year (optional; defaults to previous month's year)" },
    }
  ),
  fnTool(
    "money_propose_create_target",
    "Create a confirmation draft to add a new savings target in Google Sheets Targets tab. Never writes directly.",
    {
      name: { type: "string", description: "Target item/goal name" },
      targetAmount: { type: "number", description: "Target goal amount in IDR (> 0)" },
      note: { type: "string", description: "Optional note or product link" },
      status: { type: "string", enum: TARGET_STATUSES, description: "Initial status (default Aktif)" },
    },
    ["name", "targetAmount"]
  ),
  fnTool(
    "money_propose_add_target_deposit",
    "Create a confirmation draft to record a deposit into a savings target in Google Sheets TargetLogs. Never writes directly.",
    {
      targetId: { type: "string", description: "Target ID (e.g. TGT-001)" },
      targetName: { type: "string", description: "Target name if targetId is unknown" },
      amount: { type: "number", description: "Positive deposit amount in IDR" },
      date: { type: "string", description: "Deposit date YYYY-MM-DD (defaults to today)" },
      note: { type: "string", description: "Deposit note (e.g. 'Sisa uang bulan Oktober')" },
      sourcePeriod: { type: "string", description: "Optional YYYY-MM tag when allocating remaining monthly balance" },
    },
    ["amount"]
  ),
  fnTool(
    "money_propose_update_target",
    "Create a confirmation draft to edit a target's name, amount, status, or note in Google Sheets Targets tab.",
    {
      targetId: { type: "string", description: "Target ID (e.g. TGT-001)" },
      targetName: { type: "string", description: "Target name if targetId is unknown" },
      patch: {
        type: "object",
        properties: {
          name: { type: "string" },
          targetAmount: { type: "number" },
          status: { type: "string", enum: TARGET_STATUSES },
          note: { type: "string" },
        },
      },
    },
    ["patch"]
  ),
  fnTool(
    "money_propose_delete_target_log",
    "Create a confirmation draft to delete an erroneous deposit log row from Google Sheets TargetLogs tab.",
    {
      logId: { type: "string", description: "Log ID to delete (e.g. LOG-001)" },
    },
    ["logId"]
  ),
];

function requireSheets(ctx) {
  if (!ctx?.sheetsService) throw new Error("Layanan Google Sheets tidak tersedia.");
  return ctx.sheetsService;
}

function requirePendingStore(ctx) {
  if (!ctx?.pendingStore) throw new Error("Penyimpanan draft konfirmasi tidak tersedia.");
  return ctx.pendingStore;
}

async function createTargetProposal(ctx, kind, payload) {
  const pendingStore = requirePendingStore(ctx);
  const summaryText = formatDraftPreview(kind, payload);
  const action = await pendingStore.create({ userId: ctx.userId, kind, payload, summaryText });
  ctx.pendingAction = action;
  return `Draft berhasil dibuat (ID: ${action.id}). JANGAN anggap sudah tersimpan — beritahu user ringkasan draft ini dan minta user klik tombol Simpan atau Batal.\n\n${summaryText}`;
}

function resolveSingleTarget(targets, { targetId, targetName }) {
  const idQuery = String(targetId ?? "").trim().toLowerCase();
  if (idQuery) {
    const exactId = targets.find((t) => String(t.id).toLowerCase() === idQuery);
    return exactId ? { target: exactId } : { error: `Target dengan ID "${targetId}" tidak ditemukan.` };
  }

  const nameQuery = String(targetName ?? "").trim().toLowerCase();
  if (!nameQuery) {
    return { error: "Sebutkan nama atau ID target yang dimaksud." };
  }

  const exact = targets.filter((t) => String(t.name).toLowerCase() === nameQuery);
  if (exact.length === 1) return { target: exact[0] };

  const partial = targets.filter((t) => String(t.name).toLowerCase().includes(nameQuery));
  if (partial.length === 1) return { target: partial[0] };
  if (partial.length > 1) {
    const candidates = partial.map((t) => `- ${t.id} • ${t.name} (${formatIDR(t.collectedAmount)} / ${formatIDR(t.targetAmount)})`).join("\n");
    return { error: `Ditemukan beberapa target yang mirip dengan "${targetName}":\n${candidates}\nTanyakan ke user target mana yang dipilih.` };
  }
  return { error: `Target "${targetName}" tidak ditemukan.` };
}

export async function executeTargetTool(name, args = {}, context = {}) {
  switch (name) {
    case "money_list_targets": {
      const sheets = requireSheets(context);
      const res = await sheets.listTargets({
        status: args.status,
        includeArchived: Boolean(args.includeArchived),
      });
      const targets = res?.targets || [];
      return `${formatTargetsList(targets)}\n\nRAW_JSON:\n${JSON.stringify(targets)}`;
    }
    case "money_list_target_logs": {
      const sheets = requireSheets(context);
      const res = await sheets.listTargetLogs({
        targetId: args.targetId,
        sourcePeriod: args.sourcePeriod,
        limit: args.limit || 20,
      });
      const logs = res?.logs || [];
      const label = args.targetId || args.sourcePeriod || "";
      return `${formatTargetLogsList(logs, label)}\n\nTotal cocok: ${formatIDR(res?.totalMatchedAmount || 0)}\n\nRAW_JSON:\n${JSON.stringify(res)}`;
    }
    case "money_check_surplus": {
      const sheets = requireSheets(context);
      const prev = getPreviousMonthPeriod();
      const month = args.month ? normalizeMonthName(args.month) : prev.month;
      const year = args.year ? Number(args.year) : prev.year;
      const [surplus, targetsRes] = await Promise.all([
        calculateMonthlySurplus({ sheetsService: sheets, month, year }),
        sheets.listTargets({ status: "Aktif" }),
      ]);
      const activeTargets = targetsRes?.targets || [];
      return `${formatSurplusSummary(surplus, activeTargets)}\n\nRAW_JSON:\n${JSON.stringify({ surplus, activeTargets })}`;
    }
    case "money_propose_create_target": {
      const sheets = requireSheets(context);
      const targetName = String(args.name ?? "").trim();
      const targetAmount = Number(args.targetAmount);
      if (!targetName) return "Error: nama target wajib diisi.";
      if (!Number.isFinite(targetAmount) || targetAmount <= 0) return "Error: nominal target harus lebih dari 0.";
      const status = args.status && TARGET_STATUSES.includes(args.status) ? args.status : "Aktif";

      const existing = (await sheets.listTargets({ includeArchived: false }))?.targets || [];
      const dup = existing.find((t) => String(t.name).toLowerCase() === targetName.toLowerCase());
      if (dup) {
        return `Error: Target aktif "${dup.name}" sudah ada (${dup.id}). Gunakan money_propose_update_target jika ingin mengubahnya.`;
      }

      return await createTargetProposal(context, "create_target", {
        name: targetName,
        targetAmount: Math.round(targetAmount),
        note: String(args.note ?? "").trim(),
        status,
        date: todayIso(),
      });
    }
    case "money_propose_add_target_deposit": {
      const sheets = requireSheets(context);
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return "Error: nominal setoran harus lebih dari 0.";

      const targets = (await sheets.listTargets({ includeArchived: false }))?.targets || [];
      const resolved = resolveSingleTarget(targets, { targetId: args.targetId, targetName: args.targetName });
      if (resolved.error) return resolved.error;
      const target = resolved.target;
      if (String(target.status).toLowerCase() === "arsip") {
        return `Error: Target "${target.name}" sudah diarsipkan.`;
      }

      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "").trim())
        ? String(args.date).trim()
        : todayIso();
      const sourcePeriod = String(args.sourcePeriod ?? "").trim();
      let overSurplusWarning;
      if (sourcePeriod) {
        const m = /^(\d{4})-(\d{2})$/.exec(sourcePeriod);
        if (!m) return `Error: format sourcePeriod tidak valid ("${sourcePeriod}"). Gunakan YYYY-MM, misalnya 2026-10.`;
        const monthIdx = Number(m[2]) - 1;
        if (monthIdx < 0 || monthIdx > 11) return `Error: bulan pada sourcePeriod "${sourcePeriod}" tidak valid.`;
        const surplus = await calculateMonthlySurplus({
          sheetsService: sheets,
          month: MONTHS_ID[monthIdx],
          year: Number(m[1]),
        });
        if (Math.round(amount) > surplus.availableSurplus) {
          overSurplusWarning = `Nominal melebihi sisa bebas bulan ${surplus.month} ${surplus.year} (${formatIDR(surplus.availableSurplus)}).`;
        }
      }

      return await createTargetProposal(context, "add_target_deposit", {
        targetId: target.id,
        targetName: target.name,
        amount: Math.round(amount),
        date,
        note: String(args.note ?? "").trim(),
        sourcePeriod,
        ...(overSurplusWarning ? { overSurplusWarning } : {}),
      });
    }
    case "money_propose_update_target": {
      const sheets = requireSheets(context);
      const rawPatch = args.patch || {};
      const patch = {};
      if (rawPatch.name !== undefined) {
        const clean = String(rawPatch.name).trim();
        if (!clean) return "Error: nama target baru tidak boleh kosong.";
        patch.name = clean;
      }
      if (rawPatch.targetAmount !== undefined) {
        const amt = Number(rawPatch.targetAmount);
        if (!Number.isFinite(amt) || amt <= 0) return "Error: nominal target harus lebih dari 0.";
        patch.targetAmount = Math.round(amt);
      }
      if (rawPatch.status !== undefined) {
        if (!TARGET_STATUSES.includes(rawPatch.status)) {
          return `Error: status tidak valid. Pilihan: ${TARGET_STATUSES.join(", ")}`;
        }
        patch.status = rawPatch.status;
      }
      if (rawPatch.note !== undefined) {
        patch.note = String(rawPatch.note).trim();
      }
      if (!Object.keys(patch).length) return "Error: tidak ada perubahan yang diberikan pada patch.";

      const targets = (await sheets.listTargets({ includeArchived: true }))?.targets || [];
      const resolved = resolveSingleTarget(targets, { targetId: args.targetId, targetName: args.targetName });
      if (resolved.error) return resolved.error;
      const target = resolved.target;

      return await createTargetProposal(context, "update_target", {
        targetId: target.id,
        targetName: target.name,
        expected: { name: target.name, targetAmount: target.targetAmount, status: target.status },
        patch,
      });
    }
    case "money_propose_delete_target_log": {
      const sheets = requireSheets(context);
      const logId = String(args.logId ?? "").trim();
      if (!logId) return "Error: logId wajib diisi.";

      const res = await sheets.listTargetLogs({ limit: 100 });
      const hit = (res?.logs || []).find((l) => String(l.logId).toLowerCase() === logId.toLowerCase());
      if (!hit) return `Log setoran "${logId}" tidak ditemukan.`;

      return await createTargetProposal(context, "delete_target_log", {
        logId: hit.logId,
        rowNumber: hit.rowNumber,
        expected: {
          targetId: hit.targetId,
          targetName: hit.targetName,
          amount: hit.amount,
          date: hit.date,
        },
      });
    }
    default:
      return null;
  }
}
