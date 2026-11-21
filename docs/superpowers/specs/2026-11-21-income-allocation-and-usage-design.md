# Income Overview, Allocation `%` Editor & Read-Only `Usage` Design Spec

**Date:** 2026-11-21  
**Project:** `ai-telegram-bot` (Nerissa Bot)

---

## 1. Goals

1. Expose a complete read-only view of the **`Income`** sheet (both the top **Income** sources table and the bottom **Alokasi** `%` table) via `money_get_income_overview`, so the user and AI always inspect current sources and percentages before proposing changes.
2. Allow editing **Column B (`%`)** of one or multiple categories in the **`Alokasi`** table (`money_propose_update_allocations`) using flexible total-percentage validation:
   - Never overwrite formula cells in monthly columns (`Jan–Des`) or formula rows.
   - Handle Google Sheets percentage formatting (`0.25` displayed as `25%` vs plain `25`) accurately so writing `25%` never becomes `2500%`.
   - Allow batch updates whose total `%` is not `100%`, surfacing a clear `⚠️ Total alokasi menjadi X% (belum 100%)` warning inside the draft preview.
3. Expose a **read-only** dynamic reader for the **`Usage`** sheet (`money_get_usage`) since `Usage` derives its values from `Expenses`/`Income` formulas and must never be manually edited via the bot.
4. Keep strict mutation safety: all `Alokasi` edits pass through SQLite `pending_actions` (`money:(confirm|cancel):<id>`) and `ALLOWED_USER_ID` verification.

## 2. Non-Goals

- **No writes to `Usage`, `Dashboard`, or `Database` tabs** (strictly read-only to protect formulas and dropdown data validation).
- **No direct edits to monthly Rupiah cells in `Alokasi`** (those cells are formula-driven from Column B `%` and monthly `Income`).
- **Deferred to Part 3:** Unified `/menu -> 💰 MoneyTracker` multi-sheet navigation hub.

---

## 3. Sheet Access Matrix (`MoneyTracker`)

| Tab | Access Mode | Reason |
| --- | --- | --- |
| `Dashboard` | Read-Only | Formula-driven KPIs (`money_get_summary` / `/keuangan`) |
| `Usage` | Read-Only | Formula-driven from `Expenses` & `Income` (`money_get_usage`) |
| `Database` | Read-Only | Master `Bank` & `Kategori` validation lists (`money_get_options`) |
| `Expenses` | Read + Write | Transaction rows (`list`, `add`, `update`, `delete`) |
| `Income` | Read + Scoped Write | Top `Income` nominal cells (`upsert_income`) + Bottom `Alokasi` Column B `%` (`update_allocations`) |
| `Targets` & `TargetLogs` | Read + Write | Standalone savings targets & deposit logs |

---

## 4. Google Apps Script Additions ([apps-script/MoneyTracker.gs](file:///c:/Project/ai-telegram-bot/apps-script/MoneyTracker.gs))

Add 3 `doPost` actions under `SHEET_API_SECRET` authentication:

1. **`get_income_overview`** (`{ month?, year? }`):
   - Uses `readIncomeSheetData(ss)` and `getDashboardPeriod(ss)` (defaults `month` to active dashboard period or current month).
   - Returns:
     - `month`, `year`
     - `incomeSources`: `[{ rowNumber, source, amount }]` and `totalIncome`
     - `allocations`: `[{ rowNumber, kategori, percent, isPercentFormatted, monthlyAmount }]` where `percent` is normalized to human `0..100` scale (checking whether display value ends with `%` or cell number format contains `%`, converting `0.25` → `25`), and `totalPercent`
2. **`update_allocations`** (`{ updates: [{ kategori, percent, expectedPercent? }] }`):
   - Validates `updates` is non-empty and each `percent` is finite with `0 <= percent <= 100`.
   - Reads `allocHeaderRow .. allocTotalRow` from `Income` tab via `readIncomeSheetData(ss)`.
   - For each update:
     - Matches `kategori` case-insensitively in Column A.
     - Refuses if Column B (`getRange(row, 2).getFormula()`) contains a formula.
     - Checks `expectedPercent` (tolerance `0.01`) if provided so stale drafts do not overwrite manual edits.
   - Writes each cell in Column B: if the cell number format contains `%` (or display ended with `%`), writes `percent / 100`; otherwise writes `percent`.
   - Calls `SpreadsheetApp.flush()` and returns `{ updated: [...], totalPercent }` from the refreshed `Alokasi` table.
