# Savings Targets (`Targets` + `TargetLogs` + Previous-Month Surplus) Implementation Plan

> **For agentic workers:** Using inline TDD execution (`test-driven-development` + `verification-before-completion`). Steps use checkbox (`- [ ]`) syntax for tracking. Do NOT run `git commit` or `git push` without explicit user approval.

**Goal:** Implement standalone `Targets` and `TargetLogs` tabs in Google Sheets `MoneyTracker` (matching existing green sheet styling and kept synchronized via `=SUMIF(...)`), plus bot services, 7 AI tools (including exact unallocated previous-month surplus checking), `/target` command, and strict `[✅ Simpan] [❌ Batal]` draft confirmation.

**Architecture:** Extend `apps-script/MoneyTracker.gs` with 6 `targets_*` actions and an auto-setup/style-cloning helper `ensureTargetSheets(ss)`. Expose those actions in `src/services/sheets.js`, add period/surplus math, progress-bar formatters, and `executeConfirmedAction` cases in `src/services/money.js` + `src/utils/telegram.js`, place the 7 target/surplus tools in a focused `src/tools/targets.js` wired into `src/tools.js`, and wire `/target` + prompt instructions across `src/handlers/money.js`, `src/handlers/menu.js`, `src/handlers/messages.js`, and `SOUL.md`.

**Tech Stack:** Google Apps Script (`SpreadsheetApp`), Node.js 22+ ESM, Telegraf, `better-sqlite3`, `node:test`.

## Global Constraints

- Public repo (`Mufid2225/ai-telegram-bot`): NEVER put real spreadsheet URLs, secrets, personal target names, or personal account data into code, tests, or docs.
- Single Source of Truth: `MoneyTracker` Google Sheets owns all `Targets` and `TargetLogs` data; NO local SQLite mirror tables.
- Strict Mutation Gate: ALL writes (`create_target`, `add_target_deposit`, `update_target`, `delete_target_log`) MUST go through `pendingStore.create` (`money:(confirm|cancel):<id>`) and `ALLOWED_USER_ID` check.
- Plain-Text Telegram Copy: Follow `SOUL.md` formatting (no `**`, `*`, `#`, or backticks in user-facing Telegram messages).
- Verification before completion: `npm test` and `node --check` on all `.js` files must pass after the final edit.

---

### Task 1: Apps Script `Targets` & `TargetLogs` Bridge + `sheetsService` Methods

**Files:**
- Modify: `apps-script/MoneyTracker.gs:70-95` (switch dispatch) and append target handlers at bottom of `apps-script/MoneyTracker.gs`
- Modify: `src/services/sheets.js:32-45`
- Test: `test/sheets.test.js`

**Interfaces:**
- Produces on `createSheetsService(config, fetchImpl)`:
  - `listTargets(filters = {})` → `{ targets: Array<{ rowNumber, id, name, targetAmount, collectedAmount, remainingAmount, progressPercent, status, note, createdAt }> }`
  - `listTargetLogs(filters = {})` → `{ logs: Array<{ rowNumber, logId, date, targetId, targetName, amount, note, sourcePeriod }>, totalMatchedAmount: number }`
  - `createTarget(payload)` → `{ id, name, targetAmount, collectedAmount, remainingAmount, progressPercent, status, note, createdAt, rowNumber }`
  - `addTargetDeposit(payload)` → `{ log, target }`
  - `updateTarget(payload)` → updated target object
  - `deleteTargetLog(payload)` → `{ deleted: true, logId, target }`

- [ ] **Step 1: Write failing tests in `test/sheets.test.js`**

Append to `test/sheets.test.js`:

