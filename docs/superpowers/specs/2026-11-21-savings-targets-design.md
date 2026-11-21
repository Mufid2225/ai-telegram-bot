# Savings Targets (`Targets` + `TargetLogs` + Previous-Month Surplus) Design Spec

**Date:** 2026-11-21  
**Project:** `ai-telegram-bot` (Nerissa Bot)

---

## 1. Goals

1. Add a **Savings Target (Target Tabungan)** system stored directly inside the owner's `MoneyTracker` Google Spreadsheet as two standalone tabs — **`Targets`** and **`TargetLogs`** — without interfering with formulas or data on existing sheets (`Dashboard`, `Expenses`, `Income`, `Usage`, `Database`).
2. Match the visual theme of existing `MoneyTracker` sheets automatically when creating `Targets` and `TargetLogs` by sampling header styling (green fill, font color, font family/weight, alignment) from existing tabs (e.g., `Expenses` / `Income`), plus Rupiah currency formatting (`"Rp "#,##0`), frozen headers, borders, and `Status` dropdown validation.
3. Keep **`Targets.Terkumpul` always synchronized** via Google Sheets `=SUMIF(...)` formulas pointing to `TargetLogs`, so manual edits in Google Sheets stay accurate without bot intervention.
4. Support **on-demand checking & allocation of previous month's remaining balance ("sisa uang bulan kemarin")**:
   - Compute exact unallocated surplus (`saldo` from `get_summary` minus any existing deposits in `TargetLogs` tagged with that `Sumber Periode` `YYYY-MM`) to prevent double-allocation.
   - Allow allocating all or part of that surplus across one or more active targets with clear notes (e.g. `"Sisa uang bulan Oktober"`).
5. Preserve **strict mutation safety**:
   - All reads (`/target`, `money_list_targets`, `money_list_target_logs`, `money_check_surplus`) run immediately.
   - All writes (`create_target`, `add_target_deposit`, `update_target`, `delete_target_log`) MUST create a SQLite `pending_actions` draft and require `✅ Simpan` / `❌ Batal` confirmation from `ALLOWED_USER_ID`.

## 2. Non-Goals

- **No local SQLite mirror** of target rows or deposit logs (`MoneyTracker` Google Sheets remains the single source of truth).
- **No automated scheduled monthly push notifications** at this phase (surplus check is strictly on-demand via chat or `/target`).
- **Deferred to subsequent specs:**
  - Editing the `Alokasi` table on `Income` & reading/writing `Usage` or other tabs (Part 2).
  - Unified `/menu -> 💰 MoneyTracker` multi-sheet explorer hub (Part 3).

---

## 3. Architecture & Data Flow

```text
Telegram User (/target OR Natural Chat)
   │
   ├── Read / Progress / Surplus Check
   │      ├─► /target ──► sheetsService.listTargets() ──► progress bar summary
   │      ├─► money_list_targets / money_list_target_logs ──► Apps Script
   │      └─► money_check_surplus(month?, year?)
   │             ├─► sheetsService.getSummary({ month, year })  ──► saldo
   │             ├─► sheetsService.listTargetLogs({ sourcePeriod }) ──► allocated
   │             └─► availableSurplus = max(0, saldo - allocated)
   │
   └── Write / Deposit / Update / Delete Log Intent
          ├─► Validate amount > 0, resolve unique target, attach expected state
          └─► Save draft in SQLite `pending_actions` + send [✅ Simpan] [❌ Batal]
                 │
                 └── User clicks ✅ Simpan (ALLOWED_USER_ID)
                        └─► Atomic claim ─► executeConfirmedAction ──► Apps Script
```

---

## 4. Google Sheets Schema & Visual Design (`MoneyTracker`)

Both tabs are auto-created and formatted by `ensureTargetSheets(ss)` in `apps-script/MoneyTracker.gs` if missing (existing tabs are left untouched).

### 4.1 Visual Synchronization Helper
- `getReferenceHeaderStyle(ss)` checks `Expenses` cell `A1` (falling back to `Income` `A1`, or default theme `#1E7E34` white bold if neither exists) to copy:
  - Header background color (green theme)
  - Header font color, font family, font size, bold weight
