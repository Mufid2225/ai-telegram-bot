const OFFSET_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

export const calendarTools = [
  fnTool(
    "calendar_list_calendars",
    "List accessible Google Calendars (Primary Calendar and owned/subscribed sub-calendars)",
    {}
  ),
  fnTool(
    "calendar_list_events",
    "Read live Google Calendar events in a date/time window. Always call get_current_time first when resolving relative dates like hari ini, besok, minggu ini.",
    {
      startIso: { type: "string", description: "Start ISO-8601 timestamp with timezone offset (e.g. '2026-11-18T00:00:00+07:00')" },
      endIso: { type: "string", description: "End ISO-8601 timestamp with timezone offset (max 90 days after startIso)" },
      calendarId: { type: "string", description: "Optional calendarId (defaults to 'primary')" },
      includeAllOwned: { type: "boolean", description: "True to merge events across all owned calendars (default true when calendarId is primary)" },
      query: { type: "string", description: "Optional keyword filter on title/location/description" },
      limit: { type: "integer", description: "Max events to return (default 25)" },
    },
    ["startIso", "endIso"]
  ),
  fnTool(
    "calendar_propose_create_event",
    "Create a strict confirmation draft to add a Google Calendar event. NEVER writes directly; user must click Simpan. Do NOT guess missing dates or start times — ask the user first.",
    {
      title: { type: "string", description: "Event title" },
      isAllDay: { type: "boolean", description: "True for all-day event (uses date/endDate instead of startIso/endIso)" },
      startIso: { type: "string", description: "Start ISO-8601 with explicit timezone offset (e.g. '2026-11-19T10:00:00+07:00')" },
      endIso: { type: "string", description: "End ISO-8601 with explicit timezone offset (must be > startIso)" },
      date: { type: "string", description: "YYYY-MM-DD when isAllDay=true" },
      endDate: { type: "string", description: "Optional exclusive end YYYY-MM-DD for multi-day all-day event" },
      location: { type: "string" },
      description: { type: "string" },
      calendarId: { type: "string" },
      calendarName: { type: "string" },
    },
    ["title"]
  ),
  fnTool(
    "calendar_propose_update_event",
    "Create a strict confirmation draft to reschedule or edit an existing Google Calendar event. Refuses ambiguous matches.",
    {
      eventId: { type: "string", description: "Exact event ID if already known from calendar_list_events" },
      eventQuery: { type: "string", description: "Event title search text if eventId is not yet known" },
      windowStartIso: { type: "string", description: "Search start ISO-8601 with offset" },
      windowEndIso: { type: "string", description: "Search end ISO-8601 with offset" },
      calendarId: { type: "string" },
      calendarName: { type: "string" },
      patch: {
        type: "object",
        properties: {
          title: { type: "string" },
          isAllDay: { type: "boolean" },
          startIso: { type: "string" },
          endIso: { type: "string" },
          date: { type: "string" },
          endDate: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    ["patch"]
  ),
  fnTool(
    "calendar_propose_delete_event",
    "Create a strict confirmation draft to delete a Google Calendar event. Refuses ambiguous matches.",
    {
      eventId: { type: "string" },
      eventQuery: { type: "string" },
      windowStartIso: { type: "string" },
      windowEndIso: { type: "string" },
      calendarId: { type: "string" },
      calendarName: { type: "string" },
    }
  ),
];

function reqCalendar(ctx) {
  if (!ctx?.calendarService) throw new Error("Layanan Google Calendar belum tersedia.");
  return ctx.calendarService;
}

function validateTimedRange(startIso, endIso) {
  const s = String(startIso || "").trim();
  const e = String(endIso || "").trim();
  if (!OFFSET_ISO_RE.test(s) || !OFFSET_ISO_RE.test(e)) {
    throw new Error("startIso dan endIso wajib berformat ISO-8601 lengkap dengan timezone offset (contoh: 2026-11-19T10:00:00+07:00).");
  }
  const sMs = Date.parse(s);
  const eMs = Date.parse(e);
  if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs <= sMs) {
    throw new Error("Jam selesai harus lebih besar dari jam mulai.");
  }
  return { startIso: s, endIso: e, sMs, eMs };
}

function formatReadableEventTime(ev) {
  if (ev.isAllDay) {
    const d = ev.date || ev.startIso;
    return `Seharian (${d}${ev.endDate && ev.endDate !== d ? ` s/d ${ev.endDate}` : ""})`;
  }
  const start = new Date(ev.startIso);
  const end = new Date(ev.endIso);
  const dateStr = start.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const sTime = start.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const eTime = end.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr}, ${sTime} - ${eTime}`;
}

async function resolveTargetCalendar(args, ctx, requireWritable = false) {
  const svc = reqCalendar(ctx);
  if (!args.calendarId && !args.calendarName) {
    const active = ctx?.workspaceStore ? await ctx.workspaceStore.getActiveContext(ctx.userId) : null;
    if (active?.platform === "calendar" && active.sourceId && active.sourceId !== "all_owned") {
      return { id: active.sourceId, name: active.sourceName || "Kalender Utama", isPrimary: active.sourceId === "primary", isOwnedByMe: true };
    }
    return { id: "primary", name: "Kalender Utama", isPrimary: true, isOwnedByMe: true };
  }

  const calendars = await svc.listCalendars();
  let hit = null;
  if (args.calendarId) {
    hit = calendars.find((c) => c.id === args.calendarId) || (args.calendarId === "primary" ? { id: "primary", name: "Kalender Utama", isPrimary: true, isOwnedByMe: true } : null);
  } else if (args.calendarName) {
    const q = String(args.calendarName).trim().toLowerCase();
    hit = calendars.find((c) => c.name.toLowerCase() === q) || calendars.find((c) => c.name.toLowerCase().includes(q));
  }
  if (!hit) {
    throw new Error(`Kalender tidak ditemukan. Pilihan kalender: ${calendars.map((c) => c.name).join(", ")}`);
  }
  if (requireWritable && !hit.isOwnedByMe && !hit.isPrimary) {
    throw new Error(`Kalender "${hit.name}" bersifat read-only dan tidak dapat diubah.`);
  }
  return hit;
}

async function resolveSingleEvent(svc, cal, args) {
  const now = Date.now();
  const windowStartIso = args.windowStartIso || new Date(now - 2 * 86400000).toISOString();
  const windowEndIso = args.windowEndIso || new Date(now + 45 * 86400000).toISOString();

  const events = await svc.listEvents({
    calendarId: cal.id,
    includeAllOwned: cal.id === "primary" && !args.calendarId,
    startIso: windowStartIso,
    endIso: windowEndIso,
    query: args.eventId ? undefined : args.eventQuery,
    limit: 20,
  });

  if (args.eventId) {
    const exact = events.find((e) => e.id === args.eventId);
    if (!exact) throw new Error(`Jadwal dengan eventId "${args.eventId}" tidak ditemukan pada rentang waktu tersebut.`);
    return { event: exact };
  }

  if (!args.eventQuery) {
    throw new Error("Sebutkan eventId atau kata kunci judul jadwal (eventQuery).");
  }
  if (!events.length) {
    throw new Error(`Jadwal "${args.eventQuery}" tidak ditemukan.`);
  }
  if (events.length > 1) {
    const lines = events.slice(0, 8).map((e) => `- ${e.title} (${formatReadableEventTime(e)}) [eventId: ${e.id}, calendarId: ${e.calendarId}]`);
    return {
      ambiguous: `Ditemukan lebih dari 1 jadwal yang cocok dengan "${args.eventQuery}". Tanyakan ke user jadwal mana yang dimaksud:\n${lines.join("\n")}`,
    };
  }
  return { event: events[0] };
}

async function saveCalendarDraft(ctx, kind, payload, summaryText) {
  if (!ctx?.pendingStore) throw new Error("Penyimpanan draft konfirmasi tidak tersedia.");
  const action = await ctx.pendingStore.create({ userId: ctx.userId, kind, payload, summaryText });
  ctx.pendingAction = action;
  return `Draft jadwal berhasil dibuat (ID: ${action.id}). JANGAN anggap sudah tersimpan di Google Calendar — sampaikan ringkasan ini dan minta user klik tombol Simpan atau Batal.\n\n${summaryText}`;
}

export async function executeCalendarTool(name, args = {}, ctx = {}) {
  switch (name) {
    case "calendar_list_calendars": {
      const cals = await reqCalendar(ctx).listCalendars();
      return cals.length
        ? cals.map((c) => `- ${c.name} (id: ${c.id}, ${c.isOwnedByMe || c.isPrimary ? "bisa tulis" : "read-only"})`).join("\n")
        : "Tidak ada kalender ditemukan.";
    }
    case "calendar_list_events": {
      const cal = await resolveTargetCalendar(args, ctx, false);
      const events = await reqCalendar(ctx).listEvents({
        calendarId: cal.id,
        includeAllOwned: args.includeAllOwned !== undefined ? Boolean(args.includeAllOwned) : cal.id === "primary" && !args.calendarId,
        startIso: args.startIso,
        endIso: args.endIso,
        query: args.query || "",
        limit: args.limit || 25,
      });
      if (!events.length) return "Tidak ada jadwal pada rentang waktu tersebut.";
      return events
        .map((e) => `- ${e.title} | ${formatReadableEventTime(e)}${e.location ? ` | Lokasi: ${e.location}` : ""} [Kalender: ${e.calendarName}, eventId: ${e.id}]`)
        .join("\n");
    }
    case "calendar_propose_create_event": {
      const title = String(args.title || "").trim();
      if (!title) throw new Error("Judul jadwal wajib diisi.");
      const cal = await resolveTargetCalendar(args, ctx, true);
      const isAllDay = Boolean(args.isAllDay);
      let payload;
      let clashNote = "";

      if (isAllDay) {
        if (!DATE_ONLY_RE.test(String(args.date || "").trim())) {
          throw new Error("Untuk jadwal seharian (isAllDay=true), isi parameter date dengan format YYYY-MM-DD.");
        }
        payload = {
          calendarId: cal.id,
          calendarName: cal.name,
          title,
          isAllDay: true,
          date: String(args.date).trim(),
          ...(args.endDate ? { endDate: String(args.endDate).trim() } : {}),
          location: String(args.location || "").trim(),
          description: String(args.description || "").trim(),
        };
      } else {
        const { startIso, endIso, sMs, eMs } = validateTimedRange(args.startIso, args.endIso);
        const existing = await reqCalendar(ctx).listEvents({
          calendarId: cal.id,
          includeAllOwned: true,
          startIso,
          endIso,
          limit: 10,
        });
        const clashes = existing.filter((ev) => !ev.isAllDay && Date.parse(ev.startIso) < eMs && Date.parse(ev.endIso) > sMs);
        if (clashes.length) {
          clashNote = `\n\n⚠️ Peringatan Bentrok Jadwal:\n` + clashes.map((c) => `- ${c.title} (${formatReadableEventTime(c)})`).join("\n");
        }
        payload = {
          calendarId: cal.id,
          calendarName: cal.name,
          title,
          isAllDay: false,
          startIso,
          endIso,
          location: String(args.location || "").trim(),
          description: String(args.description || "").trim(),
        };
      }

      const summary =
        `📅 Draft Tambah Jadwal Google Calendar\n` +
        `- Kalender: ${payload.calendarName}\n` +
        `- Acara: ${payload.title}\n` +
        `- Waktu: ${formatReadableEventTime(payload)}` +
        `${payload.location ? `\n- Lokasi: ${payload.location}` : ""}` +
        `${payload.description ? `\n- Catatan: ${payload.description}` : ""}` +
        clashNote;

      return saveCalendarDraft(ctx, "calendar_create_event", payload, summary);
    }
    case "calendar_propose_update_event": {
      const svc = reqCalendar(ctx);
      const cal = await resolveTargetCalendar(args, ctx, true);
      const resolved = await resolveSingleEvent(svc, cal, args);
      if (resolved.ambiguous) return resolved.ambiguous;

      const patch = { ...(args.patch || {}) };
      if (!Object.keys(patch).length) throw new Error("Minimal 1 perubahan di patch wajib diisi.");
      if (patch.startIso || patch.endIso) {
        validateTimedRange(patch.startIso || resolved.event.startIso, patch.endIso || resolved.event.endIso);
        patch.startIso = patch.startIso || resolved.event.startIso;
        patch.endIso = patch.endIso || resolved.event.endIso;
      }

      const payload = {
        calendarId: resolved.event.calendarId || cal.id,
        calendarName: resolved.event.calendarName || cal.name,
        eventId: resolved.event.id,
        expectedTitle: resolved.event.title,
        patch,
      };
      const changes = Object.entries(patch).map(([k, v]) => `- ${k}: ${v}`).join("\n");
      const summary =
        `✏️ Draft Ubah Jadwal Google Calendar\n` +
        `- Kalender: ${payload.calendarName}\n` +
        `- Jadwal Awal: ${resolved.event.title} (${formatReadableEventTime(resolved.event)})\n` +
        `Perubahan:\n${changes}`;

      return saveCalendarDraft(ctx, "calendar_update_event", payload, summary);
    }
    case "calendar_propose_delete_event": {
      const svc = reqCalendar(ctx);
      const cal = await resolveTargetCalendar(args, ctx, true);
      const resolved = await resolveSingleEvent(svc, cal, args);
      if (resolved.ambiguous) return resolved.ambiguous;

      const payload = {
        calendarId: resolved.event.calendarId || cal.id,
        calendarName: resolved.event.calendarName || cal.name,
        eventId: resolved.event.id,
        expectedTitle: resolved.event.title,
        timeLabel: formatReadableEventTime(resolved.event),
      };
      const summary =
        `🗑️ Draft Hapus Jadwal Google Calendar\n` +
        `- Kalender: ${payload.calendarName}\n` +
        `- Acara: ${payload.expectedTitle}\n` +
        `- Waktu: ${payload.timeLabel}`;

      return saveCalendarDraft(ctx, "calendar_delete_event", payload, summary);
    }
    default:
      return null;
  }
}
