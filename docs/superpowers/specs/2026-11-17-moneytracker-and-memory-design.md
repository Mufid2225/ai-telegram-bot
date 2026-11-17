# MoneyTracker & Persistent Assistant Design Spec

**Date:** 2026-11-17  
**Project:** `ai-telegram-bot`  
**Target Spreadsheet:** Google Sheets `MoneyTracker` (`<SPREADSHEET_ID>`)

---

## 1. Goals

1. Integrate the Telegram bot directly with the user's Google Sheets `MoneyTracker` as the **single source of truth** for all personal finance data (`Dashboard`, `Income`, `Usage`, `Expenses`, `Database`).
2. Allow the user to:
   - Query live financial status, budget allocation, remaining balance, overbudget alerts, and transaction history via natural chat or commands (`/keuangan`, `/pengeluaran`).
   - Run what-if budget planning/discussions (e.g., dividing monthly budget across 4 weeks) using live spreadsheet data **without** creating transaction drafts.
   - Record new expenses (single, multi-item, or OCR from receipt/transfer screenshots), edit/delete expenses, and add/update monthly income via natural chat or `/catat`.
   - Enforce **mandatory button confirmation** (`✅ Simpan` / `❌ Batal`) before any write/update/delete hits Google Sheets.
3. Upgrade the bot's local assistant capabilities so casual notes, user preferences/facts, reminders, and pending confirmation drafts **persist in SQLite (`data.db`) across server restarts**, with scheduled reminder notifications sent while the bot is running.

## 2. Non-Goals

- No duplicate local mirror/database of Google Sheets transactions (Google Sheets remains the sole financial truth).
- No Google Cloud Console / OAuth / Service Account setup (connection uses a self-contained Google Apps Script Web App protected by a shared secret).
- No automatic modification of percentage allocation formulas in the `Income` tab unless explicitly requested later.

---

## 3. Architecture & Data Flow

### 3.1 Financial Flow (Google Sheets Single Source of Truth)

```text
Telegram User (Chat / /catat / /keuangan / /pengeluaran / Receipt Photo)
   │
   ▼
Bot Handlers (messages.js, files.js, money.js)
   │
   ├── Read / What-If Planning ──► AI Tool Call (money_get_summary / money_list_expenses / money_get_options)
   │                                    │
   │                                    ▼
   │                               src/services/sheets.js ──► Apps Script Web App ──► MoneyTracker Sheets
   │
   └── Write Intent (Expenses / Income / Edit / Delete)
          │
          ▼
     AI Tool Call (money_propose_*) ──► Persist draft in SQLite `pending_actions`
          │
          ▼
     Send preview message + InlineKeyboard [✅ Simpan] [❌ Batal]
          │
          ├── Chat correction before click ──► AI creates replacement draft (supersedes old draft)
          └── User clicks ✅ Simpan (verified ALLOWED_USER_ID) ──► Apps Script writes to MoneyTracker
```

### 3.2 Memory & Persistence Across Server Restarts

Nothing important relies solely on in-memory variables or the LLM's 10-message sliding chat history:

| Data Type | Storage | Persistence Behavior |
|---|---|---|
| Transactions, Income, Allocations, Bank & Category lists | **Google Sheets (`MoneyTracker`)** | Cloud-persistent; manual edits and bot writes share one source of truth. |
| Chat history (`conversations`) | **SQLite (`data.db`)** | Persists across restarts (`CONVERSATION_RETENTION_DAYS`, default 90). Latest 10 messages injected into prompt. |
| Long-term facts (`knowledge`) | **SQLite (`data.db`)** | Persists permanently via `remember` / `recall` / `forget`. Latest 30 facts injected into prompt + searchable anytime. |
| Notes & tasks (`memories`) | **SQLite (`data.db`)** | Persists permanently (`tugas`, `ujian`, `catatan`). Accessible via `/tugas`, `/catatan`, and AI tools. |
| Scheduled reminders (`reminders`) | **SQLite (`data.db`)** | Stores `due_at` (ISO timestamp) and `sent_at`. Background poller checks `data.db` on startup and every 30s; unsent overdue reminders fire automatically when the server starts back up. |
| Unconfirmed drafts (`pending_actions`) | **SQLite (`data.db`)** | Stores pending Google Sheets write payloads with `status` (`pending`, `confirmed`, `cancelled`, `superseded`, `expired`) and `expires_at` (24h TTL) so inline buttons survive bot restarts. |

