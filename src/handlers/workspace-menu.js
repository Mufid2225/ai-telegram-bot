import path from "node:path";

const HOME_BTN = { text: "« Menu Utama", callback_data: "menu:home" };

function req(svc, name) {
  if (!svc) throw new Error(`Layanan ${name} belum tersedia.`);
  return svc;
}

async function refBtn(workspaceStore, text, payload) {
  const ref = await workspaceStore.createCallbackRef(payload);
  return { text: String(text).slice(0, 48), callback_data: `menu:ws:r:${ref}` };
}

function view(text, keyboard) {
  return {
    text: String(text).slice(0, 4000),
    extra: { reply_markup: { inline_keyboard: keyboard } },
  };
}

function chunkRows(items, size = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

async function trelloBoardsView(trelloService, workspaceStore, includeClosed = false) {
  const boards = await req(trelloService, "Trello").listBoards({ includeClosed });
  if (!boards.length) {
    return view("📋 Tidak ada board Trello yang ditemukan.", [[HOME_BTN]]);
  }
  const btns = await Promise.all(
    boards.slice(0, 14).map((b) =>
      refBtn(workspaceStore, `${b.closed ? "📦 " : ""}${b.name}`, { p: "tr", k: "b", id: b.id, pg: 0 })
    )
  );
  const keyboard = chunkRows(btns, 1);
  keyboard.push([
    { text: includeClosed ? "📂 Board Aktif Saja" : "📦 Tampilkan Arsip", callback_data: includeClosed ? "menu:ws:trello" : "menu:ws:trello:all" },
    HOME_BTN,
  ]);
  return view(`📋 Pilih Board Trello (${boards.length}):\n\nKlik salah satu board untuk melihat status list terbaru:`, keyboard);
}

async function trelloBoardOverviewView(trelloService, workspaceStore, userId, { id, pg = 0 }) {
  const ov = await req(trelloService, "Trello").getBoardOverview(id, { page: pg, pageSize: 10 });
  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "trello",
      sourceId: ov.board.id,
      sourceName: ov.board.name,
      extra: { totalOpenCards: ov.totalOpenCards, totalLists: ov.totalLists },
    });
  }

  const listLines = ov.lists.map(
    (l) => `• ${l.name}${l.duplicate ? ` [..${l.id.slice(-4)}]` : ""} (${l.cardCount} card)`
  ).join("\n") || "- (Belum ada list)";

  const recentLines = ov.recentCards.length
    ? "\n\n🕒 Aktivitas Terbaru:\n" + ov.recentCards.map((c) => `- ${c.name} [${c.listName}]`).join("\n")
    : "";

  const hint =
    `\n\n💡 Aktif di ${ov.board.name}. Silakan ketik perintah langsung di chat, misal:\n` +
    `- "cari card tentang ..."\n` +
    `- "pindah card <judul> ke list <tujuan>"\n` +
    `- "tambah card <judul> ke list <tujuan>"`;

  const nav = [];
  if (ov.page > 0) nav.push(await refBtn(workspaceStore, "« List Sebelumnya", { p: "tr", k: "b", id, pg: ov.page - 1 }));
  if (ov.page + 1 < ov.totalPages) nav.push(await refBtn(workspaceStore, "List Berikutnya »", { p: "tr", k: "b", id, pg: ov.page + 1 }));

  const keyboard = [];
  if (nav.length) keyboard.push(nav);
  keyboard.push([
    await refBtn(workspaceStore, "🔍 Intip Isi List", { p: "tr", k: "lp", id, pg: 0 }),
    await refBtn(workspaceStore, "🔄 Refresh", { p: "tr", k: "b", id, pg: ov.page }),
  ]);
  keyboard.push([{ text: "« Ganti Board", callback_data: "menu:ws:trello" }, HOME_BTN]);

  return view(
    `📋 ${ov.board.name}\n📊 ${ov.totalOpenCards} card aktif • ${ov.totalLists} list (Hal ${ov.page + 1}/${ov.totalPages})\n\n📂 Daftar List:\n${listLines}${recentLines}${hint}`,
    keyboard
  );
}

