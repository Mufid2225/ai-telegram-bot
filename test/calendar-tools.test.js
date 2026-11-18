import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createPendingActionsStore } from "../src/services/pending.js";
import { tools, executeTool } from "../src/tools.js";

test("calendar tools enforce timezone offsets, detect schedule conflicts, disambiguate duplicates, and never write directly", async () => {
  const names = new Set(tools.map((t) => t.function.name));
  for (const required of [
    "calendar_list_calendars",
    "calendar_list_events",
    "calendar_propose_create_event",
    "calendar_propose_update_event",
    "calendar_propose_delete_event",
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`);
  }

  const db = createDatabase(":memory:", { quiet: true });
  try {
    const pendingStore = createPendingActionsStore(db);
    let directWriteCalled = false;

    const calendarService = {
      listCalendars: async () => [
        { id: "primary", name: "Kalender Utama", isPrimary: true, isOwnedByMe: true },
        { id: "cal_holiday", name: "Hari Libur", isPrimary: false, isOwnedByMe: false },
      ],
      listEvents: async ({ query }) => {
        if (query === "rapat") {
          return [
            { id: "e1", calendarId: "primary", calendarName: "Kalender Utama", title: "Rapat Tim Web", startIso: "2026-11-19T13:00:00+07:00", endIso: "2026-11-19T14:00:00+07:00", isAllDay: false },
            { id: "e2", calendarId: "primary", calendarName: "Kalender Utama", title: "Rapat Dosen", startIso: "2026-11-20T10:00:00+07:00", endIso: "2026-11-20T11:00:00+07:00", isAllDay: false },
          ];
        }
        if (query === "bimbingan") {
          return [
            { id: "e3", calendarId: "primary", calendarName: "Kalender Utama", title: "Bimbingan TA", startIso: "2026-11-19T10:00:00+07:00", endIso: "2026-11-19T11:00:00+07:00", isAllDay: false },
          ];
        }
        return [
          { id: "e_clash", calendarId: "primary", calendarName: "Kalender Utama", title: "Kuliah RPL", startIso: "2026-11-19T09:30:00+07:00", endIso: "2026-11-19T11:00:00+07:00", isAllDay: false },
        ];
      },
      createEvent: async () => { directWriteCalled = true; },
      updateEvent: async () => { directWriteCalled = true; },
      deleteEvent: async () => { directWriteCalled = true; },
    };

    const ctx = { userId: "123", pool: db, pendingStore, calendarService };

    const missingOffset = await executeTool(
      "calendar_propose_create_event",
      { title: "Meeting", startIso: "2026-11-19T10:00:00", endIso: "2026-11-19T11:00:00" },
      ctx
    );
    assert.match(missingOffset, /timezone offset/i);
    assert.equal(ctx.pendingAction, undefined);

    const readOnlyCal = await executeTool(
      "calendar_propose_create_event",
      { calendarName: "Hari Libur", title: "Cuti", isAllDay: true, date: "2026-11-20" },
      ctx
    );
    assert.match(readOnlyCal, /read-only/i);
    assert.equal(ctx.pendingAction, undefined);

    const createOut = await executeTool(
      "calendar_propose_create_event",
      { title: "Bimbingan Bab 4", startIso: "2026-11-19T10:00:00+07:00", endIso: "2026-11-19T11:00:00+07:00", location: "Gedung TI" },
      ctx
    );
    assert.equal(directWriteCalled, false);
    assert.equal(ctx.pendingAction?.kind, "calendar_create_event");
    assert.match(createOut, /Bentrok[\s\S]*Kuliah RPL/i);

    ctx.pendingAction = undefined;
    const ambigDel = await executeTool(
      "calendar_propose_delete_event",
      { eventQuery: "rapat", windowStartIso: "2026-11-18T00:00:00+07:00", windowEndIso: "2026-11-25T00:00:00+07:00" },
      ctx
    );
    assert.match(ambigDel, /lebih dari 1 jadwal/i);
    assert.equal(ctx.pendingAction, undefined);

    const delOut = await executeTool(
      "calendar_propose_delete_event",
      { eventQuery: "bimbingan", windowStartIso: "2026-11-18T00:00:00+07:00", windowEndIso: "2026-11-25T00:00:00+07:00" },
      ctx
    );
    assert.match(delOut, /Draft Hapus Jadwal/);
    assert.equal(ctx.pendingAction?.kind, "calendar_delete_event");
    assert.equal(ctx.pendingAction?.payload.expectedTitle, "Bimbingan TA");
    assert.equal(directWriteCalled, false);
  } finally {
    db.end();
  }
});
