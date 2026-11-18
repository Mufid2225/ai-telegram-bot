export function isAppsScriptConfigured(config) {
  return Boolean(config?.sheetWebhookUrl && config?.sheetApiSecret);
}

export async function requestAppsScript(config, action, payload = {}, fetchImpl = fetch) {
  if (!isAppsScriptConfigured(config)) {
    throw new Error("Google Sheets / Apps Script belum dikonfigurasi. Isi SHEET_WEBHOOK_URL dan SHEET_API_SECRET di .env.local.");
  }
  const resp = await fetchImpl(config.sheetWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: config.sheetApiSecret, action, ...payload }),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Google Sheets HTTP error (${resp.status}): ${text.slice(0, 150)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Respon Google Apps Script bukan JSON. Pastikan Web App di-deploy sebagai 'Anyone'.");
  }
  if (!parsed?.ok) {
    throw new Error(parsed?.error || "Google Apps Script gagal memproses permintaan.");
  }
  return parsed.data;
}

export function createSheetsService(config, fetchImpl = fetch) {
  const request = (action, payload = {}) => requestAppsScript(config, action, payload, fetchImpl);

  return {
    isConfigured: () => isAppsScriptConfigured(config),
    getContext: () => request("get_context"),
    getSummary: (params = {}) => request("get_summary", params),
    listExpenses: (filters = {}) => request("list_expenses", filters),
    addExpenses: (items) => request("add_expenses", { items }),
    updateExpense: ({ rowNumber, expected, patch }) => request("update_expense", { rowNumber, expected, patch }),
    deleteExpense: ({ rowNumber, expected }) => request("delete_expense", { rowNumber, expected }),
    upsertIncome: (params) => request("upsert_income", params),
  };
}