async function trelloListPickerView(trelloService, workspaceStore, { id, pg = 0 }) {
  const ov = await req(trelloService, "Trello").getBoardOverview(id, { page: pg, pageSize: 8 });
  const btns = await Promise.all(
    ov.lists.map((l) =>
      refBtn(workspaceStore, `${l.name} (${l.cardCount})`, { p: "tr", k: "l", id: l.id, bid: id, ln: l.name, pg: 0 })
    )
  );
  const keyboard = chunkRows(btns, 2);
  const nav = [];
  if (ov.page > 0) nav.push(await refBtn(workspaceStore, "« Sebelumnya", { p: "tr", k: "lp", id, pg: ov.page - 1 }));
  if (ov.page + 1 < ov.totalPages) nav.push(await refBtn(workspaceStore, "Berikutnya »", { p: "tr", k: "lp", id, pg: ov.page + 1 }));
  if (nav.length) keyboard.push(nav);
  keyboard.push([await refBtn(workspaceStore, "« Kembali ke Board", { p: "tr", k: "b", id, pg: 0 }), HOME_BTN]);
  return view(`🔍 Pilih List di ${ov.board.name} (Hal ${ov.page + 1}/${ov.totalPages}):`, keyboard);
}

async function trelloListCardsView(trelloService, workspaceStore, { id, bid, ln, pg = 0 }) {
  const data = await req(trelloService, "Trello").listCardsInList(id, { page: pg, pageSize: 8 });
  const lines = data.cards.length
    ? data.cards.map((c, idx) => `${pg * 8 + idx + 1}. ${c.name}`).join("\n")
    : "Belum ada card di list ini.";
  const nav = [];
  if (data.page > 0) nav.push(await refBtn(workspaceStore, "« Sebelumnya", { p: "tr", k: "l", id, bid, ln, pg: data.page - 1 }));
  if (data.page + 1 < data.totalPages) nav.push(await refBtn(workspaceStore, "Berikutnya »", { p: "tr", k: "l", id, bid, ln, pg: data.page + 1 }));
  const keyboard = [];
  if (nav.length) keyboard.push(nav);
  keyboard.push([
    await refBtn(workspaceStore, "« Daftar List", { p: "tr", k: "lp", id: bid, pg: 0 }),
    await refBtn(workspaceStore, "« Board", { p: "tr", k: "b", id: bid, pg: 0 }),
  ]);
  return view(`📌 List ${ln} (${data.totalCards} card • Hal ${data.page + 1}/${data.totalPages}):\n\n${lines}`, keyboard);
}

async function notionSourcesView(notionService, workspaceStore) {
  const { databases, pages } = await req(notionService, "Notion").listConnectedSources();
  const btns = [];
  for (const d of databases.slice(0, 10)) {
    btns.push([await refBtn(workspaceStore, `🗄️ ${d.title}`, { p: "nt", k: "d", id: d.id })]);
  }
  for (const p of pages.slice(0, 6)) {
    btns.push([await refBtn(workspaceStore, `📄 ${p.title}`, { p: "nt", k: "p", id: p.id })]);
  }
  if (!btns.length) {
    return view(
      "📓 Belum ada database atau halaman Notion yang terhubung.\nPastikan di Notion sudah klik ... -> Connections -> Connect to Opencode.",
      [[HOME_BTN]]
    );
  }
  btns.push([HOME_BTN]);
  return view(`📓 Sumber Notion Terhubung (${databases.length} DB, ${pages.length} root page):`, btns);
}

async function notionDatabaseView(notionService, workspaceStore, userId, { id, cur }) {
  const svc = req(notionService, "Notion");
  const ov = await svc.getDatabaseOverview(id, { pageSize: 6 });
  const rowsData = cur ? await svc.queryDatabase(id, { startCursor: cur, pageSize: 6 }) : null;
  const rows = rowsData ? rowsData.rows : ov.rows;
  const nextCursor = rowsData ? rowsData.nextCursor : ov.nextCursor;
  const hasMore = rowsData ? rowsData.hasMore : ov.hasMore;

  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "notion",
      sourceId: id,
      sourceName: ov.title,
      extra: { kind: "database" },
    });
  }

  const schemaText = ov.schema.slice(0, 10).map((s) => `• ${s.name} (${s.type})`).join("\n");
  const rowText = rows.length
    ? rows.map((r, i) => `${i + 1}. ${r.title}${Object.entries(r.fields).length ? ` — ${Object.entries(r.fields).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" | ")}` : ""}`).join("\n")
    : "Belum ada baris.";

  const nav = [];
  if (cur) nav.push(await refBtn(workspaceStore, "« Awal", { p: "nt", k: "d", id }));
  if (hasMore && nextCursor) nav.push(await refBtn(workspaceStore, "Berikutnya »", { p: "nt", k: "d", id, cur: nextCursor }));

  const keyboard = [];
  if (nav.length) keyboard.push(nav);
  keyboard.push([
    await refBtn(workspaceStore, "🔄 Refresh", { p: "nt", k: "d", id }),
    { text: "« Ganti Notion", callback_data: "menu:ws:notion" },
  ]);
  keyboard.push([HOME_BTN]);

  return view(
    `📓 ${ov.title}\n\n🗂️ Properti (${ov.schema.length}):\n${schemaText}\n\n📋 Data Terbaru:\n${rowText}\n\n💡 Aktif di ${ov.title}. Ketik perintah untuk cari, tambah, atau update baris (selalu lewat konfirmasi).`,
    keyboard
  );
}

