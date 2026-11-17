# Workspace Integrations (Trello, Notion, Superhuman Docs) & Read-Only KB Design Spec

**Date:** 2026-11-17  
**Project:** `ai-telegram-bot` (Nerissa Bot)

---

## 1. Goals

1. Integrate **Trello**, **Notion**, **Superhuman Docs**, and the local **Obsidian Knowledge Base (read-only)** into Nerissa Bot using live on-demand API/filesystem reads instead of static hardcoded targets.
2. Provide an interactive **dynamic picker** inside Telegram `/menu` (and inline sub-menus with the existing `0% → 25% → 50% → 75% → 100%` loading bar):
   - Step 1: User selects a platform (`Trello`, `Notion`, `Superhuman Docs`, or `Knowledge Base`) → bot fetches currently accessible boards, connected databases/pages, documents, or vault folders live.
   - Step 2: User picks **one source** → bot immediately performs a **lightweight live overview fetch** (metadata, counts, list/schema/table names, recent/top sample items) and renders a concise Telegram-safe summary + sets that source as the user's lightweight `active_context` in SQLite.
   - Step 3: User can either paginate/drill down lightly via inline buttons OR immediately type natural-language commands in chat (e.g. `"di Development Tracker pindah card dengan judul ... ke list In Progress"`).
3. Handle large sources gracefully (boards with 20+ lists and 500+ cards, databases with 100+ rows, vaults with nested folders) without hitting Telegram's 4096-character limit, Telegram's 64-byte `callback_data` limit, or LLM token/context bloat.
4. Enforce **Opsi A write safety**:
   - **Trello, Notion, Superhuman Docs:** Read & targeted search execute freely; **all writes/updates/archives** MUST create a draft in SQLite `pending_actions` and present inline buttons `[✅ Simpan]` / `[❌ Batal]` verified for `ALLOWED_USER_ID`.
   - **Knowledge Base:** Strictly **read-only** with path-traversal protection.

## 2. Non-Goals

- No local SQLite mirror/cache of Trello cards, Notion pages, or Superhuman Doc rows (external APIs stay the single source of truth).
- No permanent delete operations on Trello cards/lists or Notion pages/databases (archive/close only, aligned with `trello-manager-safe` and `notion-manager-safe`).
- No schema creation or automatic property/list creation in Notion or Superhuman Docs.
- No `/lapor` QA cross-posting workflow or local devtool/FFmpeg runners in this milestone.

---

## 3. Architecture & Data Flow

```text
Telegram User (/menu -> Workspace / KB)
   │
   ├─► Live Platform List (Trello boards / Notion search / Superhuman docs / KB root)
   │      (Short callback refs in SQLite `callback_refs` keep callback_data < 64 bytes)
   │
   └─► User picks 1 Source
          │
          ├─► Save lightweight `active_context` in SQLite (platform, sourceId, sourceName, meta)
          └─► Live Metadata Overview (paginated lists/tables/schema + counts + top 5 items)
                 │
                 ├── Optional inline drill-down (next list page / inspect 1 list or 1 table)
                 └── Natural chat follow-up in `messages.js`
                        │
                        ├── Read/Search Intent ─► Targeted API search tool (never dumps all 500+ cards)
                        └── Write/Update Intent ─► Validate target & disambiguate duplicates
                                                      └─► Save `pending_actions` draft + [✅ Simpan] [❌ Batal]
                                                            └─► Click ✅ Simpan ─► Claim atomic lock ─► Execute API write
```

### 3.1 Scaling Strategy for Large Sources
- **Never dump entire boards/databases into Telegram or the LLM prompt:**
  - **Menu Overview:** Fetches list names/counts or table/database schemas + at most 5–8 recent items per page; paginates long list sets (e.g. 10 lists per page) within 4,000 chars.
  - **AI Chat Tools:** AI injects only `active_context` (~2 lines: platform, active source name, active source ID) into the system prompt. When the user says *"pindah card judul X ke list Progress"*, the AI invokes targeted search tools (`trello_search_cards`, `notion_query_database`, `superhuman_query_table`, `kb_search`) filtered by query/list/table and capped to small result sets (`limit <= 10`).
  - **Duplicate & Ambiguity Guard:** If multiple lists share a name (e.g. two lists named `FIX`) or multiple cards/rows match the user's title query, proposal tools return candidate matches with IDs/list names so the AI asks the user to clarify instead of mutating the wrong item.

---

## 4. Database, Config & Security Design

