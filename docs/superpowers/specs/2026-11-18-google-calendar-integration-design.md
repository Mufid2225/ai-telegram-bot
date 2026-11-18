# Google Calendar Integration (Apps Script Bridge) Design Spec

**Date:** 2026-11-18  
**Project:** `ai-telegram-bot` (Nerissa Bot)

---

## 1. Goals

1. Connect Nerissa Bot to the owner's **Google Calendar** by extending the existing Google Apps Script Web App (`apps-script/MoneyTracker.gs`) with `CalendarApp` handlers — requiring **zero** Google Cloud Console / OAuth2 / Service Account setup and **zero** new environment variables beyond the existing `SHEET_WEBHOOK_URL` and `SHEET_API_SECRET`.
2. Support **Opsi A calendar scope**:
   - Default to the owner's **Primary Calendar** (`calendarId = "primary"` → `CalendarApp.getDefaultCalendar()`) for fast natural chat queries and event creation.
   - Expose owned/subscribed sub-calendars (`calendar_list_calendars`) so the user can inspect all owned calendars together or pick a specific sub-calendar from `/menu` or natural chat.
3. Enforce **strict mutation safety**:
   - **Read operations** (`calendar_list_calendars`, `calendar_list_events`) execute freely with no confirmation gate.
   - **All write/edit/delete operations** (`create`, `update`, `delete`) MUST go through SQLite `pending_actions` and inline confirmation buttons `[✅ Simpan]` / `[❌ Batal]` restricted to `ALLOWED_USER_ID`.
   - Validate explicit timezone offsets, reject ambiguous multi-event matches on update/delete, verify `expectedTitle` before mutating/deleting an existing event, block writes to read-only calendars, and surface automatic **schedule conflict warnings** inside the confirmation draft preview before the user clicks `✅ Simpan`.

## 2. Non-Goals

- No local SQLite mirror of Google Calendar events (Google Calendar remains the single source of truth).
- No automatic guest invitation emails sent to external attendees (`sendInvites` stays disabled) so bot drafts cannot accidentally email third parties.
- No separate background polling daemon for calendar push notifications (Google Calendar mobile/desktop apps already handle native event alarms).

---

## 3. Architecture & Data Flow

```text
Telegram User (/menu -> 📅 Google Calendar OR Natural Chat)
   │
   ├── Read / Availability Check
   │      └─► calendar_list_events / calendar_list_calendars
   │             └─► src/services/calendar.js ──► Apps Script (CalendarApp) ──► Google Calendar
   │
   └── Write / Reschedule / Delete Intent
          │
          ├─► Validate ISO timestamps (+offset), check read-only calendar, disambiguate target
          ├─► Check overlapping events in target window (attach ⚠️ Bentrok warning if any)
          └─► Save draft in SQLite `pending_actions` + send [✅ Simpan] [❌ Batal]
                 │
                 └── User clicks ✅ Simpan (ALLOWED_USER_ID)
                        └─► Atomic claim ─► Apps Script executes CalendarApp write (with expectedTitle check)
```

---

## 4. Google Apps Script Additions ([apps-script/MoneyTracker.gs](file:///c:/Project/ai-telegram-bot/apps-script/MoneyTracker.gs))