async function notionPageView(notionService, workspaceStore, userId, { id }) {
  const pv = await req(notionService, "Notion").getPagePreview(id);
  if (workspaceStore) {
    await workspaceStore.setActiveContext({ userId, platform: "notion", sourceId: id, sourceName: pv.title, extra: { kind: "page" } });
  }
  const body = pv.lines.length ? pv.lines.join("\n") : "(Halaman kosong atau hanya berisi child database)";
  return view(`📄 ${pv.title}\n\n${body}`, [
    [{ text: "« Ganti Notion", callback_data: "menu:ws:notion" }, HOME_BTN],
  ]);
}

async function superhumanDocsView(superhumanService, workspaceStore) {
  const docs = await req(superhumanService, "Superhuman Docs").listDocs();
  if (!docs.length) return view("📄 Tidak ada dokumen Superhuman Docs yang tersedia.", [[HOME_BTN]]);
  const btns = await Promise.all(docs.slice(0, 12).map((d) => refBtn(workspaceStore, `📄 ${d.name}`, { p: "sh", k: "d", id: d.id })));
  const keyboard = chunkRows(btns, 1);
  keyboard.push([HOME_BTN]);
  return view(`📄 Pilih Dokumen Superhuman Docs (${docs.length}):`, keyboard);
}

async function superhumanDocView(superhumanService, workspaceStore, userId, { id }) {
  const ov = await req(superhumanService, "Superhuman Docs").getDocOverview(id);
  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "superhuman",
      sourceId: ov.doc.id,
      sourceName: ov.doc.name,
      extra: { canWrite: ov.canWrite },
    });
  }

  const pageLines = ov.pages.slice(0, 10).map((p) => `• ${p.name}`).join("\n") || "-";
  const tableBtns = await Promise.all(
    ov.tables.slice(0, 8).map((t) =>
      refBtn(workspaceStore, `📊 ${t.name}`, { p: "sh", k: "t", did: ov.doc.id, dn: ov.doc.name, id: t.id, tn: t.name })
    )
  );
  const keyboard = chunkRows(tableBtns, 2);
  keyboard.push([
    await refBtn(workspaceStore, "🔄 Refresh", { p: "sh", k: "d", id }),
    { text: "« Ganti Doc", callback_data: "menu:ws:superhuman" },
  ]);
  keyboard.push([HOME_BTN]);

  return view(
    `📄 ${ov.doc.name}\n🔐 Akses: ${ov.canWrite ? "Baca & Tulis" : "Read-Only"}\n\n📑 Halaman (${ov.pages.length}):\n${pageLines}\n\n📊 Klik tabel di bawah untuk melihat isinya, atau langsung ketik perintah di chat:`,
    keyboard
  );
}

async function superhumanTableView(superhumanService, workspaceStore, userId, { did, dn, id, tn, pt }) {
  const ov = await req(superhumanService, "Superhuman Docs").getTableOverview(did, id, { limit: 8, pageToken: pt });
  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "superhuman",
      sourceId: did,
      sourceName: dn || did,
      extra: { tableId: id, tableName: tn },
    });
  }

  const cols = ov.columns.map((c) => c.name).join(", ");
  const rowsText = ov.rows.length
    ? ov.rows.map((r, i) => `${i + 1}. ${r.name || Object.values(r.values)[0] || r.id} — ${Object.entries(r.values).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" | ")}`).join("\n")
    : "Tabel masih kosong.";

  const keyboard = [];
  if (ov.nextPageToken) {
    keyboard.push([await refBtn(workspaceStore, "Baris Berikutnya »", { p: "sh", k: "t", did, dn, id, tn, pt: ov.nextPageToken })]);
  }
  keyboard.push([
    await refBtn(workspaceStore, "« Kembali ke Doc", { p: "sh", k: "d", id: did }),
    HOME_BTN,
  ]);
  return view(`📊 Tabel ${tn || id} (${dn})\nKolom: ${cols}\n\n${rowsText}`, keyboard);
}

