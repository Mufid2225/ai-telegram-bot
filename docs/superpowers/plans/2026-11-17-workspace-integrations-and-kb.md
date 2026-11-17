# Workspace Integrations & Read-Only KB Implementation Plan

> **For agentic workers:** Using inline TDD execution (`test-driven-development` + `verification-before-completion`). Steps use checkbox (`- [ ]`) syntax for tracking. Note: Do NOT run `git commit` or `git push` without explicit user approval.

**Goal:** Add live dynamic Workspace pickers (`/menu` → Trello, Notion, Superhuman Docs, Read-Only Knowledge Base), compact paginated overviews, persistent `active_context` & short `callback_refs`, AI search/mutation tools, and mandatory `[✅ Simpan] [❌ Batal]` confirmation across external writes.

**Architecture:** Modular service layer (`src/services/{trello,notion,superhuman,kb,workspace,pending}.js` + `src/utils/http.js`) using native `fetch` + `AbortSignal.timeout` and offline unit tests. Telegram inline menus live in `src/handlers/workspace-menu.js` routed via `src/handlers/menu.js`, AI tools live in `src/tools/workspace.js` merged into `src/tools.js`, and unified confirmations share `src/handlers/actions.js`.

**Tech Stack:** Node.js 22+ ESM, Telegraf, `better-sqlite3`, native `fetch`, `node:test`, `node:fs/promises`.

## Global Constraints

- Public repo (`Mufid2225/ai-telegram-bot`): NEVER hardcode tokens, secrets, personal emails, personal local filesystem paths, or personal IDs in source, tests, `.env.example`, or docs.
- Never delete permanently in Trello (`closed: true` archive only) or Notion (`archived: true` only).
- Knowledge Base service is strictly **read-only** with path-traversal and symlink escape rejection.
- All Telegram replies and menu views follow `SOUL.md` plain-text formatting (no `**`, `*`, `#`, or backtick markdown).
- Every `callback_data` string MUST remain `<= 64` bytes (use `workspaceStore.createCallbackRef`).
- Preserve all existing `MoneyTracker` exports (`createPendingActionsStore`, `executeConfirmedAction` in `src/services/money.js`, `handleMoneyCallback` in `src/handlers/money.js`).

---

### Task 1: Config, Secret Redaction & Database Additions

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `src/utils/errors.js`
- Modify: `src/database.js`
- Create: `src/utils/http.js`
- Test: `test/config.test.js`, `test/errors.test.js`, `test/database.test.js`

**Interfaces:**
- `validateConfig(env)` returns `{ ..., trelloApiKey, trelloApiToken, notionApiKey, superhumanApiToken, kbDir }`.
- `redactSecrets(text, extraSecrets = [])` hides Trello query keys/tokens, `ntn_...`, `secret_...`, `ATTA...`, and optional literal strings in `extraSecrets`.
- `requestJson(url, options, { label, timeoutMs, fetchImpl, extraSecrets })` returns parsed JSON (handling HTTP errors cleanly with redacted details).
- `createDatabase()` initializes `active_context` and `callback_refs` tables.

- [ ] **Step 1: Write failing tests in `test/config.test.js`, `test/errors.test.js`, and `test/database.test.js`**
- [ ] **Step 2: Run targeted tests to verify RED (`node --test test/config.test.js test/errors.test.js test/database.test.js`)**
- [ ] **Step 3: Implement `src/config.js`, `.env.example`, `src/utils/errors.js`, `src/utils/http.js`, `src/database.js`**
- [ ] **Step 4: Run tests + `node --check` to verify GREEN**

---

### Task 2: Workspace Store & Pending Action Split

**Files:**
- Create: `src/services/workspace.js`
- Create: `src/services/pending.js`
- Modify: `src/services/money.js` (re-export `createPendingActionsStore` from `./pending.js`)
- Modify: `src/utils/telegram.js` (`buildConfirmExtra` emits `action:(confirm|cancel):<id>` for non-money kinds, `money:(confirm|cancel):<id>` for money kinds)
- Test: `test/workspace.test.js`, `test/telegram.test.js`, `test/money.test.js`