3. **`get_usage`** (`{ maxRows = 50, maxCols = 12 }`):
   - Reads `ss.getSheetByName("Usage")` (`getDisplayValues()` capped at `min(lastRow, maxRows)` × `min(lastCol, maxCols)`).
   - Trims completely empty rows and trailing empty columns.
   - Returns `{ sheetName: "Usage", rows: string[][], truncatedRows: boolean, truncatedCols: boolean }`.

---

## 5. Bot Module Design

### 5.1 Transport & Formatting (`src/services/sheets.js`, `src/services/money.js`, `src/utils/telegram.js`)
- Extend `createSheetsService`:
  - `getIncomeOverview(params = {})` → `request("get_income_overview", params)`
  - `updateAllocations(payload)` → `request("update_allocations", payload)`
  - `getUsage(params = {})` → `request("get_usage", params)`
- Add `"update_allocations"` to `MONEY_PENDING_KINDS` in `src/utils/telegram.js`.
- Extend `src/services/money.js`:
  - `formatIncomeOverviewText(overview)` — plain-text summary of Income sources for the month + all `Alokasi` rows (`Kategori: XX%`) + `Total Alokasi: YY%`.
  - `formatUsageText(usage)` — clean row-by-row plain-text table from `Usage` tab (with truncation notice if needed).
  - `formatDraftPreview("update_allocations", payload)` — lists `Kategori: old% → new%`, `Total Alokasi Baru: XX%`, and appends `⚠️ Total alokasi menjadi XX% (belum 100%).` whenever `Math.abs(newTotalPercent - 100) > 0.01`.
  - `executeConfirmedAction("update_allocations", sheetsService)` — calls `sheetsService.updateAllocations(payload)` and formats confirmation message with updated `totalPercent`.

### 5.2 AI Tools (`src/tools/money-extra.js` merged into `src/tools.js`)
Keep `src/tools.js` lean by placing the 3 new tools in `src/tools/money-extra.js` (and adding their names to `MONEY_TOOL_NAMES` in `src/handlers/money.js`):
1. **`money_get_income_overview({ month?, year? })`** (Read-Only)
2. **`money_propose_update_allocations({ updates: [{ kategori, percent }] })`** (Draft Proposal):
   - Validates `updates` array (`>= 1` entry, `0 <= percent <= 100`, no duplicate categories in the same call).
   - Fetches `sheetsService.getIncomeOverview()` to resolve canonical category names, capture `oldPercent` / `expectedPercent`, verify all requested categories exist in the `Alokasi` table, and compute exact `newTotalPercent`.
   - Creates `pending_actions` draft (`kind: "update_allocations"`) without writing to Sheets.
3. **`money_get_usage()`** (Read-Only)

### 5.3 Prompt & Chat Behavior (`src/handlers/messages.js`, `src/handlers/money.js`, `SOUL.md`, `AGENTS.md`, `README.md`)
- Instruct AI:
  - When user reports extra/new income (e.g., *"dapat uang 400 ribu hasil jual voucher bing"*), call `money_get_options` (or `money_get_income_overview`) and create a draft with `money_propose_upsert_income` (`mode: "add"` if adding to an existing/new stream, or `"set"` if replacing).
  - When user asks about or wants to change budget allocation percentages, call `money_get_income_overview` first, then `money_propose_update_allocations`.
  - When user asks about `Usage`, call `money_get_usage` and clearly refuse any request to edit `Usage`, `Dashboard`, or `Database` because they are formula/validation-driven read-only tabs.

---

## 6. Verification Plan

1. Unit tests (`node --test`):
   - `test/sheets.test.js`: verify `getIncomeOverview`, `updateAllocations`, and `getUsage` POST payloads.
   - `test/money.test.js` & `test/telegram.test.js`: verify `MONEY_PENDING_KINDS` includes `update_allocations`, `formatIncomeOverviewText`, `formatUsageText`, `formatDraftPreview("update_allocations", ...)` with ≠ 100% warning, and `executeConfirmedAction`.
   - `test/tools.test.js`: verify `money_get_income_overview`, `money_get_usage`, and `money_propose_update_allocations` (invalid %, missing category, duplicate category in patch, batch update + ≠ 100% warning + no direct mutation).
2. Full `npm test` and `node --check` across all `.js` files.