- Both `Targets` and `TargetLogs` apply:
  - Frozen row 1 (`setFrozenRows(1)`)
  - Thin light-gray borders around data ranges
  - Alternating subtle row shading or clean white/light-green tint consistent with sheet style
  - Indonesian Rupiah format (`"Rp "#,##0`) on currency columns and `0.0%` on `Progress`
  - Auto-resized column widths with sensible minimums so text is readable in Sheets

### 4.2 Tab `Targets`
Columns (`A:I`):
| Col | Header | Type / Formula | Notes |
| --- | --- | --- | --- |
| `A` | `ID` | Text (`TGT-001`, ...) | Auto-incremented by Apps Script |
| `B` | `Nama Target` | Text | Unique across non-archived targets |
| `C` | `Nominal Target` | Currency (`"Rp "#,##0`) | Positive integer IDR |
| `D` | `Terkumpul` | Formula | `=SUMIF(TargetLogs!$C:$C, A2, TargetLogs!$E:$E)` |
| `E` | `Kurang` | Formula | `=MAX(0, C2-D2)` |
| `F` | `Progress` | Formula | `=IF(C2>0, D2/C2, 0)` formatted as `0.0%` |
| `G` | `Status` | Dropdown | `Aktif`, `Tercapai`, `Ditunda`, `Arsip` |
| `H` | `Catatan` | Text | Optional notes / link / wishlist detail |
| `I` | `Dibuat` | Date (`YYYY-MM-DD`) | Creation date |

### 4.3 Tab `TargetLogs`
Columns (`A:G`):
| Col | Header | Type | Notes |
| --- | --- | --- | --- |
| `A` | `Log ID` | Text (`LOG-001`, ...) | Auto-incremented by Apps Script |
| `B` | `Tanggal` | Date (`YYYY-MM-DD`) | Deposit date |
| `C` | `Target ID` | Text (`TGT-001`) | Foreign key matched by `Targets!D` `SUMIF` |
| `D` | `Nama Target` | Text | Denormalized readable name for easy scanning in Sheets |
| `E` | `Nominal` | Currency (`"Rp "#,##0`) | Positive integer IDR |
| `F` | `Keterangan` | Text | Deposit note (e.g., `"Sisa uang bulan Oktober"`, `"Bonus lembur"`) |
| `G` | `Sumber Periode` | Text (`YYYY-MM` or blank) | Optional tag used to prevent double-allocating monthly surplus |

---

## 5. Google Apps Script Additions ([apps-script/MoneyTracker.gs](file:///c:/Project/ai-telegram-bot/apps-script/MoneyTracker.gs))

Add 6 new `doPost` actions under the existing `SHEET_API_SECRET` check:

1. **`targets_list`** (`{ status?, includeArchived? = false }`):
   - Calls `ensureTargetSheets(ss)` and reads rows from `Targets`.
   - Excludes `Arsip` unless `includeArchived: true` or `status === "Arsip"`.
   - Returns `{ targets: [{ rowNumber, id, name, targetAmount, collectedAmount, remainingAmount, progressPercent, status, note, createdAt }] }`.
2. **`targets_logs`** (`{ targetId?, sourcePeriod?, limit = 20 }`):
   - Calls `ensureTargetSheets(ss)` and reads rows from `TargetLogs`.
   - Filters by `targetId` and/or `sourcePeriod` (`YYYY-MM`), sorts newest-first (by `Tanggal` / row order), caps at `limit` (default `20`, max `100`), and also returns `totalMatchedAmount` across all matching rows before `limit` truncation (so surplus calculations are exact even if there are many logs).
   - Returns `{ logs: [{ rowNumber, logId, date, targetId, targetName, amount, note, sourcePeriod }], totalMatchedAmount }`.
3. **`targets_create`** (`{ name, targetAmount, note = "", status = "Aktif", date? }`):
   - Rejects empty name, `targetAmount <= 0`, or duplicate active/paused target name (case-insensitive).
   - Generates next `TGT-XXX` ID, appends row, inserts `SUMIF` / `MAX` / `IF` formulas in `D:F`, sets `Status` dropdown validation, returns the created target object.