**Interfaces:**
- `createWorkspaceStore(pool)` -> `{ setActiveContext, getActiveContext, createCallbackRef, resolveCallbackRef }`
- `createPendingActionsStore(pool)` in `src/services/pending.js` (and re-exported by `src/services/money.js`)
- `buildConfirmExtra(pendingAction)` keeps `money:*` for existing money kinds (`add_expenses`, `update_expense`, `delete_expense`, `upsert_income`) and `action:*` for workspace kinds (`trello_*`, `notion_*`, `superhuman_*`).

- [ ] **Step 1: Write failing tests in `test/workspace.test.js` and `test/telegram.test.js`**
- [ ] **Step 2: Run targeted tests to verify RED**
- [ ] **Step 3: Implement `src/services/workspace.js`, `src/services/pending.js`, update `src/services/money.js` & `src/utils/telegram.js`**
- [ ] **Step 4: Run `node --test test/workspace.test.js test/telegram.test.js test/money.test.js test/handlers-money.test.js` to verify GREEN**

---

### Task 3: Trello Service Client (`src/services/trello.js`)

**Files:**
- Create: `src/services/trello.js`
- Test: `test/trello.test.js`

**Interfaces:**
- `createTrelloService(config, fetchImpl = fetch)`:
  - `isConfigured()`
  - `listBoards({ includeClosed = false })`
  - `getBoardOverview(boardId, { page = 0, pageSize = 10 })`
  - `listCardsInList(listId, { page = 0, pageSize = 8 })`
  - `searchCards(boardId, query, { limit = 10 })`
  - `createCard({ listId, name, desc, pos })`
  - `moveCard({ cardId, targetListId, pos })`
  - `updateCard({ cardId, name, desc, closed })`

- [ ] **Step 1: Write failing tests in `test/trello.test.js` covering config guard, board list, paginated overview with duplicate list names, search, create/move/archive (no `DELETE`), and redacted error URLs**
- [ ] **Step 2: Run `node --test test/trello.test.js` to verify RED**
- [ ] **Step 3: Implement `src/services/trello.js`**
- [ ] **Step 4: Run `node --test test/trello.test.js` to verify GREEN**

---

### Task 4: Notion Service Client (`src/services/notion.js`)

**Files:**
- Create: `src/services/notion.js`
- Test: `test/notion.test.js`

**Interfaces:**
- `createNotionService(config, fetchImpl = fetch)`:
  - `isConfigured()`
  - `listConnectedSources()`
  - `getDatabaseOverview(databaseId, { pageSize = 6 })`
  - `queryDatabase(databaseId, { query, startCursor, pageSize = 8 })`
  - `getPagePreview(pageId)`
  - `createDatabasePage({ databaseId, values })`
  - `updatePage({ pageId, values, archived })`

- [ ] **Step 1: Write failing tests in `test/notion.test.js` covering paginated search, schema parsing + select validation, plain-text query extraction, create/update with GET read-back verification, and 403/404 guidance**
- [ ] **Step 2: Run `node --test test/notion.test.js` to verify RED**
- [ ] **Step 3: Implement `src/services/notion.js`**
- [ ] **Step 4: Run `node --test test/notion.test.js` to verify GREEN**

---

### Task 5: Superhuman Docs Service Client (`src/services/superhuman.js`)

**Files:**
- Create: `src/services/superhuman.js`
- Test: `test/superhuman.test.js`

**Interfaces:**
- `createSuperhumanService(config, fetchImpl = fetch)`:
  - `isConfigured()`
  - `listDocs()`
  - `getDocOverview(docId)`
  - `getTableOverview(docId, tableId, { limit = 8, pageToken, query })`
  - `insertRows(docId, tableId, { rows })`
  - `updateRow(docId, tableId, rowId, { cells })`