---

## 4. Google Apps Script Web App Design (`apps-script/MoneyTracker.gs`)

Deployed as a Google Apps Script Web App inside the `MoneyTracker` spreadsheet (`Execute as: Me`, `Who has access: Anyone`), protected by `PropertiesService` secret `SHEET_API_SECRET` (validated on every `doPost` JSON payload).

### 4.1 Sheet Mapping (Observed from `MoneyTracker`)
- **`Database`**:
  - Column `A` (`A2:A`): valid `Bank` list (`Seabank`, `Shopee Pay`, `Gopay`, `Dana`, `Ovo`, `Jago`, `Cash`, ...).
  - Column `B` (`B2:B`): valid `Kategori` list (`Transportasi`, `Tabungan`, `Dana Darurat`, `Makan`, `Jajan`, `Lain-lain`, `Sisa Tabungan`, ...).
- **`Expenses`**:
  - Row 1 headers: `A: Cek`, `B: Tanggal`, `C: Bulan`, `D: Transaksi`, `E: Uraian`, `F: Kategori`, `G: Bank`, `H: Nilai`.
  - Pre-formatted empty checkbox rows may exist below actual entries (e.g., row 18 unchecked while rows 2–17 have data). Therefore, Apps Script finds the first row where `Tanggal`, `Uraian`, and `Nilai` are all empty (or appends after the last populated expense row), copies formulas/data validation from the template/previous row if needed, sets `Cek = true`, `Tanggal = Date`, `Transaksi`, `Uraian`, `Kategori`, `Bank`, `Nilai`, and leaves `Bulan` formula intact (or sets Indonesian month name if column C has no formula).
- **`Income`**:
  - Dynamically locates the `Income` header row and `Total` row in column `A`, and the `Alokasi` header row and `Total` row in column `A`, mapping columns `C`–`N` to `Januari`–`Desember`.
  - Supports reading income sources + allocation budgets for any requested month (`Januari`–`Desember`), and adding/setting nominal amounts for existing or new income rows (inserting into an empty slot above `Total` or inserting a row before `Total` if all slots are used).
- **`Usage` & `Dashboard`**:
  - Reads `Dashboard` KPI values when matching the active year/month, **and** computes accurate per-month summary (`totalIncome`, `totalAlokasi`, `totalRealisasi`, `saldo`, per-category `{ kategori, percent, alokasi, realisasi, progressPercent, remaining, overbudget }`) directly from `Income` + `Expenses` (filtered by checked `Cek === true` and matching month/year) so queries about *any* month/year return consistent, exact numbers even if `Dashboard!J3:J4` is currently viewing a different month.

### 4.2 Supported Actions (`POST` JSON `{ secret, action, ...params }`)
1. `get_context`: Returns `{ banks, categories, incomeSources, activeDashboardPeriod }`.
2. `get_summary`: Params `{ month, year }`. Returns full monthly financial summary (income breakdown, allocations, realizations per category, overbudget flags, totals, plus `banks` and `categories`).
3. `list_expenses`: Params `{ month, year, category, bank, search, limit }`. Returns matching rows with `{ rowNumber, checked, date, month, transaksi, uraian, kategori, bank, nilai }`.
4. `add_expenses`: Params `{ items: [{ date, transaksi, uraian, kategori, bank, nilai, cek }] }`. Validates `kategori` and `bank` against `Database`, inserts rows cleanly, returns created `rowNumber`s.
5. `update_expense`: Params `{ rowNumber, expected: { uraian, nilai, date }, patch: { ... } }`. Verifies row still matches `expected` before updating so manual sheet edits aren't overwritten blindly.
6. `delete_expense`: Params `{ rowNumber, expected: { uraian, nilai, date } }`. Verifies row still matches `expected` before clearing/deleting row.
7. `upsert_income`: Params `{ source, month, amount, mode: "set" | "add" }`. Updates or adds income entry in `Income` sheet.

---

## 5. Bot Module Architecture

### 5.1 Configuration ([src/config.js](file:///c:/Project/ai-telegram-bot/src/config.js))
- Add optional config fields:
  - `sheetWebhookUrl`: `(env.SHEET_WEBHOOK_URL || "").trim().replace(/\/$/, "")`
  - `sheetApiSecret`: `(env.SHEET_API_SECRET || "").trim()`
- Keep them optional in `validateConfig` so existing bot commands and unit tests continue working without breaking. When a MoneyTracker action is invoked while unconfigured, return a clear setup error message.