async function kbDirView(kbService, workspaceStore, userId, { dir = "", pg = 0 }) {
  const listing = await req(kbService, "Knowledge Base").listDirectory(dir, { page: pg, pageSize: 10 });
  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "kb",
      sourceId: listing.currentDir || "/",
      sourceName: listing.currentDir || "Knowledge Base Root",
      extra: { readOnly: true },
    });
  }

  const btns = await Promise.all(
    listing.items.map((item) =>
      item.type === "dir"
        ? refBtn(workspaceStore, `📁 ${item.name}`, { p: "kb", k: "dir", dir: item.path, pg: 0 })
        : refBtn(workspaceStore, `📝 ${item.name}`, { p: "kb", k: "rd", path: item.path, s: 1 })
    )
  );
  const keyboard = chunkRows(btns, 2);
  const nav = [];
  if (listing.page > 0) nav.push(await refBtn(workspaceStore, "« Sebelumnya", { p: "kb", k: "dir", dir, pg: listing.page - 1 }));
  if (listing.page + 1 < listing.totalPages) nav.push(await refBtn(workspaceStore, "Berikutnya »", { p: "kb", k: "dir", dir, pg: listing.page + 1 }));
  if (nav.length) keyboard.push(nav);

  const bottom = [];
  if (listing.currentDir) {
    const parent = path.posix.dirname(listing.currentDir);
    bottom.push(await refBtn(workspaceStore, "⬆️ Folder Atas", { p: "kb", k: "dir", dir: parent === "." ? "" : parent, pg: 0 }));
  }
  bottom.push(HOME_BTN);
  keyboard.push(bottom);

  return view(
    `🧠 Knowledge Base (Read-Only)\n📂 Lokasi: /${listing.currentDir || ""} (Hal ${listing.page + 1}/${listing.totalPages})\n\nKlik folder/catatan untuk membaca, atau ketik pertanyaan di chat untuk mencari isi vault:`,
    keyboard
  );
}

async function kbReadView(kbService, workspaceStore, userId, { path: notePath, s = 1 }) {
  const note = await req(kbService, "Knowledge Base").readNote(notePath, { startLine: s, maxLines: 45 });
  if (workspaceStore) {
    await workspaceStore.setActiveContext({ userId, platform: "kb", sourceId: note.path, sourceName: note.path, extra: { readOnly: true } });
  }
  const nav = [];
  if (note.startLine > 1) {
    nav.push(await refBtn(workspaceStore, "⬆️ Sebelumnya", { p: "kb", k: "rd", path: note.path, s: Math.max(1, note.startLine - 45) }));
  }
  if (note.hasMore) {
    nav.push(await refBtn(workspaceStore, "⬇️ Lanjut Baca", { p: "kb", k: "rd", path: note.path, s: note.nextStartLine }));
  }
  const folder = path.posix.dirname(note.path);
  const keyboard = [];
  if (nav.length) keyboard.push(nav);
  keyboard.push([
    await refBtn(workspaceStore, "« Kembali ke Folder", { p: "kb", k: "dir", dir: folder === "." ? "" : folder, pg: 0 }),
    HOME_BTN,
  ]);
  return view(`📝 ${note.path} (Baris ${note.startLine}-${note.endLine}/${note.totalLines})\n\n${note.text}`, keyboard);
}

function formatAgendaEventLine(ev) {
  if (ev.isAllDay) {
    return `• [${ev.startIso} • Seharian] ${ev.title}${ev.location ? ` (${ev.location})` : ""}`;
  }
  const s = new Date(ev.startIso);
  const e = new Date(ev.endIso);
  const dayLabel = s.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
  const tStart = s.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const tEnd = e.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `• ${dayLabel} ${tStart}-${tEnd} — ${ev.title}${ev.location ? ` (${ev.location})` : ""}`;
}

async function calendarEventsView(calendarService, workspaceStore, userId, { cid = "primary", cn = "Kalender Utama", days = 7 } = {}) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(start.getTime() + Number(days) * 86400000);

  const events = await req(calendarService, "Google Calendar").listEvents({
    calendarId: cid,
    includeAllOwned: cid === "primary",
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    limit: 20,
  });

  if (workspaceStore) {
    await workspaceStore.setActiveContext({
      userId,
      platform: "calendar",
      sourceId: cid,
      sourceName: cn,
      extra: { days },
    });
  }

  const rangeLabel = days === 1 ? "Hari Ini" : `${days} Hari ke Depan`;
  const listText = events.length
    ? events.map(formatAgendaEventLine).join("\n")
    : "📭 Tidak ada jadwal pada rentang waktu ini.";

  const hint =
    `\n\n💡 Aktif di Google Calendar (${cn}). Ketik perintah langsung di chat, misal:\n` +
    `- "besok jam 13.00-14.30 jadwalin bimbingan TA"\n` +
    `- "hari Jumat aku kosong jam berapa?"\n` +
    `(Semua tambah/ubah/hapus jadwal wajib konfirmasi Simpan/Batal)`;

  const keyboard = [
    [
      await refBtn(workspaceStore, "📌 Hari Ini", { p: "cal", k: "ev", cid, cn, days: 1 }),
      await refBtn(workspaceStore, "🗓️ 7 Hari", { p: "cal", k: "ev", cid, cn, days: 7 }),
      await refBtn(workspaceStore, "📅 30 Hari", { p: "cal", k: "ev", cid, cn, days: 30 }),
    ],
    [
      await refBtn(workspaceStore, "🗂️ Pilih Kalender", { p: "cal", k: "pick" }),
      await refBtn(workspaceStore, "🔄 Refresh", { p: "cal", k: "ev", cid, cn, days }),
    ],
    [HOME_BTN],
  ];

  return view(`📅 Google Calendar — ${cn}\n🕒 Rentang: ${rangeLabel} (${events.length} agenda)\n\n${listText}${hint}`, keyboard);
}