4. **`targets_add_deposit`** (`{ targetId, amount, date?, note = "", sourcePeriod = "" }`):
   - Verifies target exists in `Targets` and is not `Arsip`.
   - Rejects `amount <= 0`.
   - Generates next `LOG-XXX` ID and appends to `TargetLogs`.
   - Calls `SpreadsheetApp.flush()`, reads back the updated `Terkumpul` cell on `Targets`: if `collectedAmount >= targetAmount` and current status is `"Aktif"`, automatically updates `Status` to `"Tercapai"`.
   - Returns `{ log, target }` with updated totals.
5. **`targets_update`** (`{ targetId, expected?, patch: { name?, targetAmount?, status?, note? } }`):
   - Finds row by `targetId`, verifies `expected.name` / `expected.targetAmount` / `expected.status` if supplied.
   - Validates `targetAmount > 0` and `status` in `["Aktif", "Tercapai", "Ditunda", "Arsip"]`.
   - If `name` changes, updates `Nama Target` in `Targets` (and optionally updates future logs; existing `TargetLogs` rows retain `Target ID` link so `SUMIF` stays intact).
   - Returns updated target object.
6. **`targets_delete_log`** (`{ logId, rowNumber?, expected? }`):
   - Finds log row by `logId` (verifying `rowNumber` if given, plus `expected.amount` / `expected.targetId` if given).
   - Deletes the log row (`sheet.deleteRow(rowNum)`) so `SUMIF` on `Targets` recalculates immediately.
   - If the linked target had status `"Tercapai"` and `collectedAmount < targetAmount` after deletion, sets status back to `"Aktif"`.
   - Returns `{ deleted: true, logId, target }`.

---

## 6. Bot Module Design

### 6.1 Transport & Formatting (`src/services/sheets.js` & `src/services/money.js`)
- Extend `createSheetsService` in `src/services/sheets.js`:
  - `listTargets(filters)`
  - `listTargetLogs(filters)`
  - `createTarget(payload)`
  - `addTargetDeposit(payload)`
  - `updateTarget(payload)`
  - `deleteTargetLog(payload)`
- Extend `src/services/money.js`:
  - `TARGET_STATUSES = ["Aktif", "Tercapai", "Ditunda", "Arsip"]`
  - `getPreviousMonthPeriod(now = new Date())` → `{ month, year, sourcePeriod: "YYYY-MM" }` (e.g., for `2026-11-21` → `{ month: "Oktober", year: 2026, sourcePeriod: "2026-10" }`; handles January → December of `year - 1`).
  - `toSourcePeriod(monthName, year)` → `"YYYY-MM"` helper using `MONTHS_ID`.
  - `calculateMonthlySurplus({ sheetsService, month, year })`:
    - Calls `sheetsService.getSummary({ month, year })` and `sheetsService.listTargetLogs({ sourcePeriod, limit: 100 })`.
    - Computes `saldo`, `allocatedAmount = logsRes.totalMatchedAmount`, `availableSurplus = Math.max(0, saldo - allocatedAmount)`.
  - `renderProgressBar(percent, width = 10)` → `[██████░░░░]`.
  - `formatTargetsList(targets)` & `formatTargetLogsList(logs, label)` & `formatSurplusSummary(surplus, activeTargets)`.
  - Extend `formatDraftPreview(kind, payload)` and `executeConfirmedAction(action, sheetsService)` for:
    - `"create_target"`
    - `"add_target_deposit"`
    - `"update_target"`
    - `"delete_target_log"`

### 6.2 AI Tools (`src/tools.js`)
Add 7 tools:
- **Read tools:**
  1. `money_list_targets({ status?, includeArchived? })`
  2. `money_list_target_logs({ targetId?, sourcePeriod?, limit? })`
  3. `money_check_surplus({ month?, year? })` — defaults to previous month via `getPreviousMonthPeriod()` when omitted, returns exact surplus calculation + active targets list so the AI never guesses math.