### 5.2 Database Schema ([src/database.js](file:///c:/Project/ai-telegram-bot/src/database.js))
Add two tables to `initDB()`:
- `pending_actions`:
  - `id TEXT PRIMARY KEY`
  - `user_id TEXT NOT NULL`
  - `kind TEXT NOT NULL` (`add_expenses`, `update_expense`, `delete_expense`, `upsert_income`)
  - `payload_json TEXT NOT NULL`
  - `summary_text TEXT NOT NULL`
  - `status TEXT NOT NULL DEFAULT 'pending'`
  - `created_at TEXT NOT NULL`
  - `expires_at TEXT NOT NULL`
- `reminders`:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `user_id TEXT NOT NULL`
  - `message TEXT NOT NULL`
  - `due_at TEXT NOT NULL` (ISO-8601 timestamp)
  - `sent_at TEXT` (null until delivered)
  - `created_at TEXT NOT NULL`

### 5.3 Sheets Client (`src/services/sheets.js`)
- `createSheetsService(config, fetchImpl = fetch)`:
  - Wraps `POST` calls to `config.sheetWebhookUrl` with `{ secret: config.sheetApiSecret, action, ...payload }`, `redirect: "follow"` (required for Google Apps Script `/exec` URLs), 15s timeout, and structured error handling (`{ ok, data, error }`).

### 5.4 AI Tool-Calling Upgrade ([src/services/ai.js](file:///c:/Project/ai-telegram-bot/src/services/ai.js))
- Extend `createAIService(config, fetchImpl = fetch)` so `callAI(messages, ctx, options = {})` accepts optional `{ tools, executeTool, toolContext, maxSteps = 5 }`:
  - When `tools` is omitted, behavior is unchanged (100% compatible with `/saham`, `/ekonomi`, `/cari`).
  - When `tools` is provided:
    - Loops up to `maxSteps` times: sends `{ model, messages, tools, stream: false }`.
    - If assistant returns `tool_calls`, executes each tool via `executeTool(name, args, toolContext)`, appends `{ role: "tool", tool_call_id, content }` to conversation turn messages, and sends next completion request.
    - When assistant returns final text (or hits `maxSteps`), strips markdown via `stripMarkdown()` and returns text.
    - Returns side-channel metadata if needed (or tools attach `pendingAction` to `toolContext` so the handler automatically attaches Telegram inline buttons `[✅ Simpan] [❌ Batal]` to the reply!).

### 5.5 Unified Tool Registry ([src/tools.js](file:///c:/Project/ai-telegram-bot/src/tools.js) & `src/services/money.js`)
Expose tools to chat & `/catat` / receipt OCR:
- **Finance Read Tools (no confirmation needed):**
  - `money_get_summary({ month?, year? })`
  - `money_list_expenses({ month?, year?, category?, bank?, search?, limit? })`
  - `money_get_options()`
- **Finance Write Proposal Tools (create persistent `pending_actions` row + attach inline buttons):**
  - `money_propose_add_expenses({ items })` — validates each item's `kategori` and `bank` against live `Database` list first; marks previous active pending draft for that user as `superseded` if user is refining/correcting it.
  - `money_propose_update_expense({ rowNumber, expected, patch })`
  - `money_propose_delete_expense({ rowNumber, expected })`
  - `money_propose_upsert_income({ source, month, amount, mode })`
- **Local Memory, Notes, Reminders & Utilities (SQLite `data.db`):**
  - `get_current_time({ format? })`
  - `calculate({ expression })`
  - `remember({ entity, attribute, value, category? })` / `recall({ query })` / `forget({ entity, attribute? })`
  - `save_note({ content, subject?, type? })` / `list_notes({ type? })` / `delete_note({ id })`
  - `save_reminder({ message, dueAt })` / `list_reminders()` / `delete_reminder({ id })`

### 5.6 Chart Support ([src/services/chart.js](file:///c:/Project/ai-telegram-bot/src/services/chart.js))
- Add `getFinanceChartImage(summary)` using `chartjs-node-canvas` to generate a clean horizontal bar chart comparing **Alokasi vs Realisasi** per category (highlighting overbudget bars in red), sent alongside `/keuangan` when requested or by default.