### 4.1 Environment Configuration ([src/config.js](file:///c:/Project/ai-telegram-bot/src/config.js) & [.env.example](file:///c:/Project/ai-telegram-bot/.env.example))
Add optional fields in `validateConfig(env = process.env)`:
- `trelloApiKey`: `(env.TRELLO_API_KEY || "").trim()`
- `trelloApiToken`: `(env.TRELLO_API_TOKEN || "").trim()`
- `notionApiKey`: `(env.NOTION_API_KEY || env.NOTION_TOKEN || "").trim()`
- `superhumanApiToken`: `(env.SUPERHUMAN_API_TOKEN || "").trim()`
- `kbDir`: `(env.KB_DIR || "").trim()`

**Public-repo rule:** Because `dotenv.config({ path: ".env.local", override: true })` only overwrites keys present in `.env.local`, existing Windows User Environment Variables remain accessible when omitted from `.env.local`, and `.env.example` documents generic placeholder paths/values only (no personal paths, tokens, or IDs committed anywhere).

### 4.2 SQLite Schema Additions ([src/database.js](file:///c:/Project/ai-telegram-bot/src/database.js))
Add two lightweight tables to `initSchema(db)`:
1. `active_context`:
   - `user_id TEXT PRIMARY KEY`
   - `platform TEXT NOT NULL` (`'trello' | 'notion' | 'superhuman' | 'kb'`)
   - `source_id TEXT NOT NULL`
   - `source_name TEXT NOT NULL`
   - `extra_json TEXT`
   - `updated_at TEXT NOT NULL`
2. `callback_refs`:
   - `ref TEXT PRIMARY KEY` (8-char hex token stored before rendering buttons containing UUIDs, long file paths, or multi-part IDs)
   - `payload_json TEXT NOT NULL`
   - `created_at TEXT NOT NULL`

### 4.3 Secret Redaction ([src/utils/errors.js](file:///c:/Project/ai-telegram-bot/src/utils/errors.js))
Extend `redactSecrets(text)` to sanitize:
- Trello query parameters: `([?&](?:key|token)=)[^&\s]+` → `$1[REDACTED]`
- Common secret/token headers and tokens (`Bearer ...`, `ntn_...`, `secret_...`, `ATTA...`).

---

## 5. Module Architecture

### 5.1 Workspace State & Short Callback Refs (`src/services/workspace.js`)
- `createWorkspaceStore(pool)`:
  - `setActiveContext({ userId, platform, sourceId, sourceName, extra })`
  - `getActiveContext(userId)`
  - `createCallbackRef(payload)` (generates 8-char random/deterministic hex key, stores JSON payload in `callback_refs`, opportunistically prunes entries older than 7 days)
  - `resolveCallbackRef(ref)`

### 5.2 External Service Clients (`src/services/`)
Every REST client accepts `(config, fetchImpl = fetch)` with `AbortSignal.timeout(15000)`–`(20000)`, zero external dependencies beyond native `fetch`, and throws clean human-readable errors:

1. **`src/services/trello.js` (`createTrelloService(config, fetchImpl)`):**
   - Auth via Trello REST API v1 (`https://api.trello.com/1`), credentials injected via `Authorization`/`searchParams` internally and redacted on error.
   - Read methods:
     - `listBoards({ includeClosed = false })`: lists workspace/member boards (`id, name, desc, shortUrl, closed, prefs.permissionLevel`) + optionally open card counts.
     - `getBoardOverview(boardId, { page = 0, pageSize = 10 })`: fetches board metadata + open lists + lightweight open card summaries (`fields=id,name,idList,dateLastActivity,shortUrl`), aggregates card counts per list, marks duplicate list names with short ID suffixes, returns paginated list slice + latest 5 cards.
     - `listCardsInList(listId, { page = 0, pageSize = 8 })`: paginated cards inside one list.
     - `searchCards(boardId, query, { limit = 10 })`: filters/searches board cards by title/keyword cleanly.
   - Write methods (invoked only after `✅ Simpan`):
     - `createCard({ listId, name, desc, pos })`
     - `moveCard({ cardId, targetListId, pos })`
     - `updateCard({ cardId, name, desc, closed })` (archive via `closed: true`; never `DELETE`).

