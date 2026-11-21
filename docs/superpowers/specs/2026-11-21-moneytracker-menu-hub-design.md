# MoneyTracker Hub Menu (`/menu -> 💰 MoneyTracker`) Design Spec

**Date:** 2026-11-21  
**Project:** `ai-telegram-bot` (Nerissa Bot)

---

## 1. Goals

1. Simplify `/menu` (`homeKeyboard()`) by consolidating the top finance buttons into a single **`💰 MoneyTracker`** entry (`menu:money`).
2. Provide an instant in-place **`MoneyTracker` Hub** (`moneyHubView`) allowing the owner to switch cleanly across all MoneyTracker sheets without leaving `/menu`:
   - `📊 Ringkasan (Dashboard)` (`menu:summary`)
   - `🧾 Expenses` (`menu:expenses:0`)
   - `💵 Income & Alokasi` (`menu:income`)
   - `🎯 Targets Tabungan` (`menu:targets`)
   - `📒 Riwayat Setoran` (`menu:targetlogs`)
   - `📋 Usage (Read-Only)` (`menu:usage`)
   - `💰 Cek Sisa Bulan Lalu` (`menu:surplus`)
3. Preserve all existing callback contracts (`menu:summary`, `menu:expenses:<offset>`, `menu:chart`, `menu:home`) and plain-text `SOUL.md` formatting while keeping `src/handlers/menu.js` modular by extracting MoneyTracker menu views into `src/handlers/money-menu.js`.

## 2. Non-Goals

- No new Apps Script endpoints (`MoneyTracker.gs` from Parts 1 & 2 already serves all required read actions).
- No interactive text-input wizard in `/menu` for writing rows; mutations continue via natural chat, `/catat`, and `/target` with strict `[✅ Simpan] [❌ Batal]` confirmation.

---

## 3. Architecture & UI Navigation

```text
/menu (Home)
   └── [💰 MoneyTracker] (menu:money — instant edit, no loading bar)
          ├── [📊 Ringkasan] (menu:summary) ──► [🔄 Refresh] [📈 Grafik PNG] [« MoneyTracker] [« Menu Utama]
          ├── [🧾 Expenses] (menu:expenses:0) ──► pagination + [« MoneyTracker] [« Menu Utama]
          ├── [💵 Income & Alokasi] (menu:income) ──► [🔄 Refresh] [« MoneyTracker] [« Menu Utama]
          ├── [🎯 Targets] (menu:targets) ──► [📒 Riwayat Setoran] [💰 Sisa Bulan Lalu] [« MoneyTracker] [« Menu Utama]
          ├── [📒 Riwayat Setoran] (menu:targetlogs) ──► [🎯 Targets] [🔄 Refresh] [« MoneyTracker] [« Menu Utama]
          ├── [📋 Usage] (menu:usage) ──► [🔄 Refresh] [« MoneyTracker] [« Menu Utama]
          └── [💰 Sisa Bulan Lalu] (menu:surplus) ──► [🎯 Targets] [🔄 Refresh] [« MoneyTracker] [« Menu Utama]
```

## 4. Module Design

- **`src/handlers/money-menu.js`:**
  - `moneyHubView()` — instant hub message with sheet picker buttons and quick chat command hints.
  - `summaryView(sheetsService)` — moved from `menu.js` + `« MoneyTracker` button alongside `« Menu Utama`.
  - `expensesView(sheetsService, offsetRaw)` — moved from `menu.js` + `« MoneyTracker` button alongside `« Menu Utama`.
  - `incomeView(sheetsService)` — calls `sheetsService.getIncomeOverview({})` and renders `formatIncomeOverviewText(overview)`.
  - `targetsView(sheetsService)` — calls `sheetsService.listTargets()` and renders `formatTargetsList(res?.targets || [])`.
  - `targetLogsView(sheetsService)` — calls `sheetsService.listTargetLogs({ limit: 15 })` and renders `formatTargetLogsList(res?.logs || [])`.
  - `usageView(sheetsService)` — calls `sheetsService.getUsage({ maxRows: 45, maxCols: 12 })` and renders `formatUsageText(usage)`.
  - `surplusView(sheetsService)` — calls `calculateMonthlySurplus` for `getPreviousMonthPeriod()` + `sheetsService.listTargets({ status: "Aktif" })` and renders `formatSurplusSummary(surplus, activeTargets)`.
  - `resolveMoneyMenuTask(action, sheetsService)` — maps `summary`, `expenses:*`, `income`, `targets`, `targetlogs`, `usage`, `surplus` (returns `null` if not a MoneyTracker view).
- **`src/handlers/menu.js`:**
  - `homeKeyboard()` replaces the 2 top finance buttons with `[{ text: "💰 MoneyTracker", callback_data: "menu:money" }]`.
  - `handleMenuCallback` handles `action === "money"` immediately via `safeEdit(ctx, moneyHubView())` and delegates MoneyTracker async sheet views through `runWithProgress` using `resolveMoneyMenuTask`.
  - Update `helpView()` to mention `/target` and the `💰 MoneyTracker` menu hub.

## 5. Verification Plan

- Extend `test/handlers-menu.test.js` to verify:
  - `homeKeyboard` includes `menu:money`.
  - `action: "money"` renders the MoneyTracker hub with buttons for `summary`, `expenses:0`, `income`, `targets`, `targetlogs`, `usage`, `surplus`, and `home`.
  - Each new MoneyTracker sheet action (`income`, `targets`, `targetlogs`, `usage`, `surplus`) renders live mocked data with `menu:money` and `menu:home` navigation buttons.
  - Existing `summary`, `expenses:8`, `notes`, `reminders`, `close`, and `ws:trello` tests remain green.
- Run full `npm test` and `node --check`.
