# MoneyTracker & Persistent Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `ai-telegram-bot` to the user's `MoneyTracker` Google Sheet via Google Apps Script Web App as the financial single source of truth with mandatory button confirmation, and persist AI memory, notes, scheduled reminders, and pending drafts in SQLite `data.db`.

**Architecture:** Add a Google Apps Script Web App (`apps-script/MoneyTracker.gs`) for live reads/writes across `Database`, `Expenses`, `Income`, `Usage`, and `Dashboard`. Upgrade `createAIService` in `src/services/ai.js` to run an OpenAI tool-calling loop backed by `src/services/sheets.js`, `src/services/money.js`, `src/services/reminder.js`, and `src/tools.js`, with SQLite-backed `pending_actions` and `reminders` tables in `src/database.js`.

**Tech Stack:** Node.js 26 (`node --test`, ESM), Telegraf 4, `better-sqlite3` 13.2, `chartjs-node-canvas`, `dayjs`, Google Apps Script.

## Global Constraints

- Google Sheets (`MoneyTracker`) is the sole financial source of truth; do not mirror transactions in SQLite.
- Every Google Sheets write/update/delete MUST go through a SQLite-persisted `pending_actions` draft with Telegram inline button confirmation (`✅ Simpan` / `❌ Batal`).
- Budget planning / what-if questions must use read tools only and never create transaction drafts.
- Never log or echo secrets (`BOT_TOKEN`, `ROUTER_API_KEY`, `SHEET_API_SECRET`, `SHEET_WEBHOOK_URL`).
- Keep all existing tests (`test/config.test.js`, `test/tasks.test.js`, `test/telegram.test.js`) passing.

---

### Task 1: Config Support for Apps Script Webhook

**Files:**
- Modify: `src/config.js`
- Modify: `test/config.test.js`

**Interfaces:**
- Produces: `validateConfig(env)` returning `{ ..., sheetWebhookUrl, sheetApiSecret }`

- [ ] **Step 1: Write failing tests in `test/config.test.js`**

Add assertions verifying `sheetWebhookUrl` trims trailing slashes and defaults to `""`, and `sheetApiSecret` trims whitespace and defaults to `""`.

- [ ] **Step 2: Run `node --test test/config.test.js` to confirm failure**

Expected: FAIL because `sheetWebhookUrl` and `sheetApiSecret` are `undefined`.

- [ ] **Step 3: Update `src/config.js` to include `sheetWebhookUrl` and `sheetApiSecret`**

- [ ] **Step 4: Run `node --test test/config.test.js` to confirm pass**

---

### Task 2: SQLite Factory & Persistent `pending_actions` / `reminders` Tables

**Files:**
- Modify: `src/database.js`
- Create: `test/database.test.js`

**Interfaces:**
- Produces: `createDatabase(dbPath)` returning `{ query(sql, params), end() }`, plus default `pool` and `cleanupConversations(retentionDays)`

- [ ] **Step 1: Write failing tests in `test/database.test.js`**

Test `createDatabase(":memory:")` creates `memories`, `conversations`, `knowledge`, `pending_actions`, `reminders` and supports `lastInsertRowid` on `INSERT`.

- [ ] **Step 2: Run `node --test test/database.test.js` to confirm failure**

- [ ] **Step 3: Implement `createDatabase(dbPath)` and new tables in `src/database.js`**

- [ ] **Step 4: Run `node --test test/database.test.js` to confirm pass**

---

### Task 3: Google Apps Script HTTP Client (`src/services/sheets.js`)

**Files:**
- Create: `src/services/sheets.js`
- Create: `test/sheets.test.js`

**Interfaces:**
- Consumes: `config.sheetWebhookUrl`, `config.sheetApiSecret`
- Produces: `createSheetsService(config, fetchImpl = fetch)` with `{ isConfigured, getContext, getSummary, listExpenses, addExpenses, updateExpense, deleteExpense, upsertIncome }`

- [ ] **Step 1: Write failing tests in `test/sheets.test.js`**

Test unconfigured error, `redirect: "follow"` + secret inclusion, HTTP error handling, Apps Script `{ ok: false, error }` handling, and all action methods with mocked `fetchImpl`.

- [ ] **Step 2: Run `node --test test/sheets.test.js` to confirm failure**

- [ ] **Step 3: Implement `src/services/sheets.js`**

- [ ] **Step 4: Run `node --test test/sheets.test.js` to confirm pass**

---

### Task 4: Multi-Turn OpenAI Tool Calling in `src/services/ai.js`

**Files:**
- Modify: `src/services/ai.js`
- Create: `test/ai.test.js`

**Interfaces:**
- Produces: `createAIService(config, fetchImpl = fetch)` returning `async function callAI(messages, ctx, options = {})`

- [ ] **Step 1: Write failing tests in `test/ai.test.js`**

Test backward-compatible call without `tools`, multi-step `tool_calls` execution loop, malformed tool JSON resilience, and `maxSteps` guard.

- [ ] **Step 2: Run `node --test test/ai.test.js` to confirm failure**

- [ ] **Step 3: Implement tool-calling loop in `src/services/ai.js`**