async function calendarPickerView(calendarService, workspaceStore) {
  const calendars = await req(calendarService, "Google Calendar").listCalendars();
  const owned = calendars.filter((c) => c.isOwnedByMe || c.isPrimary);
  const btns = await Promise.all(
    owned.slice(0, 12).map((c) =>
      refBtn(workspaceStore, `${c.isPrimary ? "⭐ " : "📅 "}${c.name}`, { p: "cal", k: "ev", cid: c.id, cn: c.name, days: 7 })
    )
  );
  const keyboard = chunkRows(btns, 1);
  keyboard.push([
    await refBtn(workspaceStore, "« Semua Kalender Utama", { p: "cal", k: "ev", cid: "primary", cn: "Kalender Utama", days: 7 }),
    HOME_BTN,
  ]);
  return view(`🗂️ Pilih Kalender Google (${owned.length}):\n\nPilih kalender spesifik atau gunakan Kalender Utama:`, keyboard);
}

/**
 * Dispatch workspace & Knowledge Base inline menu actions.
 */
export async function handleWorkspaceMenuAction({
  action,
  userId,
  workspaceStore,
  trelloService,
  notionService,
  superhumanService,
  kbService,
  calendarService,
}) {
  if (action === "ws:trello") return trelloBoardsView(trelloService, workspaceStore, false);
  if (action === "ws:trello:all") return trelloBoardsView(trelloService, workspaceStore, true);
  if (action === "ws:notion") return notionSourcesView(notionService, workspaceStore);
  if (action === "ws:superhuman") return superhumanDocsView(superhumanService, workspaceStore);
  if (action === "ws:kb") return kbDirView(kbService, workspaceStore, userId, { dir: "", pg: 0 });
  if (action === "ws:calendar") return calendarEventsView(calendarService, workspaceStore, userId, { cid: "primary", cn: "Kalender Utama", days: 7 });

  if (action.startsWith("ws:r:")) {
    const ref = action.slice(5);
    const payload = workspaceStore ? await workspaceStore.resolveCallbackRef(ref) : null;
    if (!payload) {
      return view("⚠️ Tombol menu ini sudah kedaluwarsa atau tidak ditemukan. Silakan muat ulang dari menu utama:", [[HOME_BTN]]);
    }
    if (payload.p === "tr") {
      if (payload.k === "b") return trelloBoardOverviewView(trelloService, workspaceStore, userId, payload);
      if (payload.k === "lp") return trelloListPickerView(trelloService, workspaceStore, payload);
      if (payload.k === "l") return trelloListCardsView(trelloService, workspaceStore, payload);
    }
    if (payload.p === "nt") {
      if (payload.k === "d") return notionDatabaseView(notionService, workspaceStore, userId, payload);
      if (payload.k === "p") return notionPageView(notionService, workspaceStore, userId, payload);
    }
    if (payload.p === "sh") {
      if (payload.k === "d") return superhumanDocView(superhumanService, workspaceStore, userId, payload);
      if (payload.k === "t") return superhumanTableView(superhumanService, workspaceStore, userId, payload);
    }
    if (payload.p === "kb") {
      if (payload.k === "dir") return kbDirView(kbService, workspaceStore, userId, payload);
      if (payload.k === "rd") return kbReadView(kbService, workspaceStore, userId, payload);
    }
    if (payload.p === "cal") {
      if (payload.k === "ev") return calendarEventsView(calendarService, workspaceStore, userId, payload);
      if (payload.k === "pick") return calendarPickerView(calendarService, workspaceStore);
    }
  }

  return view("Menu workspace tidak dikenali.", [[HOME_BTN]]);
}
