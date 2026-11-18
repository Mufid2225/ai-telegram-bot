# Google Calendar Integration Implementation Plan

> **For agentic workers:** Using inline TDD execution (`test-driven-development` + `verification-before-completion`). Steps use checkbox (`- [ ]`) syntax for tracking. Do NOT run `git commit` or `git push` without explicit user approval.

**Goal:** Connect Nerissa Bot to Google Calendar via the existing Google Apps Script bridge (`apps-script/MoneyTracker.gs` + `CalendarApp`), exposing live agenda views in `/menu`, natural chat queries, and strictly gated `[✅ Simpan] [❌ Batal]` confirmation drafts for event creation, rescheduling/editing, and deletion.

**Architecture:** Extend `apps-script/MoneyTracker.gs` with `authorizeCalendar()` and 5 `calendar_*` actions, share the Apps Script HTTP transport between `src/services/sheets.js` and `src/services/calendar.js`, add strict validated proposal tools in `src/tools/calendar.js` (including timezone-offset checks, conflict warnings, candidate disambiguation, and `expectedTitle` concurrency checks), and wire `/menu` + `actions.js`.

**Tech Stack:** Google Apps Script (`CalendarApp`), Node.js 22+ ESM, Telegraf, `better-sqlite3`, `dayjs`, `node:test`.

## Global Constraints

- Public repo (`Mufid2225/ai-telegram-bot`): NEVER put personal email addresses, real calendar/event IDs, tokens, or local personal paths into code, tests, or docs. Use `"primary"` as the default calendar alias.
- Read operations (`calendar_list_calendars`, `calendar_list_events`) run directly; ALL mutations (`create`, `update`, `delete`) MUST create `pending_actions` drafts requiring `[✅ Simpan]` click from `ALLOWED_USER_ID`.
- All Telegram messages follow `SOUL.md` plain-text formatting (no `**`, `*`, `#`, or backticks).
- All inline `callback_data` strings MUST stay `<= 64` bytes via `workspaceStore.createCallbackRef`.

---

### Task 1: Apps Script `CalendarApp` Bridge, `calendar.js` Service & Friendly Auth Errors

**Files:**
- Modify: `apps-script/MoneyTracker.gs`
- Modify: `src/services/sheets.js`
- Create: `src/services/calendar.js`
- Modify: `src/utils/errors.js`
- Test: `test/calendar.test.js`, `test/errors.test.js`

- [ ] **Step 1: Write failing tests in `test/calendar.test.js` and `test/errors.test.js`**
- [ ] **Step 2: Run `node --test test/calendar.test.js test/errors.test.js` to verify RED**
- [ ] **Step 3: Implement `apps-script/MoneyTracker.gs` calendar handlers, shared `requestAppsScript` in `src/services/sheets.js`, `src/services/calendar.js`, and Calendar permission hint in `src/utils/errors.js`**
- [ ] **Step 4: Run `node --test test/calendar.test.js test/errors.test.js test/sheets.test.js` to verify GREEN**

---

### Task 2: Strict Calendar AI Tools & Confirmation Executor

**Files:**
- Create: `src/tools/calendar.js`
- Modify: `src/tools.js`
- Modify: `src/handlers/actions.js`
- Test: `test/calendar-tools.test.js`, `test/actions.test.js`

- [ ] **Step 1: Write failing tests in `test/calendar-tools.test.js` and `test/actions.test.js` covering offset validation, conflict warning detection, multi-event disambiguation, `expectedTitle` guard, and confirmed execution**
- [ ] **Step 2: Run `node --test test/calendar-tools.test.js test/actions.test.js` to verify RED**
- [ ] **Step 3: Implement `src/tools/calendar.js`, merge into `src/tools.js`, and extend `src/handlers/actions.js`**
- [ ] **Step 4: Run `node --test test/calendar-tools.test.js test/actions.test.js test/tools.test.js` to verify GREEN**

---

### Task 3: `/menu` Calendar Explorer, Runtime Wiring & Docs

**Files:**
- Modify: `src/handlers/workspace-menu.js`
- Modify: `src/handlers/menu.js`
- Modify: `src/handlers/messages.js`
- Modify: `src/handlers/files.js`
- Modify: `src/index.js`
- Modify: `SOUL.md`, `AGENTS.md`, `README.md`
- Test: `test/workspace-menu.test.js`, `test/handlers-menu.test.js`

- [ ] **Step 1: Write failing tests in `test/workspace-menu.test.js` and `test/handlers-menu.test.js`**
- [ ] **Step 2: Run `node --test test/workspace-menu.test.js test/handlers-menu.test.js` to verify RED**
- [ ] **Step 3: Implement menu views, wire `calendarService` across handlers & `src/index.js`, and update `SOUL.md`, `AGENTS.md`, `README.md`**
- [ ] **Step 4: Run full `npm test`, `node --check` across all `.js` files, and `gitleaks` scan**