```js
test("sheets service dispatches targets_* actions with expected payloads", async () => {
  const calls = [];
  const sheets = createSheetsService(
    { sheetWebhookUrl: "https://script.google.com/macros/s/test/exec", sheetApiSecret: "sec-123" },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(JSON.stringify({ ok: true, data: { action: body.action } }), { status: 200 });
    }
  );

  await sheets.listTargets({ status: "Aktif" });
  await sheets.listTargetLogs({ targetId: "TGT-001", sourcePeriod: "2026-10", limit: 50 });
  await sheets.createTarget({ name: "Monitor", targetAmount: 2500000, note: "Promo" });
  await sheets.addTargetDeposit({ targetId: "TGT-001", amount: 500000, note: "Sisa Okt", sourcePeriod: "2026-10" });
  await sheets.updateTarget({ targetId: "TGT-001", expected: { name: "Monitor" }, patch: { status: "Ditunda" } });
  await sheets.deleteTargetLog({ logId: "LOG-001", rowNumber: 2, expected: { amount: 500000 } });

  assert.deepEqual(
    calls.map((c) => c.action),
    [
      "targets_list",
      "targets_logs",
      "targets_create",
      "targets_add_deposit",
      "targets_update",
      "targets_delete_log",
    ]
  );
  assert.equal(calls[0].status, "Aktif");
  assert.equal(calls[1].sourcePeriod, "2026-10");
  assert.equal(calls[2].targetAmount, 2500000);
  assert.equal(calls[3].sourcePeriod, "2026-10");
  assert.equal(calls[4].patch.status, "Ditunda");
  assert.equal(calls[5].logId, "LOG-001");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sheets.test.js`
Expected: FAIL (`TypeError: sheets.listTargets is not a function`).

- [ ] **Step 3: Add `targets_*` methods to `src/services/sheets.js` and handlers to `apps-script/MoneyTracker.gs`**

In `src/services/sheets.js`, extend the object returned by `createSheetsService`:

```js
    listTargets: (filters = {}) => request("targets_list", filters),
    listTargetLogs: (filters = {}) => request("targets_logs", filters),
    createTarget: (payload) => request("targets_create", payload),
    addTargetDeposit: (payload) => request("targets_add_deposit", payload),
    updateTarget: (payload) => request("targets_update", payload),
    deleteTargetLog: (payload) => request("targets_delete_log", payload),
```

In `apps-script/MoneyTracker.gs`, add dispatch inside `doPost` before `switch (action)`:

```javascript
    if (action.indexOf("targets_") === 0) {
      data = handleTargetAction(ss, action, body);
      return jsonResponse({ ok: true, data: data });
    }
```

