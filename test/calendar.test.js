import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarService } from "../src/services/calendar.js";

const cfg = {
  sheetWebhookUrl: "https://script.google.com/macros/s/test_deploy/exec",
  sheetApiSecret: "sec_123",
};

test("calendarService checks configuration cleanly", async () => {
  const unconfigured = createCalendarService({});
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(() => unconfigured.listCalendars(), /SHEET_WEBHOOK_URL/);
});

test("calendarService posts calendar actions to Apps Script webhook and returns data", async () => {
  const sentBodies = [];
  const service = createCalendarService(cfg, async (_url, init) => {
    const body = JSON.parse(init.body);
    sentBodies.push(body);
    if (body.action === "calendar_list_calendars") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: [{ id: "primary", name: "Kalender Utama", isPrimary: true, isOwnedByMe: true, timeZone: "Asia/Jakarta" }],
        }),
        { status: 200 }
      );
    }
    if (body.action === "calendar_list_events") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: [
            {
              id: "ev_1",
              calendarId: "primary",
              calendarName: "Kalender Utama",
              title: "Bimbingan TA",
              startIso: "2026-11-19T10:00:00+07:00",
              endIso: "2026-11-19T11:00:00+07:00",
              isAllDay: false,
              location: "Ruang Dosen",
              description: "",
            },
          ],
        }),
        { status: 200 }
      );
    }
    if (body.action === "calendar_create_event") {
      return new Response(
        JSON.stringify({ ok: true, data: { id: "ev_new", title: body.title, calendarName: "Kalender Utama" } }),
        { status: 200 }
      );
    }
    if (body.action === "calendar_update_event") {
      return new Response(
        JSON.stringify({ ok: true, data: { id: body.eventId, title: body.patch?.title || body.expectedTitle } }),
        { status: 200 }
      );
    }
    if (body.action === "calendar_delete_event") {
      return new Response(JSON.stringify({ ok: true, data: { deleted: true, eventId: body.eventId } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: "Unknown" }), { status: 200 });
  });

  const cals = await service.listCalendars();
  assert.equal(cals[0].id, "primary");

  const events = await service.listEvents({
    startIso: "2026-11-19T00:00:00+07:00",
    endIso: "2026-11-26T00:00:00+07:00",
    includeAllOwned: true,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Bimbingan TA");

  const created = await service.createEvent({
    calendarId: "primary",
    title: "Sprint Review",
    startIso: "2026-11-20T14:00:00+07:00",
    endIso: "2026-11-20T15:00:00+07:00",
  });
  assert.equal(created.id, "ev_new");

  const updated = await service.updateEvent({
    calendarId: "primary",
    eventId: "ev_1",
    expectedTitle: "Bimbingan TA",
    patch: { title: "Bimbingan TA Final" },
  });
  assert.equal(updated.title, "Bimbingan TA Final");

  const deleted = await service.deleteEvent({
    calendarId: "primary",
    eventId: "ev_1",
    expectedTitle: "Bimbingan TA Final",
  });
  assert.equal(deleted.deleted, true);
  assert.equal(sentBodies.every((b) => b.secret === "sec_123"), true);
});
