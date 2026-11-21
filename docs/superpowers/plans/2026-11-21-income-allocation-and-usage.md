# Income Overview, Allocation `%` Editor & Read-Only `Usage` Implementation Plan

> **For agentic workers:** Using inline TDD execution (`test-driven-development` + `verification-before-completion`). Steps use checkbox (`- [ ]`) syntax for tracking. Do NOT run `git commit` or `git push` without explicit user approval.

**Goal:** Add `get_income_overview`, `update_allocations` (Column B `%` only, protecting monthly formula cells and normalizing Google Sheets `%` decimal formatting), and read-only `get_usage` to `apps-script/MoneyTracker.gs`, `src/services/sheets.js`, `src/services/money.js`, `src/utils/telegram.js`, and `src/tools/money-extra.js`.

**Architecture:** Extend `apps-script/MoneyTracker.gs` with 3 new actions (`get_income_overview`, `update_allocations`, `get_usage`) reusing `readIncomeSheetData(ss)`. Add client methods in `src/services/sheets.js`, formatters & `executeConfirmedAction` support in `src/services/money.js` + `src/utils/telegram.js`, and 3 focused AI tools in `src/tools/money-extra.js` merged into `src/tools.js` and `MONEY_TOOL_NAMES` in `src/handlers/money.js`.

**Tech Stack:** Google Apps Script (`SpreadsheetApp`), Node.js 22+ ESM, Telegraf, `better-sqlite3`, `node:test`.

## Global Constraints

- Public repo (`Mufid2225/ai-telegram-bot`): NEVER put real spreadsheet URLs, secrets, or personal data in code, tests, or docs.
- Read-Only Protection: `Usage`, `Dashboard`, and `Database` tabs are strictly read-only; `update_allocations` MUST only modify Column B (`%`) on `Income` and refuse to overwrite formula cells.
- Strict Mutation Gate: `money_propose_update_allocations` MUST create a SQLite `pending_actions` draft (`money:(confirm|cancel):<id>`) requiring `ALLOWED_USER_ID` confirmation.
- Verification before completion: Full `npm test` and `node --check` on all `.js` files must pass after the final edit.

---

### Task 1: Apps Script (`get_income_overview`, `update_allocations`, `get_usage`) & `sheetsService`

**Files:**
- Modify: `apps-script/MoneyTracker.gs`
- Modify: `src/services/sheets.js`
- Test: `test/sheets.test.js`

**Interfaces:**
- Produces on `createSheetsService(config, fetchImpl)`:
  - `getIncomeOverview(params = {})` → `{ month, year, incomeSources, totalIncome, allocations, totalPercent }`
  - `updateAllocations(payload)` → `{ updated, totalPercent }`
  - `getUsage(params = {})` → `{ sheetName, rows, truncatedRows, truncatedCols }`

- [ ] **Step 1: Add failing test to `test/sheets.test.js`**
- [ ] **Step 2: Run `node --test test/sheets.test.js` (verify RED)**
- [ ] **Step 3: Implement `getIncomeOverview`, `updateAllocations`, `getUsage` in `src/services/sheets.js` and `apps-script/MoneyTracker.gs`**
- [ ] **Step 4: Run `node --test test/sheets.test.js` (verify GREEN)**

---

### Task 2: Money Formatters, Routing & `executeConfirmedAction`

**Files:**
- Modify: `src/utils/telegram.js` (`MONEY_PENDING_KINDS`)
- Modify: `src/services/money.js` (`formatIncomeOverviewText`, `formatUsageText`, `formatDraftPreview`, `executeConfirmedAction`)
- Test: `test/telegram.test.js`, `test/money.test.js`

**Interfaces:**
- Produces in `src/services/money.js`:
  - `formatIncomeOverviewText(overview)`
  - `formatUsageText(usage)`
  - `formatDraftPreview("update_allocations", payload)` (shows `old% → new%`, new total %, and warning when `|total - 100| > 0.01`)
  - `executeConfirmedAction({ kind: "update_allocations", payload }, sheetsService)`

- [ ] **Step 1: Add failing tests in `test/telegram.test.js` and `test/money.test.js`**
- [ ] **Step 2: Run `node --test test/telegram.test.js test/money.test.js` (verify RED)**
- [ ] **Step 3: Implement `src/utils/telegram.js` and `src/services/money.js` updates**
- [ ] **Step 4: Run `node --test test/telegram.test.js test/money.test.js` (verify GREEN)**

---

### Task 3: `src/tools/money-extra.js`, Handler Wiring, Prompts, Docs & Verification

**Files:**
- Create: `src/tools/money-extra.js`
- Modify: `src/tools.js`
- Modify: `src/handlers/money.js` (`MONEY_TOOL_NAMES`)
- Modify: `src/handlers/messages.js`, `SOUL.md`, `AGENTS.md`, `README.md`
- Test: `test/tools.test.js`

**Interfaces:**
- Produces in `src/tools/money-extra.js`:
  - `moneyExtraTools`: `money_get_income_overview`, `money_propose_update_allocations`, `money_get_usage`
  - `executeMoneyExtraTool(name, args, context)` → `string | null`

- [ ] **Step 1: Add failing test in `test/tools.test.js`**
- [ ] **Step 2: Run `node --test test/tools.test.js` (verify RED)**
- [ ] **Step 3: Implement `src/tools/money-extra.js`, wire into `src/tools.js` & `src/handlers/money.js`, update prompts & docs (`src/handlers/messages.js`, `SOUL.md`, `AGENTS.md`, `README.md`)**
- [ ] **Step 4: Run full `npm test` and `node --check` on all `.js` files (verify GREEN)**