Add a one-click helper `authorizeCalendar()` (for triggering Google's OAuth consent prompt inside the Apps Script editor) and 5 new `doPost` actions sharing the existing `SHEET_API_SECRET` guard:

1. **`authorizeCalendar()` (Editor Helper):**
   - Calls `CalendarApp.getDefaultCalendar().getName()` and `SpreadsheetApp.getActiveSpreadsheet().getName()` so running it once in the Apps Script editor grants both Sheet and Calendar scopes before redeploying.
2. **`calendar_list_calendars`:**
   - Returns `{ id, name, isPrimary, isOwnedByMe, timeZone }` for `CalendarApp.getAllCalendars()`, using `"primary"` alias support for the primary calendar so raw email IDs never need to be hardcoded.
3. **`calendar_list_events`:**
   - Params: `{ calendarId = "primary", includeAllOwned = false, startIso, endIso, query = "", limit = 25 }`.
   - Enforces valid `startIso` / `endIso` window (`<= 90` days per call) and `limit <= 50`.
   - Reads events from the requested calendar (or across all `isOwnedByMe` calendars when `includeAllOwned: true`), filters case-insensitively by `query` across title/description/location, sorts ascending by `startTime`, and returns `{ id, calendarId, calendarName, title, startIso, endIso, isAllDay, location, description }`.
4. **`calendar_create_event`:**
   - Params: `{ calendarId = "primary", title, startIso, endIso, isAllDay = false, date, endDate, location = "", description = "" }`.
   - Rejects non-owned / read-only calendars (`!cal.isOwnedByMe() && !cal.isMyPrimaryCalendar()`).
   - Creates timed (`cal.createEvent`) or all-day (`cal.createAllDayEvent`) event without sending external invite emails, returning the created event summary.
5. **`calendar_update_event`:**
   - Params: `{ calendarId = "primary", eventId, expectedTitle, patch: { title?, startIso?, endIso?, isAllDay?, date?, endDate?, location?, description? } }`.
   - Resolves `cal.getEventById(eventId)`; verifies `expectedTitle` (case-insensitive) if provided so stale drafts never overwrite a manually renamed event; applies requested field updates and returns the updated summary.
6. **`calendar_delete_event`:**
   - Params: `{ calendarId = "primary", eventId, expectedTitle }`.
   - Resolves `cal.getEventById(eventId)`, verifies `expectedTitle`, calls `ev.deleteEvent()`, and returns `{ deleted: true, eventId, title }`.

---

## 5. Bot Module Design

### 5.1 Shared Apps Script Transport & Calendar Service (`src/services/sheets.js` & `src/services/calendar.js`)
- Extract/export `requestAppsScript(config, action, payload, fetchImpl)` in `src/services/sheets.js` so `sheets.js` and `calendar.js` share one tested webhook POST implementation with `redirect: "follow"`, 20s timeout, and secret redaction.
- `createCalendarService(config, fetchImpl = fetch)` in `src/services/calendar.js`:
  - `isConfigured()`
  - `listCalendars()`
  - `listEvents({ calendarId, includeAllOwned, startIso, endIso, query, limit })`
  - `createEvent(payload)`
  - `updateEvent(payload)`
  - `deleteEvent(payload)`

### 5.2 Menu Explorer (`src/handlers/menu.js` & `src/handlers/workspace-menu.js`)
- Add `📅 Google Calendar` button (`callback_data: "menu:ws:calendar"`) to `homeView()` in `src/handlers/menu.js`.
- In `src/handlers/workspace-menu.js`:
  - `ws:calendar` (and range variants `today`, `7d`, `30d` via short `callback_refs`): fetches live events (default 7 days from start of today across owned calendars or the selected calendar), renders clean plain-text agenda grouped by day, and sets `active_context` (`platform: "calendar"`).
  - Sub-calendar picker view (`k: "cal_pick"`): lists `isOwnedByMe` calendars via short `callback_refs` (<64 bytes) so the user can filter to one sub-calendar or switch back to `Semua Kalender Utama`.

### 5.3 Strict AI Tools (`src/tools/calendar.js` merged into `src/tools.js`)
Keep files focused by placing calendar tools in `src/tools/calendar.js`:
- **Read Tools:**
  - `calendar_list_calendars()`
  - `calendar_list_events({ startIso, endIso, calendarId?, query?, includeAllOwned? })`
- **Strict Proposal Tools (always create `pending_actions` with `action:(confirm|cancel):<id>`):**
  - `calendar_propose_create_event({ title, startIso?, endIso?, isAllDay?, date?, endDate?, location?, description?, calendarId?, calendarName? })`:
    - Requires explicit ISO-8601 offset (`+07:00` / `Z`) on timed events and `end > start` (or valid `YYYY-MM-DD` when `isAllDay: true`).
    - Queries existing events in `[startIso, endIso]` to detect overlaps and appends `⚠️ Peringatan Bentrok: ...` to the draft summary if an overlap exists.
  - `calendar_propose_update_event({ eventId?, eventQuery?, windowStartIso?, windowEndIso?, calendarId?, patch })`:
    - Resolves target event via `listEvents`; if `0` matches → returns not-found message; if `> 1` matches → returns candidate list and refuses to create a draft until the user clarifies.
    - Stores `expectedTitle` on the draft payload.
  - `calendar_propose_delete_event({ eventId?, eventQuery?, windowStartIso?, windowEndIso?, calendarId? })`:
    - Resolves unique single event (refuses if `> 1` match), records `expectedTitle` and event time in `🗑️ Draft Hapus Jadwal`, and requires `✅ Simpan`.

### 5.4 Confirmation Executor & Prompt Rules (`src/handlers/actions.js`, `src/handlers/messages.js`, `SOUL.md`)
- Extend `executeWorkspaceAction` in `src/handlers/actions.js` to handle `calendar_create_event`, `calendar_update_event`, and `calendar_delete_event`.
- Update `messages.js`, `files.js`, `index.js`, `SOUL.md`, `AGENTS.md`, and `README.md`:
  - Always call `get_current_time` + `calendar_list_events` before answering schedule/free-busy questions.
  - Never guess missing event dates/times — ask the user first if date or start time is unspecified.
  - Never claim an event is saved/updated/deleted before the user clicks `✅ Simpan`.

---

## 6. Error Handling & Security

- **Apps Script Scope Not Yet Authorized:** If Apps Script returns a permission error (`You do not have permission to call CalendarApp`), `formatFriendlyError()` in `src/utils/errors.js` explains the exact 2-step fix: run `authorizeCalendar` once in Apps Script editor and update the Web App deployment to a *New version*.
- **Privacy (Public Repo):** Primary calendar uses `"primary"` rather than exposing any personal Gmail address in code, tests, or docs; all `callback_data` values use `callback_refs` (`<= 64` bytes).

---

## 7. Testing Plan (`npm test` offline)

1. `test/calendar.test.js`: Apps Script request payloads, unconfigured error, event list parsing, create/update/delete calls, and friendly error formatting for unauthorized `CalendarApp` scope.
2. `test/tools.test.js` (or `test/calendar-tools.test.js`): timestamp offset validation, overlap warning detection on create draft, candidate disambiguation when `> 1` event matches `eventQuery`, and `expectedTitle` inclusion on update/delete drafts.
3. `test/actions.test.js` & `test/workspace-menu.test.js`: `calendar_*` confirmation execution and `📅 Google Calendar` menu rendering + sub-calendar picker `< 64` byte callbacks.