And append the complete `TARGET TABUNGAN HANDLERS` section to `apps-script/MoneyTracker.gs` (including `getReferenceHeaderStyle(ss)` cloning green fill/font from `Expenses` or `Income` cell `A1`, `ensureTargetSheets(ss)` setting up `Targets` (`A:I`) and `TargetLogs` (`A:G`) with frozen headers, borders, `"Rp "#,##0` currency format, `0.0%` progress format, `Status` dropdown validation, `=SUMIF(TargetLogs!$C:$C, A<r>, TargetLogs!$E:$E)`, `=MAX(0, C<r>-D<r>)`, `=IF(C<r>>0, D<r>/C<r>, 0)`, plus `handleTargetsList`, `handleTargetsLogs`, `handleTargetsCreate`, `handleTargetsAddDeposit`, `handleTargetsUpdate`, `handleTargetsDeleteLog`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sheets.test.js`
Expected: PASS (4/4 tests in `test/sheets.test.js`).

---

### Task 2: Target Formatters, Surplus Calculator, Telegram Routing & Confirmation Executor

**Files:**
- Modify: `src/utils/telegram.js:26-31` (`MONEY_PENDING_KINDS`)
- Modify: `src/services/money.js`
- Test: `test/money.test.js`, `test/telegram.test.js`

**Interfaces:**
- Consumes: `sheetsService.{getSummary, listTargets, listTargetLogs, createTarget, addTargetDeposit, updateTarget, deleteTargetLog}`
- Produces in `src/services/money.js`:
  - `TARGET_STATUSES` (`["Aktif", "Tercapai", "Ditunda", "Arsip"]`)
  - `toSourcePeriod(monthName, year)` → `"YYYY-MM"`
  - `getPreviousMonthPeriod(now = new Date())` → `{ month, year, sourcePeriod }`
  - `calculateMonthlySurplus({ sheetsService, month, year })` → `{ month, year, sourcePeriod, totalIncome, totalRealisasi, saldo, allocatedAmount, availableSurplus }`
  - `renderProgressBar(percent, width = 10)`
  - `formatTargetsList(targets)`
  - `formatTargetLogsList(logs, label = "")`
  - `formatSurplusSummary(surplus, activeTargets = [])`
  - `formatDraftPreview(kind, payload)` cases for `create_target`, `add_target_deposit`, `update_target`, `delete_target_log`
  - `executeConfirmedAction(action, sheetsService)` cases for `create_target`, `add_target_deposit`, `update_target`, `delete_target_log`

- [ ] **Step 1: Write failing tests in `test/telegram.test.js` and `test/money.test.js`**

Add to `test/telegram.test.js`:

```js
test("buildConfirmExtra uses money: prefix for savings target drafts", () => {
  for (const kind of ["create_target", "add_target_deposit", "update_target", "delete_target_log"]) {
    const kb = buildConfirmExtra({ id: "tgt123", kind }).reply_markup.inline_keyboard[0];
    assert.equal(kb[0].callback_data, "money:confirm:tgt123");
    assert.equal(kb[1].callback_data, "money:cancel:tgt123");
  }
});
```

Add to `test/money.test.js` (updating imports from `../src/services/money.js` to include `getPreviousMonthPeriod`, `toSourcePeriod`, `calculateMonthlySurplus`, `renderProgressBar`, `formatTargetsList`, `formatDraftPreview`):

```js
test("getPreviousMonthPeriod handles standard and January-to-December rollovers", () => {
  assert.deepEqual(getPreviousMonthPeriod(new Date(2026, 10, 21)), {
    month: "Oktober",
    year: 2026,
    sourcePeriod: "2026-10",
  });
  assert.deepEqual(getPreviousMonthPeriod(new Date(2026, 0, 5)), {
    month: "Desember",
    year: 2025,
    sourcePeriod: "2025-12",
  });
  assert.equal(toSourcePeriod("Februari", 2026), "2026-02");
});

test("calculateMonthlySurplus subtracts already-allocated logs for that sourcePeriod", async () => {
  const fakeSheets = {
    getSummary: async ({ month, year }) => ({
      month,
      year,
      totalIncome: 2000000,
      totalRealisasi: 1250000,
      saldo: 750000,
    }),
    listTargetLogs: async ({ sourcePeriod }) => {
      assert.equal(sourcePeriod, "2026-10");
      return {
        logs: [{ logId: "LOG-001", amount: 300000 }],
        totalMatchedAmount: 300000,
      };
    },
  };

  const surplus = await calculateMonthlySurplus({
    sheetsService: fakeSheets,
    month: "Oktober",
    year: 2026,
  });
  assert.equal(surplus.saldo, 750000);
  assert.equal(surplus.allocatedAmount, 300000);
  assert.equal(surplus.availableSurplus, 450000);
});

test("renderProgressBar, formatTargetsList, formatDraftPreview, and executeConfirmedAction support savings targets", async () => {
  assert.equal(renderProgressBar(60, 10), "[██████░░░░]");
  const listText = formatTargetsList([
    {
      id: "TGT-001",
      name: "Monitor 27",
      targetAmount: 3000000,
      collectedAmount: 1800000,
      remainingAmount: 1200000,
      progressPercent: 60,
      status: "Aktif",
      note: "Promo 12.12",
    },
  ]);
  assert.match(listText, /TGT-001/);
  assert.match(listText, /\[██████░░░░\] 60%/);
  assert.match(listText, /Rp 1\.800\.000/);

  const preview = formatDraftPreview("add_target_deposit", {
    targetId: "TGT-001",
    targetName: "Monitor 27",
    amount: 450000,
    date: "2026-11-21",
    note: "Sisa uang bulan Oktober",
    sourcePeriod: "2026-10",
    overSurplusWarning: "Nominal melebihi sisa bebas bulan Oktober 2026 (Rp 400.000).",
  });
  assert.match(preview, /Monitor 27/);
  assert.match(preview, /Sisa uang bulan Oktober/);
  assert.match(preview, /Nominal melebihi/);

  const calls = [];
  const fakeSheets = {
    createTarget: async (p) => { calls.push(["createTarget", p]); return { id: "TGT-002", name: p.name, targetAmount: p.targetAmount }; },
    addTargetDeposit: async (p) => {
      calls.push(["addTargetDeposit", p]);
      return {
        log: { logId: "LOG-002", amount: p.amount },
        target: { id: p.targetId, name: "Monitor 27", collectedAmount: 2250000, targetAmount: 3000000, progressPercent: 75, status: "Aktif" },
      };
    },
    updateTarget: async (p) => { calls.push(["updateTarget", p]); return { id: p.targetId, name: "Monitor 27", status: "Ditunda" }; },
    deleteTargetLog: async (p) => { calls.push(["deleteTargetLog", p]); return { deleted: true, logId: p.logId }; },
  };

  const r1 = await executeConfirmedAction({ kind: "create_target", payload: { name: "SSD", targetAmount: 1500000 } }, fakeSheets);
  assert.match(r1, /TGT-002/);
  const r2 = await executeConfirmedAction({ kind: "add_target_deposit", payload: { targetId: "TGT-001", targetName: "Monitor 27", amount: 450000 } }, fakeSheets);
  assert.match(r2, /75\.0%|75%/);
  const r3 = await executeConfirmedAction({ kind: "update_target", payload: { targetId: "TGT-001", targetName: "Monitor 27", patch: { status: "Ditunda" } } }, fakeSheets);
  assert.match(r3, /Monitor 27/);
  const r4 = await executeConfirmedAction({ kind: "delete_target_log", payload: { logId: "LOG-002" } }, fakeSheets);
  assert.match(r4, /LOG-002/);
  assert.equal(calls.length, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/telegram.test.js test/money.test.js`
Expected: FAIL (missing exports + `action:confirm:tgt123` instead of `money:confirm:tgt123`).

- [ ] **Step 3: Implement updates in `src/utils/telegram.js` and `src/services/money.js`**

In `src/utils/telegram.js`, expand `MONEY_PENDING_KINDS`:

```js
const MONEY_PENDING_KINDS = new Set([
  "add_expenses",
  "update_expense",
  "delete_expense",
  "upsert_income",
  "create_target",
  "add_target_deposit",
  "update_target",
  "delete_target_log",
]);
```

In `src/services/money.js`, add `TARGET_STATUSES`, `toSourcePeriod`, `getPreviousMonthPeriod`, `calculateMonthlySurplus`, `renderProgressBar`, `formatTargetsList`, `formatTargetLogsList`, `formatSurplusSummary`, and extend `formatDraftPreview` + `executeConfirmedAction` for `"create_target"`, `"add_target_deposit"`, `"update_target"`, and `"delete_target_log"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/telegram.test.js test/money.test.js`
Expected: PASS (all tests in both files).

---

### Task 3: Target & Surplus AI Tools (`src/tools/targets.js` + `src/tools.js`)

**Files:**
- Create: `src/tools/targets.js`
- Modify: `src/tools.js` (import and spread `targetTools` and delegate in `executeTool`)
- Test: `test/tools.test.js`

**Interfaces:**
- Consumes: `src/services/money.js` (`todayIso`, `normalizeMonthName`, `getPreviousMonthPeriod`, `calculateMonthlySurplus`, `formatIDR`, `formatDraftPreview`, `formatTargetsList`, `formatTargetLogsList`, `formatSurplusSummary`, `TARGET_STATUSES`) and `context.{sheetsService, pendingStore, userId}`
- Produces in `src/tools/targets.js`:
  - `targetTools`: 7 OpenAI-schema function definitions (`money_list_targets`, `money_list_target_logs`, `money_check_surplus`, `money_propose_create_target`, `money_propose_add_target_deposit`, `money_propose_update_target`, `money_propose_delete_target_log`)
  - `executeTargetTool(name, args, context)` → `string | null` (returns `null` when tool name is not a target tool)

- [ ] **Step 1: Write failing tests in `test/tools.test.js`**

Add assertions to `test/tools.test.js` checking:
1. All 7 target tool names exist in `tools`.
2. `money_check_surplus` defaults to previous month, calls `getSummary` + `listTargetLogs`, and returns exact unallocated surplus + active targets.
3. `money_propose_create_target` rejects empty name / non-positive amount / duplicate active target name, and creates `pendingAction` (`kind: "create_target"`) without writing.
4. `money_propose_add_target_deposit` resolves unique target by name/ID, rejects ambiguous multi-match with candidate list, attaches over-surplus warning when `sourcePeriod` amount exceeds `availableSurplus`, and creates `pendingAction` (`kind: "add_target_deposit"`).
5. `money_propose_update_target` and `money_propose_delete_target_log` look up current rows to attach `expected` snapshots before creating `pendingAction`.

```js
test("target tools register, calculate surplus, disambiguate targets, and create pendingAction without mutating", async () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "money_list_targets",
    "money_list_target_logs",
    "money_check_surplus",
    "money_propose_create_target",
    "money_propose_add_target_deposit",
    "money_propose_update_target",
    "money_propose_delete_target_log",
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`);
  }

  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    let mutated = false;
    const fakeTargets = [
      { rowNumber: 2, id: "TGT-001", name: "Monitor 27", targetAmount: 3000000, collectedAmount: 1000000, remainingAmount: 2000000, progressPercent: 33.3, status: "Aktif", note: "" },
      { rowNumber: 3, id: "TGT-002", name: "Monitor Kantor", targetAmount: 2000000, collectedAmount: 500000, remainingAmount: 1500000, progressPercent: 25, status: "Aktif", note: "" },
    ];
    const fakeLogs = [
      { rowNumber: 2, logId: "LOG-001", date: "2026-11-02", targetId: "TGT-001", targetName: "Monitor 27", amount: 200000, note: "Sisa uang bulan Oktober", sourcePeriod: "2026-10" },
    ];
    const fakeSheets = {
      listTargets: async () => ({ targets: fakeTargets }),
      listTargetLogs: async ({ sourcePeriod } = {}) => {
        const matched = sourcePeriod ? fakeLogs.filter((l) => l.sourcePeriod === sourcePeriod) : fakeLogs;
        return { logs: matched, totalMatchedAmount: matched.reduce((s, l) => s + l.amount, 0) };
      },
      getSummary: async ({ month, year }) => ({
        month,
        year,
        totalIncome: 1500000,
        totalRealisasi: 1000000,
        saldo: 500000,
      }),
      createTarget: async () => { mutated = true; return {}; },
      addTargetDeposit: async () => { mutated = true; return {}; },
      updateTarget: async () => { mutated = true; return {}; },
      deleteTargetLog: async () => { mutated = true; return {}; },
    };

    const ctx = { userId: "123456789", pool: db, sheetsService: fakeSheets, pendingStore };

    const surplusOut = await executeTool("money_check_surplus", { month: "Oktober", year: 2026 }, ctx);
    assert.match(surplusOut, /Rp 500\.000/);
    assert.match(surplusOut, /Rp 200\.000/);
    assert.match(surplusOut, /Rp 300\.000/);

    const ambig = await executeTool("money_propose_add_target_deposit", { targetName: "Monitor", amount: 100000 }, ctx);
    assert.match(ambig, /Monitor 27/);
    assert.match(ambig, /Monitor Kantor/);
    assert.equal(ctx.pendingAction, undefined);

    const overWarn = await executeTool(
      "money_propose_add_target_deposit",
      { targetName: "Monitor 27", amount: 400000, sourcePeriod: "2026-10", note: "Sisa uang bulan Oktober" },
      ctx
    );
    assert.match(overWarn, /melebihi/i);
    assert.equal(ctx.pendingAction.kind, "add_target_deposit");
    assert.equal(ctx.pendingAction.payload.targetId, "TGT-001");

    const dupCreate = await executeTool("money_propose_create_target", { name: "monitor 27", targetAmount: 1000000 }, ctx);
    assert.match(dupCreate, /sudah ada/i);

    const okCreate = await executeTool("money_propose_create_target", { name: "SSD NVMe", targetAmount: 1500000, note: "1TB" }, ctx);
    assert.match(okCreate, /SSD NVMe/);
    assert.equal(ctx.pendingAction.kind, "create_target");

    const okUpdate = await executeTool("money_propose_update_target", { targetId: "TGT-002", patch: { status: "Ditunda" } }, ctx);
    assert.match(okUpdate, /Ditunda/);
    assert.equal(ctx.pendingAction.kind, "update_target");
    assert.equal(ctx.pendingAction.payload.expected.name, "Monitor Kantor");

    const okDeleteLog = await executeTool("money_propose_delete_target_log", { logId: "LOG-001" }, ctx);
    assert.match(okDeleteLog, /LOG-001/);
    assert.equal(ctx.pendingAction.kind, "delete_target_log");
    assert.equal(ctx.pendingAction.payload.rowNumber, 2);
    assert.equal(mutated, false);
  } finally {
    db.end();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tools.test.js`
Expected: FAIL (`missing tool money_list_targets`).

- [ ] **Step 3: Create `src/tools/targets.js` and wire into `src/tools.js`**

Create `src/tools/targets.js` implementing `targetTools` and `executeTargetTool(name, args, context)`, then import and merge `targetTools` / `executeTargetTool` in `src/tools.js` inside `tools` and `executeTool`'s `default` branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tools.test.js`
Expected: PASS.

---

### Task 4: `/target` Command, Chat Rules, Docs & Full Verification

**Files:**
- Modify: `src/handlers/money.js` (add 7 tool names to `MONEY_TOOL_NAMES` + add `bot.command("target", ...)` + export `handleTargetCommand` helper for unit testing)
- Modify: `src/handlers/menu.js:13-25` (add `target` to `BOT_COMMANDS`)
- Modify: `src/handlers/messages.js:139-141` (add target/surplus instructions)
- Modify: `SOUL.md:19-22` (add target & surplus behavior rules)
- Modify: `AGENTS.md`, `README.md` (document `/target`, `Targets` & `TargetLogs` tabs, and redeploy note for `MoneyTracker.gs`)
- Test: `test/handlers-money.test.js`, `test/handlers-menu.test.js`

- [ ] **Step 1: Write failing tests in `test/handlers-money.test.js` and `test/handlers-menu.test.js`**

Add to `test/handlers-menu.test.js`:
- Assert `names.includes("target")` in `BOT_COMMANDS`.

Add to `test/handlers-money.test.js`:
- Test `handleTargetCommand` with empty input (reads `sheetsService.listTargets()` directly and replies with formatted progress bars) and with arguments (calls `callAI` with `moneyTools` including `money_propose_create_target` and passes `pendingAction` confirmation keyboard).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/handlers-money.test.js test/handlers-menu.test.js`
Expected: FAIL (`handleTargetCommand` not defined / missing `"target"` in `BOT_COMMANDS`).

- [ ] **Step 3: Implement `/target` handler, prompt updates, and docs**

Update `src/handlers/money.js`, `src/handlers/menu.js`, `src/handlers/messages.js`, `SOUL.md`, `AGENTS.md`, and `README.md`.

- [ ] **Step 4: Run full verification**

Run:
1. `npm test`
2. `Get-ChildItem -Recurse -Filter *.js src,test | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`
Expected: All unit tests pass (0 failures) and all `.js` files pass syntax check.

- [ ] **Step 5: Note post-implementation manual deploy step**

Remind user to copy updated `apps-script/MoneyTracker.gs` into Google Apps Script editor and deploy a **New version** before testing live in Telegram.