### 5.7 Handlers & Commands
- **`src/handlers/money.js`:**
  - `/catat <teks>`: Runs focused AI extraction against live `Database` options and produces a `pending_actions` draft with `[✅ Simpan] [❌ Batal]` inline buttons. Shows usage examples if called with no arguments.
  - `/keuangan [bulan]`: Fetches live `get_summary` for the requested (or current) month, sends formatted summary text + `getFinanceChartImage` PNG.
  - `/pengeluaran [bulan]`: Fetches latest transactions from `list_expenses` with `rowNumber`, date, category, bank, and formatted IDR amount.
  - Inline callback handlers (`money:confirm:<id>`, `money:cancel:<id>`):
    - Enforces `ctx.from?.id` matches `config.allowedUserId` and `pending_actions.user_id`.
    - Prevents double execution (atomically checks `status === 'pending'` and expiration).
    - Executes the write via `sheetsService`, updates `status = 'confirmed'`, and edits the confirmation message with the final result.
- **`src/handlers/messages.js`:**
  - Remove blind keyword auto-saving (`isImportantMessage`) so budget discussions containing words like `"jadwal"` or `"reminder"` don't get silently saved as school tasks; instead, let AI tools (`save_note`, `save_reminder`, `save_task`, `remember`) decide intentionally.
  - Wire AI service with full `tools` + `toolContext` (`userId`, `pool`, `sheetsService`, `pendingActionsRepo`, `onPendingAction`).
  - System prompt explicitly instructs the AI:
    - For financial questions, budget planning, or simulations: **call read tools (`money_get_summary`, `money_list_expenses`) first**, calculate accurately, **never** call `money_propose_*` unless the user clearly states an actual transaction to record/edit/delete.
    - When a draft is created, present a clean summary and let the attached `[✅ Simpan] [❌ Batal]` buttons handle confirmation.
- **`src/handlers/files.js`:**
  - Enhance photo OCR prompt & tool wiring: if OCR text looks like a shopping receipt, transfer proof, or QRIS payment, AI extracts items into `money_propose_add_expenses` (always showing the confirmation buttons `[✅ Simpan] [❌ Batal]`). Otherwise handles document/photo summary normally.
- **`src/handlers/tasks.js` & `src/services/reminder.js`:**
  - Add `/catatan` to list saved `catatan`/`memories` cleanly (alongside existing `/tugas`, `/hapus`, `/update`, `/remind`).
  - Update `/remind` to show both upcoming task deadlines and scheduled `reminders` from `data.db`.
  - Start lightweight reminder poller in `src/index.js` (`setInterval` every 30s + run once on startup, cleanly stopped in `shutdown()`) to send Telegram notifications for due unsent reminders via `bot.telegram.sendMessage(config.allowedUserId, ...)` and mark `sent_at`.

---

## 6. Error Handling & Security

- **Authorization:** Both global `bot.use` middleware and callback query handlers verify `String(ctx.from?.id) === config.allowedUserId`.
- **Apps Script Security:** Every request sends `SHEET_API_SECRET` over HTTPS; Apps Script rejects mismatched secrets. Neither `SHEET_WEBHOOK_URL` nor `SHEET_API_SECRET` is ever logged or echoed to Telegram.
- **No Plaintext Markdown Leaks:** Bot replies go through `stripMarkdown` / plain clean formatting consistent with existing bot style, and confirmation previews use `replyWith...` safely without breaking on special characters.
- **Graceful Degradation:** If Google Sheets is unreachable or `SHEET_WEBHOOK_URL` is unconfigured, financial tools return clear messages without crashing the bot, while notes, reminders, memory, market, and search features keep running.

---

## 7. Testing Plan

All tests run offline via `npm test` (`node --test`) using injected mocks (`fetchImpl`, `:memory:` SQLite):
1. `test/config.test.js`: Verify optional `SHEET_WEBHOOK_URL` / `SHEET_API_SECRET` parsing.
2. `test/sheets.test.js`: Mock `fetchImpl` for `sheets.js` (success, HTTP error, Apps Script JSON error, missing config).
3. `test/ai.test.js`: Verify tool-calling loop (`tool_calls` → tool execution → final answer, maxSteps guard, backward compatibility without `tools`).
4. `test/money.test.js`: Verify `pending_actions` SQLite persistence (create, supersede old draft, confirm once, reject expired/cancelled, reject wrong user), category/bank validation, IDR formatting, and finance chart buffer rendering.
5. `test/reminder.test.js`: Verify `reminders` SQLite persistence, due reminder polling, and marking `sent_at` without duplicate sends.