- **Proposal tools (all create `pending_actions` with `money:(confirm|cancel):<id>` buttons):**
  4. `money_propose_create_target({ name, targetAmount, note?, status? })`
  5. `money_propose_add_target_deposit({ targetId?, targetName?, amount, date?, note?, sourcePeriod? })`
     - Resolves target via `listTargets({ includeArchived: false })`:
       - Exact ID or case-insensitive name match, or unique partial match.
       - Rejects if `0` matches or `> 1` ambiguous matches (returns candidate list so AI asks user to pick).
       - If `sourcePeriod` is provided (e.g. allocating previous month's surplus), checks `calculateMonthlySurplus` and attaches a clear warning in the draft summary if `amount > availableSurplus`.
  6. `money_propose_update_target({ targetId?, targetName?, patch: { name?, targetAmount?, status?, note? } })`
     - Resolves unique target (allowing archived targets if searching explicitly), captures `expected` snapshot `{ name, targetAmount, status }` before creating draft.
  7. `money_propose_delete_target_log({ logId, expected? })`
     - Looks up log via `listTargetLogs({ limit: 100 })` to attach exact `rowNumber` and `expected` (`{ targetId, targetName, amount, date }`) before creating draft.

### 6.3 Handlers, Routing & Prompts (`src/handlers/money.js`, `src/utils/telegram.js`, `src/handlers/menu.js`, `src/handlers/messages.js`, `SOUL.md`)
- **`MONEY_PENDING_KINDS`** in `src/utils/telegram.js`:
  - Add `"create_target"`, `"add_target_deposit"`, `"update_target"`, and `"delete_target_log"` so `buildConfirmExtra` emits `money:(confirm|cancel):<id>` and routes through `handleMoneyCallback` → `executeConfirmedAction`.
- **`MONEY_TOOL_NAMES`** & **`/target` command** in `src/handlers/money.js`:
  - Add the 7 target/surplus tools to `MONEY_TOOL_NAMES`.
  - `/target` (no args): fetches `sheetsService.listTargets()` and replies immediately with formatted targets + Unicode progress bars + quick usage tips.
  - `/target <teks>` (with args, e.g. `/target beli ssd 1.5jt`): delegates to `callAI` using `moneyTools` (same pattern as `/catat`).
- **`BOT_COMMANDS`** in `src/handlers/menu.js`:
  - Register `{ command: "target", description: "Lihat & kelola target tabungan" }`.
- **Prompt rules** (`src/handlers/messages.js`, `src/handlers/money.js`, `SOUL.md`):
  - Instruct the AI to always call `money_list_targets` / `money_check_surplus` before answering target or remaining-balance questions.
  - When user asks about *"sisa uang bulan kemarin"* / *"sisa bulan lalu"*, call `money_check_surplus` (without args → previous month) and present the breakdown + active targets so the user can choose where to allocate it.
  - When allocating previous month's surplus, pass `sourcePeriod` (`YYYY-MM`) and default `note` to `"Sisa uang bulan <Bulan>"`.
  - Never claim a target/deposit is saved before the user clicks `✅ Simpan`.

---

## 7. Error Handling, Guardrails & Privacy

- **Atomic Draft Confirmation:** Uses existing `pendingStore.claimForExecution` and `runPendingConfirmation` (`money:confirm:*` / `money:cancel:*`) with 24h TTL and `ALLOWED_USER_ID` enforcement.
- **Ambiguity & Concurrency Guards:** Multi-match target names require user clarification instead of guessing; updates/deletes verify `expected` state in Apps Script before mutating.
- **Negative/Zero Surplus:** If previous month's `saldo <= 0` or `availableSurplus <= 0`, `money_check_surplus` clearly reports `Rp 0` available (and shows if it was already allocated to targets) instead of suggesting negative numbers.
- **Public Repo Safety:** No real spreadsheet URLs, secrets, personal target names, or personal account data in code, fixtures, or docs.

---

## 8. Verification Plan

1. **Syntax & Unit Tests (`node --test`, `node --check`):**
   - `test/money.test.js`: unit tests for `getPreviousMonthPeriod` (including Jan → Dec rollover), `calculateMonthlySurplus` (with mock `sheetsService`), `renderProgressBar`, `formatDraftPreview`, and `executeConfirmedAction` for all 4 new `kind`s.
   - `test/tools.test.js` (or new `test/targets.test.js`): tests for `money_list_targets`, `money_check_surplus`, `money_propose_create_target`, `money_propose_add_target_deposit` (exact match, ambiguous match rejection, surplus-overdraw warning), `money_propose_update_target`, `money_propose_delete_target_log`, plus `/target` handler test.
2. **Manual Apps Script Redeploy Checklist:**
   - Reminder to user after implementation: paste updated `apps-script/MoneyTracker.gs` and deploy a **New version** in Google Apps Script Web App before testing live in Telegram.