- [ ] **Step 4: Run `node --test test/ai.test.js` to confirm pass**

---

### Task 5: Money Domain Logic, Pending Actions Store, & Finance Chart

**Files:**
- Create: `src/services/money.js`
- Modify: `src/services/chart.js`
- Create: `test/money.test.js`

**Interfaces:**
- Consumes: `pool` (`src/database.js`), `sheetsService` (`src/services/sheets.js`)
- Produces: `MONTHS_ID`, `normalizeMonthName`, `formatIDR`, `normalizeExpenseItem`, `formatDraftPreview`, `formatSummaryText`, `formatExpensesList`, `createPendingActionsStore(pool)`, `executeConfirmedAction(action, sheetsService)`, and `getFinanceChartImage(summary)` in `src/services/chart.js`

- [ ] **Step 1: Write failing tests in `test/money.test.js`**

Test IDR formatting, Indonesian month normalization, category/bank validation against `Database` options, `pending_actions` SQLite lifecycle (create, supersede older pending draft, atomic `claimForExecution`, cancel, expired check), `executeConfirmedAction`, and `getFinanceChartImage` PNG generation.

- [ ] **Step 2: Run `node --test test/money.test.js` to confirm failure**

- [ ] **Step 3: Implement `src/services/money.js` and `getFinanceChartImage` in `src/services/chart.js`**

- [ ] **Step 4: Run `node --test test/money.test.js` to confirm pass**

---

### Task 6: Persistent Reminder Store & Poller (`src/services/reminder.js`)

**Files:**
- Create: `src/services/reminder.js`
- Create: `test/reminder.test.js`

**Interfaces:**
- Consumes: `pool` (`src/database.js`)
- Produces: `createReminderStore(pool)`, `startReminderPoller({ pool, sendMessage, intervalMs })`

- [ ] **Step 1: Write failing tests in `test/reminder.test.js`**

Test creating reminders in SQLite, querying due unsent reminders, atomic `markSent` preventing duplicate delivery, deleting reminders, and `tick()` sending via injected `sendMessage`.

- [ ] **Step 2: Run `node --test test/reminder.test.js` to confirm failure**

- [ ] **Step 3: Implement `src/services/reminder.js`**

- [ ] **Step 4: Run `node --test test/reminder.test.js` to confirm pass**

---

### Task 7: Unified Tool Registry (`src/tools.js`)

**Files:**
- Modify: `src/tools.js`
- Create: `test/tools.test.js`

**Interfaces:**
- Consumes: `src/memory.js`, `src/services/money.js`, `src/services/reminder.js`, `src/services/sheets.js`
- Produces: `tools`, `executeTool(name, args, context)`

- [ ] **Step 1: Write failing tests in `test/tools.test.js`**

Test `money_get_summary`, `money_propose_add_expenses` (validating options and creating `pending_actions` + setting `context.pendingAction`), `save_note`/`list_notes`/`delete_note`, and `save_reminder`/`list_reminders`/`delete_reminder`.

- [ ] **Step 2: Run `node --test test/tools.test.js` to confirm failure**

- [ ] **Step 3: Update `src/tools.js` with MoneyTracker, Note, Reminder, Memory, and Utility tools**

- [ ] **Step 4: Run `node --test test/tools.test.js` to confirm pass**

---

### Task 8: Telegram Handlers (`/catat`, `/keuangan`, `/pengeluaran`, `/catatan`, Callbacks, Messages, OCR Files, & Wiring)

**Files:**
- Create: `src/handlers/money.js`
- Modify: `src/handlers/tasks.js`
- Modify: `src/handlers/messages.js`
- Modify: `src/handlers/files.js`
- Modify: `src/index.js`
- Create: `test/handlers-money.test.js`

**Interfaces:**
- Consumes: `tools`, `executeTool`, `sheetsService`, `pendingStore`, `reminderStore`, `getFinanceChartImage`, `replyText`
- Produces: `registerMoneyHandlers(bot, deps)` and wired `src/index.js`

- [ ] **Step 1: Write failing tests in `test/handlers-money.test.js`**

Test Telegram callback authorization (`allowedUserId`), confirm vs cancel flow editing message cleanly, and reply with inline keyboard helper when `pendingAction` exists.

- [ ] **Step 2: Run `node --test test/handlers-money.test.js` to confirm failure**

- [ ] **Step 3: Implement `src/handlers/money.js`, update `src/handlers/tasks.js`, `src/handlers/messages.js`, `src/handlers/files.js`, and wire in `src/index.js`**

- [ ] **Step 4: Run full `npm test` to confirm all tests pass**

---

### Task 9: Google Apps Script (`apps-script/MoneyTracker.gs`), `.env.example`, & `README.md`

**Files:**
- Create: `apps-script/MoneyTracker.gs`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write `apps-script/MoneyTracker.gs` covering `get_context`, `get_summary`, `list_expenses`, `add_expenses`, `update_expense`, `delete_expense`, `upsert_income` with `SHEET_API_SECRET` validation**
- [ ] **Step 2: Update `.env.example` and `README.md` with setup steps and new commands**
- [ ] **Step 3: Run full `npm test` and syntax/import verification across all `src/` modules**