2. **`src/services/notion.js` (`createNotionService(config, fetchImpl)`):**
   - REST API `https://api.notion.com/v1` with `Notion-Version: 2022-06-28`.
   - Read methods:
     - `listConnectedSources()`: paginated `POST /v1/search` collecting connected `database` objects and top-level `page` objects (excluding individual database row pages from root list).
     - `getDatabaseOverview(databaseId, { pageSize = 6 })`: calls `GET /v1/databases/{id}` (returns actual property names, types, and `select`/`status` options) + `POST /v1/databases/{id}/query` for latest sample rows.
     - `queryDatabase(databaseId, { query, startCursor, pageSize = 8 })`: extracts plain text across `title`/`rich_text`/`select`/`status`/`number`/`date`/`url` properties for clean display and search filtering.
     - `getPagePreview(pageId)`: reads page properties + initial child blocks (`GET /v1/blocks/{id}/children?page_size=20`).
   - Write methods (invoked only after `✅ Simpan`):
     - `createDatabasePage({ databaseId, properties })`: maps user inputs strictly against `GET /v1/databases/{id}` schema, writes `POST /v1/pages`, then performs `GET /v1/pages/{createdId}` read-back verification.
     - `updatePage({ pageId, properties, archived })`: validates against database schema if parent is a database, updates via `PATCH /v1/pages/{pageId}`, verifies via `GET /v1/pages/{pageId}`. Never permanently deletes pages.

3. **`src/services/superhuman.js` (`createSuperhumanService(config, fetchImpl)`):**
   - REST API `https://coda.io/apis/v1` with `Bearer ${config.superhumanApiToken}`.
   - Read methods:
     - `listDocs()`: `GET /docs`.
     - `getDocOverview(docId)`: fetches doc metadata + `GET /docs/{docId}/acl/permissions` (`access` level check) + `GET /docs/{docId}/pages` + `GET /docs/{docId}/tables` (sorting named domain tables ahead of generic `Table N` entries).
     - `getTableOverview(docId, tableId, { limit = 8, pageToken, query })`: fetches `GET /docs/{docId}/tables/{tableId}/columns` + `GET /docs/{docId}/tables/{tableId}/rows?useColumnNames=true` with pagination/filter support.
   - Write methods (invoked only after `✅ Simpan`):
     - `insertRows(docId, tableId, { rows })`: maps values against actual column IDs, omits empty/null cells cleanly (preventing HTTP 400), calls `POST /docs/{docId}/tables/{tableId}/rows` (expecting HTTP 202 `requestId`), polls `GET /mutationStatus/{requestId}` with bounded backoff, and verifies inserted rows.
     - `updateRow(docId, tableId, rowId, { cells })`: calls `PUT /docs/{docId}/tables/{tableId}/rows/{rowId}`, polls `mutationStatus`, and verifies updated row.

4. **`src/services/kb.js` (`createKBService(config)` — Read-Only):**
   - Uses `node:fs/promises` + `node:path` + `fs.realpath`.
   - Security guard `resolveSafePath(relPath)`: resolves real target inside `realpath(config.kbDir)` and rejects `..`, absolute paths, symlinks escaping `kbDir`, and `.git` / `.obsidian` directories.
   - Read methods:
     - `listDirectory(relDir = "", { page = 0, pageSize = 10 })`: returns folders and `.md` files with pagination.
     - `searchNotes(query, { folder = "", limit = 8 })`: scans filenames and markdown line snippets (truncated per match, never loads entire vault into memory/AI).
     - `readNote(relPath, { startLine = 1, maxLines = 50 })`: returns bounded plain-text snippet + `hasMore` / `nextStartLine`.

### 5.3 Unified Pending Action Dispatcher (`src/services/pending.js` + `src/handlers/actions.js`)
- Extract `createPendingActionsStore(pool)` cleanly into `src/services/pending.js` and re-export it from `src/services/money.js` so existing finance tests keep passing untouched.
- Update `buildConfirmExtra(pendingAction)` in `src/utils/telegram.js` so `money` drafts continue emitting `money:(confirm|cancel):<id>` while workspace drafts emit `action:(confirm|cancel):<id>`.
- Implement unified executor `executeConfirmedWorkspaceAction(action, services)` (handling `trello_create_card`, `trello_move_card`, `trello_update_card`, `notion_create_page`, `notion_update_page`, `superhuman_add_row`, `superhuman_update_row`) called by `src/handlers/actions.js` (and `handleMoneyCallback` stays compatible for `money:*` callbacks or shares the same atomic claim/progress/restore pattern).

### 5.4 Interactive Menu & Workspace Flow ([src/handlers/menu.js](file:///c:/Project/ai-telegram-bot/src/handlers/menu.js) + `src/handlers/workspace-menu.js`)
Keep `menu.js` concise and modular by placing workspace view builders + callback handlers in `src/handlers/workspace-menu.js` and wiring them cleanly from `menu.js`:
- Add 2 rows to `homeView()` in `menu.js`:
  - `[ 📋 Trello ] [ 📓 Notion ]`
  - `[ 📄 Superhuman Docs ] [ 🧠 Knowledge Base ]`