- [ ] **Step 1: Write failing tests in `test/superhuman.test.js` covering doc list, ACL write/read check, pages/tables sorting, row read/filter, null-cell omission + HTTP 202 mutation polling**
- [ ] **Step 2: Run `node --test test/superhuman.test.js` to verify RED**
- [ ] **Step 3: Implement `src/services/superhuman.js`**
- [ ] **Step 4: Run `node --test test/superhuman.test.js` to verify GREEN**

---

### Task 6: Read-Only Knowledge Base Service (`src/services/kb.js`)

**Files:**
- Create: `src/services/kb.js`
- Test: `test/kb.test.js`

**Interfaces:**
- `createKBService(config)`:
  - `isConfigured()`
  - `listDirectory(relDir = "", { page = 0, pageSize = 10 })`
  - `searchNotes(query, { folder = "", limit = 8 })`
  - `readNote(relPath, { startLine = 1, maxLines = 50 })`

- [ ] **Step 1: Write failing tests in `test/kb.test.js` using `fs.mkdtemp` covering listing/pagination, keyword search snippets, line-sliced reads, and path traversal / escaping rejection**
- [ ] **Step 2: Run `node --test test/kb.test.js` to verify RED**
- [ ] **Step 3: Implement `src/services/kb.js`**
- [ ] **Step 4: Run `node --test test/kb.test.js` to verify GREEN**

---

### Task 7: Unified Confirmation Actions & Workspace AI Tools

**Files:**
- Create: `src/handlers/actions.js`
- Modify: `src/handlers/money.js` (reuse shared confirmation runner from `actions.js`)
- Create: `src/tools/workspace.js`
- Modify: `src/tools.js` (merge `workspaceTools` and `executeWorkspaceTool`)
- Test: `test/actions.test.js`, `test/tools.test.js`

**Interfaces:**
- `src/handlers/actions.js`: `runPendingConfirmation({ ctx, actionType, actionId, allowedUserId, pendingStore, progressText, executeAction, stepMs, finishDelayMs })`, `executeWorkspaceAction(action, services)`, `registerActionHandlers(bot, deps)`
- `src/tools/workspace.js`: `workspaceTools`, `executeWorkspaceTool(name, args, context)`, `formatWorkspaceDraftPreview(kind, payload)`

- [ ] **Step 1: Write failing tests in `test/actions.test.js` and `test/tools.test.js`**
- [ ] **Step 2: Run targeted tests to verify RED**
- [ ] **Step 3: Implement `src/handlers/actions.js`, `src/tools/workspace.js`, update `src/handlers/money.js` & `src/tools.js`**
- [ ] **Step 4: Run `node --test test/actions.test.js test/tools.test.js test/handlers-money.test.js` to verify GREEN**

---

### Task 8: Dynamic Inline Workspace Menu & Entrypoint Wiring

**Files:**
- Create: `src/handlers/workspace-menu.js`
- Modify: `src/handlers/menu.js`
- Modify: `src/handlers/messages.js` (inject `active_context` + pass services in `toolContext`)
- Modify: `src/index.js` (instantiate stores/services and wire handlers)
- Test: `test/workspace-menu.test.js`, `test/handlers-menu.test.js`

**Interfaces:**
- `handleWorkspaceMenuAction({ ctx, action, userId, workspaceStore, trelloService, notionService, superhumanService, kbService })` returning `{ text, extra }` view objects (and handling navigation cleanly under 64-byte callback limits)
- `registerMessageHandlers` accepts `{ pool, callAI, repository, sheetsService, pendingStore, reminderStore, workspaceStore, trelloService, notionService, superhumanService, kbService, dateStr }`

- [ ] **Step 1: Write failing tests in `test/workspace-menu.test.js` and `test/handlers-menu.test.js`**
- [ ] **Step 2: Run targeted tests to verify RED**
- [ ] **Step 3: Implement `src/handlers/workspace-menu.js`, update `src/handlers/menu.js`, `src/handlers/messages.js`, `src/index.js`**
- [ ] **Step 4: Run `npm test` (full suite) and `node --check src/index.js` + all modified files**
- [ ] **Step 5: Run `gitleaks dir --redact --no-banner` across modified/added files**
