# MoneyTracker Hub Menu Implementation Plan

> **For agentic workers:** Using inline TDD execution (`test-driven-development` + `verification-before-completion`). Steps use checkbox (`- [ ]`) syntax for tracking. Do NOT run `git commit` or `git push` without explicit user approval.

**Goal:** Consolidate `/menu`'s finance entry into a single `💰 MoneyTracker` hub (`menu:money`) that navigates across all MoneyTracker sheets (`Dashboard`, `Expenses`, `Income & Alokasi`, `Targets`, `TargetLogs`, `Usage`, and `Sisa Bulan Lalu`), keeping `src/handlers/menu.js` clean by extracting `src/handlers/money-menu.js`.

**Architecture:** Extract MoneyTracker menu views into `src/handlers/money-menu.js`, update `homeKeyboard()`, `helpView()`, and `handleMenuCallback()` in `src/handlers/menu.js`, update `README.md` & `AGENTS.md`, and verify with offline `node --test` and `node --check`.

**Tech Stack:** Node.js 22+ ESM, Telegraf inline keyboards, `node:test`.

## Global Constraints

- Preserve all existing callback routes (`menu:summary`, `menu:expenses:<offset>`, `menu:chart`, `menu:home`, `menu:close`).
- Every `callback_data` string stays `<= 64` bytes.
- Plain-text formatting per `SOUL.md` (no `**`, `*`, `#`, or backticks in Telegram view text) and truncate cleanly to `<= 4000` characters.
- Do NOT run `git commit` or `git push` without explicit user approval.

---

### Task 1: `src/handlers/money-menu.js` + `src/handlers/menu.js` Hub Integration & Docs

**Files:**
- Create: `src/handlers/money-menu.js`
- Modify: `src/handlers/menu.js`
- Modify: `AGENTS.md`, `README.md`
- Test: `test/handlers-menu.test.js`

- [ ] **Step 1: Add failing tests in `test/handlers-menu.test.js`**
- [ ] **Step 2: Run `node --test test/handlers-menu.test.js` (verify RED)**
- [ ] **Step 3: Create `src/handlers/money-menu.js` and update `src/handlers/menu.js`, `AGENTS.md`, `README.md`**
- [ ] **Step 4: Run full `npm test` and `node --check` on all `.js` files (verify GREEN)**