- Keep `BOT_COMMANDS` minimal without adding extra workspace slash commands; access everything directly via `/menu` inline buttons and natural chat.
- Plain-text formatting consistent with `SOUL.md` (no `**`, `*`, `#`, or backticks in Telegram output).
- Clicking any workspace button runs inside `runWithProgress({ mode: "edit" })`:
  - Platform button → fetches live sources → renders numbered inline buttons using short `callback_refs`.
  - Source button → stores `active_context` → fetches live overview → displays paginated lists/tables/schema/sample + chat command hints + `[ 🔍 Intip Isi ]` / `[ 🔄 Refresh ]` / `[ « Ganti Sumber ]` / `[ « Menu Utama ]`.

### 5.5 AI Tool Calling & System Prompt ([src/tools.js](file:///c:/Project/ai-telegram-bot/src/tools.js), `src/tools/workspace.js`, & [src/handlers/messages.js](file:///c:/Project/ai-telegram-bot/src/handlers/messages.js))
- Define the new workspace tools cleanly in `src/tools/workspace.js` and merge them into `tools` / `executeTool` in `src/tools.js` (keeping files focused and modular):
  - **Trello:** `trello_list_boards`, `trello_get_board_lists`, `trello_search_cards`, `trello_propose_create_card`, `trello_propose_move_card`, `trello_propose_update_card`
  - **Notion:** `notion_list_sources`, `notion_get_database_schema`, `notion_query_database`, `notion_propose_create_page`, `notion_propose_update_page`
  - **Superhuman:** `superhuman_list_docs`, `superhuman_get_doc_structure`, `superhuman_query_table`, `superhuman_propose_add_row`, `superhuman_propose_update_row`
  - **KB (Read-Only):** `kb_search`, `kb_read_note`
- In `messages.js`, call `workspaceStore.getActiveContext(userId)` and inject only a compact 2-line active context block (platform, source name, source ID — never bulk cards/rows) plus clear instructions into `buildSystemPrompt()`:
  - Check live source/list/schema before proposing writes.
  - Never invent IDs or guess Notion/Superhuman column names.
  - When duplicate lists or ambiguous card/row titles appear, present candidates concisely and ask the user to confirm which one before calling `*_propose_*`.
- Pass `{ trelloService, notionService, superhumanService, kbService, workspaceStore }` in `toolContext`.

---

## 6. Error Handling & Edge Cases

- **Missing Credentials / Config:** Calling an unconfigured integration returns a clear setup message referencing the missing env variable (`TRELLO_API_KEY` / `TRELLO_API_TOKEN`, `NOTION_API_KEY`, `SUPERHUMAN_API_TOKEN`, `KB_DIR`) without affecting MoneyTracker, notes, reminders, or market features.
- **Permission & Connection Errors (401/403/404):**
  - Notion 404/403 informs the user to verify `... → Connections → Connect to Opencode` on the target page/database.
  - Superhuman read-only ACL disables/blocks write proposals with a clear permission explanation.
- **Rate Limits & Timeouts (429 / Timeout):** Formatted safely via `formatFriendlyError()` and scrubbed by `redactSecrets()`.
- **64-byte `callback_data` Overflow:** Mitigated globally via SQLite-backed `callback_refs`.
- **Stale Proposal Revisions:** Just like `MoneyTracker`, creating a new pending draft for the user supersedes any older `'pending'` draft cleanly.

---

## 7. Testing Plan

All tests run offline via `npm test` (`node --test`) using injected `fetchImpl` mocks, `:memory:` SQLite, and temporary filesystem directories (`fs.mkdtemp`):
1. `test/config.test.js` & `test/errors.test.js`: optional workspace config parsing and Trello/Bearer/token secret redaction.
2. `test/trello.test.js`: board listing, large-board pagination, duplicate list name disambiguation (`FIX`), card search, move/create/archive writes (no `DELETE`).
3. `test/notion.test.js`: paginated search, database schema + row extraction, create/update page with read-back `GET` verification, unshared/403 handling.
4. `test/superhuman.test.js`: docs list, ACL check, pages + tables listing, row insertion omitting null cells + HTTP 202 `mutationStatus` polling + verification.
5. `test/kb.test.js`: temp-dir vault listing, keyword search snippets, paginated note reading, **path-traversal / symlink escape rejection**.
6. `test/workspace-menu.test.js` & `test/actions.test.js` & `test/tools.test.js`: `callback_refs` < 64 bytes, `active_context` persistence across mock DB calls, loading progress integration, tool validation + candidate disambiguation, and `✅ Simpan` / `❌ Batal` end-to-end execution.
