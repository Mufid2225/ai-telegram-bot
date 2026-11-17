function fnTool(name, description, properties, required = []) {
  const parameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { type: "function", function: { name, description, parameters } };
}

export const workspaceTools = [
  fnTool("trello_list_boards", "List accessible Trello boards (active by default)", {
    includeClosed: { type: "boolean", description: "Include archived/closed boards" },
  }),
  fnTool("trello_get_board_lists", "Get open lists on a Trello board (uses active Trello board if boardId/boardName omitted)", {
    boardId: { type: "string" },
    boardName: { type: "string" },
  }),
  fnTool("trello_search_cards", "Search open cards on a Trello board by title/keyword", {
    boardId: { type: "string" },
    boardName: { type: "string" },
    query: { type: "string" },
    limit: { type: "integer" },
  }, ["query"]),
  fnTool("trello_propose_create_card", "Create a confirmation draft to add a card to a Trello list (never writes directly)", {
    boardId: { type: "string" },
    boardName: { type: "string" },
    listId: { type: "string" },
    listName: { type: "string" },
    name: { type: "string", description: "Card title" },
    desc: { type: "string", description: "Optional card description" },
  }, ["name"]),
  fnTool("trello_propose_move_card", "Create a confirmation draft to move a Trello card to another list (never writes directly)", {
    boardId: { type: "string" },
    boardName: { type: "string" },
    cardId: { type: "string" },
    cardQuery: { type: "string", description: "Title search text if cardId is not yet known" },
    targetListId: { type: "string" },
    targetListName: { type: "string" },
  }),
  fnTool("trello_propose_update_card", "Create a confirmation draft to update or archive (closed=true) a Trello card", {
    boardId: { type: "string" },
    boardName: { type: "string" },
    cardId: { type: "string" },
    cardQuery: { type: "string" },
    name: { type: "string" },
    desc: { type: "string" },
    closed: { type: "boolean", description: "Set true to archive card (no permanent delete)" },
  }),
  fnTool("notion_list_sources", "List connected Notion databases and root pages", {}),
  fnTool("notion_get_database_schema", "Inspect properties and select options of a Notion database", {
    databaseId: { type: "string" },
    databaseName: { type: "string" },
  }),
  fnTool("notion_query_database", "Query/search rows in a Notion database by text", {
    databaseId: { type: "string" },
    databaseName: { type: "string" },
    query: { type: "string" },
    limit: { type: "integer" },
  }),
  fnTool("notion_propose_create_page", "Create a confirmation draft to insert a row/page into a Notion database", {
    databaseId: { type: "string" },
    databaseName: { type: "string" },
    values: { type: "object", description: "Map of exact Notion database property names to values" },
  }, ["values"]),
  fnTool("notion_propose_update_page", "Create a confirmation draft to update or archive a Notion database row/page", {
    databaseId: { type: "string" },
    databaseName: { type: "string" },
    pageId: { type: "string" },
    pageQuery: { type: "string" },
    values: { type: "object" },
    archived: { type: "boolean" },
  }),
  fnTool("superhuman_list_docs", "List accessible Superhuman Docs documents", {}),
  fnTool("superhuman_get_doc_structure", "Read pages, tables, and ACL write status of a Superhuman Doc", {
    docId: { type: "string" },
    docName: { type: "string" },
  }),
  fnTool("superhuman_query_table", "Read columns and search rows in a Superhuman Docs table", {
    docId: { type: "string" },
    docName: { type: "string" },
    tableId: { type: "string" },
    tableName: { type: "string" },
    query: { type: "string" },
    limit: { type: "integer" },
  }),
  fnTool("superhuman_propose_add_row", "Create a confirmation draft to insert a row into a Superhuman Docs table", {
    docId: { type: "string" },
    docName: { type: "string" },
    tableId: { type: "string" },
    tableName: { type: "string" },
    row: { type: "object", description: "Column name -> value map" },
  }, ["row"]),
  fnTool("superhuman_propose_update_row", "Create a confirmation draft to update a row in a Superhuman Docs table", {
    docId: { type: "string" },
    docName: { type: "string" },
    tableId: { type: "string" },
    tableName: { type: "string" },
    rowId: { type: "string" },
    rowQuery: { type: "string" },
    cells: { type: "object" },
  }, ["cells"]),
  fnTool("kb_search", "Search local Knowledge Base notes by keyword (read-only)", {
    query: { type: "string" },
    folder: { type: "string" },
    limit: { type: "integer" },
  }, ["query"]),
  fnTool("kb_read_note", "Read paginated lines from a Knowledge Base Markdown file (read-only)", {
    path: { type: "string", description: "Relative path inside KB (e.g. 'Home.md' or 'Skills/Trello Manager Safe.md')" },
    startLine: { type: "integer" },
    maxLines: { type: "integer" },
  }, ["path"]),
];

function reqService(svc, label) {
  if (!svc) throw new Error(`Layanan ${label} tidak tersedia.`);
  return svc;
}

async function getActiveHint(ctx, platform) {
  if (!ctx?.workspaceStore) return null;
  const active = await ctx.workspaceStore.getActiveContext(ctx.userId);
  return active?.platform === platform ? active : null;
}

function findNamedMatches(items, query, key = "name") {
  const q = String(query || "").trim().toLowerCase();
  const exact = items.filter((item) => String(item[key] || "").trim().toLowerCase() === q);
  if (exact.length) return exact;
  return items.filter((item) => String(item[key] || "").toLowerCase().includes(q));
}

async function resolveTrelloBoard(args, ctx) {
  const svc = reqService(ctx.trelloService, "Trello");
  if (args.boardId) {
    const boards = await svc.listBoards({ includeClosed: true });
    const hit = boards.find((b) => b.id === args.boardId);
    return hit || { id: args.boardId, name: args.boardName || args.boardId };
  }
  if (args.boardName) {
    const boards = await svc.listBoards({ includeClosed: true });
    const matches = findNamedMatches(boards, args.boardName);
    if (!matches.length) throw new Error(`Board "${args.boardName}" tidak ditemukan di Trello.`);
    if (matches.length > 1) throw new Error(`Ada ${matches.length} board cocok "${args.boardName}": ${matches.map((m) => `${m.name} (${m.id})`).join(", ")}. Sebutkan board yang spesifik.`);
    return matches[0];
  }
  const active = await getActiveHint(ctx, "trello");
  if (active) return { id: active.sourceId, name: active.sourceName };
  throw new Error("Tentukan board Trello dulu (buka di /menu -> Trello atau sebut nama board).");
}

function resolveTrelloList(lists, listId, listName, label = "tujuan") {
  if (listId) {
    const hit = lists.find((l) => l.id === listId);
    if (!hit) throw new Error(`List ID "${listId}" tidak ditemukan.`);
    return { list: hit };
  }
  if (!listName) throw new Error(`Nama list ${label} wajib diisi.`);
  const matches = findNamedMatches(lists, listName);
  if (!matches.length) throw new Error(`List "${listName}" tidak ditemukan. List tersedia: ${lists.map((l) => l.name).slice(0, 15).join(", ")}`);
  if (matches.length > 1) {
    return {
      ambiguous: `Ditemukan lebih dari satu list cocok "${listName}". Minta user pilih ID list yang tepat:\n` +
        matches.map((m) => `- ${m.name} (listId: ${m.id})`).join("\n"),
    };
  }
  return { list: matches[0] };
}

async function resolveTrelloCard(svc, boardId, cardId, cardQuery) {
  if (cardId) return { card: { id: cardId, name: cardQuery || cardId, listName: "-" } };
  if (!cardQuery) throw new Error("Sebutkan cardId atau judul card (cardQuery).");
  const hits = await svc.searchCards(boardId, cardQuery, { limit: 6 });
  if (!hits.length) throw new Error(`Card "${cardQuery}" tidak ditemukan di board ini.`);
  if (hits.length > 1) {
    return {
      ambiguous: `Ditemukan lebih dari 1 card mirip "${cardQuery}". Minta user pilih yang dimaksud:\n` +
        hits.map((c) => `- ${c.name} [List: ${c.listName}] (cardId: ${c.id})`).join("\n"),
    };
  }
  return { card: hits[0] };
}

async function resolveNotionDb(args, ctx) {
  const svc = reqService(ctx.notionService, "Notion");
  if (args.databaseId) return { id: args.databaseId, title: args.databaseName || args.databaseId };
  if (args.databaseName) {
    const { databases } = await svc.listConnectedSources();
    const matches = findNamedMatches(databases, args.databaseName, "title");
    if (!matches.length) throw new Error(`Database "${args.databaseName}" tidak ditemukan di Notion (pastikan sudah Connect ke Opencode).`);
    if (matches.length > 1) throw new Error(`Ada ${matches.length} database cocok: ${matches.map((d) => `${d.title} (${d.id})`).join(", ")}.`);
    return matches[0];
  }
  const active = await getActiveHint(ctx, "notion");
  if (active && active.extra?.kind !== "page") return { id: active.sourceId, title: active.sourceName };
  throw new Error("Tentukan database Notion dulu (buka di /menu -> Notion atau sebut nama database).");
}

function validateNotionValues(schema, values) {
  if (!values || !Object.keys(values).length) throw new Error("Minimal 1 properti/field Notion wajib diisi.");
  const byLower = new Map(schema.map((s) => [s.name.toLowerCase(), s]));
  for (const [k, v] of Object.entries(values)) {
    const def = byLower.get(String(k).trim().toLowerCase());
    if (!def) throw new Error(`Kolom Notion "${k}" tidak ada. Kolom tersedia: ${schema.map((s) => s.name).join(", ")}`);
    if ((def.type === "select" || def.type === "status") && def.options.length && v) {
      const ok = def.options.some((o) => o.toLowerCase() === String(v).trim().toLowerCase());
      if (!ok) throw new Error(`Opsi "${v}" tidak valid untuk "${def.name}". Pilihan: ${def.options.join(", ")}`);
    }
  }
}

async function resolveSuperhumanDocAndTable(args, ctx, requireTable = true) {
  const svc = reqService(ctx.superhumanService, "Superhuman Docs");
  let docId = args.docId;
  let docName = args.docName;
  if (!docId && docName) {
    const docs = await svc.listDocs();
    const hits = findNamedMatches(docs, docName);
    if (!hits.length) throw new Error(`Dokumen "${docName}" tidak ditemukan.`);
    docId = hits[0].id;
    docName = hits[0].name;
  } else if (!docId) {
    const active = await getActiveHint(ctx, "superhuman");
    if (active) {
      docId = active.sourceId;
      docName = active.sourceName;
    }
  }
  if (!docId) throw new Error("Tentukan dokumen Superhuman Docs dulu (buka di /menu -> Superhuman Docs).");

  const ov = await svc.getDocOverview(docId);
  docName = ov.doc.name || docName || docId;
  if (!requireTable) return { svc, ov, docId, docName };

  let table = null;
  if (args.tableId) {
    table = ov.tables.find((t) => t.id === args.tableId) || { id: args.tableId, name: args.tableName || args.tableId };
  } else if (args.tableName) {
    const hits = findNamedMatches(ov.tables, args.tableName);
    if (!hits.length) throw new Error(`Tabel "${args.tableName}" tidak ditemukan di ${docName}. Tabel tersedia: ${ov.tables.map((t) => t.name).slice(0, 12).join(", ")}`);
    if (hits.length > 1) throw new Error(`Lebih dari 1 tabel cocok "${args.tableName}": ${hits.map((t) => `${t.name} (${t.id})`).join(", ")}`);
    table = hits[0];
  } else {
    const active = await getActiveHint(ctx, "superhuman");
    if (active?.extra?.tableId) table = { id: active.extra.tableId, name: active.extra.tableName || active.extra.tableId };
  }
  if (!table) throw new Error(`Sebutkan nama/ID tabel di "${docName}". Tabel: ${ov.tables.map((t) => t.name).slice(0, 10).join(", ")}`);
  return { svc, ov, docId, docName, table };
}

export function formatWorkspaceDraftPreview(kind, payload) {
  if (kind === "trello_create_card") {
    return `📝 Draft Tambah Card Trello\n- Board: ${payload.boardName}\n- List: ${payload.listName}\n- Judul: ${payload.name}${payload.desc ? `\n- Deskripsi: ${payload.desc}` : ""}`;
  }
  if (kind === "trello_move_card") {
    return `🔀 Draft Pindah Card Trello\n- Board: ${payload.boardName}\n- Card: ${payload.cardName}\n- Dari List: ${payload.fromListName || "-"}\n- Ke List: ${payload.targetListName}`;
  }
  if (kind === "trello_update_card") {
    const actionLabel = payload.closed ? "Arsipkan Card" : "Update Card";
    return `✏️ Draft ${actionLabel} Trello\n- Board: ${payload.boardName}\n- Card: ${payload.cardName}${payload.name ? `\n- Judul baru: ${payload.name}` : ""}${payload.desc !== undefined ? `\n- Deskripsi baru: ${payload.desc}` : ""}`;
  }
  if (kind === "notion_create_page") {
    const fields = Object.entries(payload.values || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    return `📓 Draft Tambah Baris Notion\n- Database: ${payload.databaseName}\n${fields}`;
  }
  if (kind === "notion_update_page") {
    const fields = Object.entries(payload.values || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    return `✏️ Draft ${payload.archived ? "Arsipkan" : "Update"} Baris Notion\n- Database: ${payload.databaseName}\n- Target: ${payload.pageTitle}\n${fields}`;
  }
  if (kind === "superhuman_add_row") {
    const row = payload.rows?.[0] || {};
    const fields = Object.entries(row).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    return `📄 Draft Tambah Baris Superhuman Docs\n- Doc: ${payload.docName}\n- Tabel: ${payload.tableName}\n${fields}`;
  }
  if (kind === "superhuman_update_row") {
    const fields = Object.entries(payload.cells || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    return `✏️ Draft Update Baris Superhuman Docs\n- Doc: ${payload.docName}\n- Tabel: ${payload.tableName}\n- Baris: ${payload.rowName || payload.rowId}\n${fields}`;
  }
  return "📝 Draft aksi workspace";
}

async function proposeWorkspaceDraft(ctx, kind, payload) {
  if (!ctx?.pendingStore) throw new Error("Penyimpanan draft konfirmasi tidak tersedia.");
  const summaryText = formatWorkspaceDraftPreview(kind, payload);
  const action = await ctx.pendingStore.create({ userId: ctx.userId, kind, payload, summaryText });
  ctx.pendingAction = action;
  return `Draft berhasil dibuat (ID: ${action.id}). JANGAN anggap sudah tersimpan — sampaikan ringkasan draft ini dan minta user klik Simpan atau Batal.\n\n${summaryText}`;
}

export async function executeWorkspaceTool(name, args = {}, ctx = {}) {
  switch (name) {
    case "trello_list_boards": {
      const boards = await reqService(ctx.trelloService, "Trello").listBoards({ includeClosed: Boolean(args.includeClosed) });
      return boards.length
        ? boards.map((b) => `- ${b.name} (id: ${b.id}, ${b.closed ? "arsip" : "aktif"})`).join("\n")
        : "Tidak ada board Trello yang tersedia.";
    }
    case "trello_get_board_lists": {
      const board = await resolveTrelloBoard(args, ctx);
      const lists = await reqService(ctx.trelloService, "Trello").getBoardLists(board.id);
      return `Board ${board.name}:\n` + lists.map((l) => `- ${l.name} (id: ${l.id}${l.duplicate ? ", duplikat" : ""})`).join("\n");
    }
    case "trello_search_cards": {
      const board = await resolveTrelloBoard(args, ctx);
      const cards = await reqService(ctx.trelloService, "Trello").searchCards(board.id, args.query, { limit: args.limit || 10 });
      return cards.length
        ? cards.map((c) => `- ${c.name} [List: ${c.listName}] (id: ${c.id})`).join("\n")
        : `Tidak ada card cocok "${args.query}" di ${board.name}.`;
    }
    case "trello_propose_create_card": {
      const board = await resolveTrelloBoard(args, ctx);
      const lists = await reqService(ctx.trelloService, "Trello").getBoardLists(board.id);
      const resolved = resolveTrelloList(lists, args.listId, args.listName, "tujuan");
      if (resolved.ambiguous) return resolved.ambiguous;
      return proposeWorkspaceDraft(ctx, "trello_create_card", {
        boardId: board.id,
        boardName: board.name,
        listId: resolved.list.id,
        listName: resolved.list.name,
        name: String(args.name || "").trim(),
        desc: String(args.desc || ""),
      });
    }
    case "trello_propose_move_card": {
      const svc = reqService(ctx.trelloService, "Trello");
      const board = await resolveTrelloBoard(args, ctx);
      const lists = await svc.getBoardLists(board.id);
      const listRes = resolveTrelloList(lists, args.targetListId, args.targetListName, "tujuan");
      if (listRes.ambiguous) return listRes.ambiguous;
      const cardRes = await resolveTrelloCard(svc, board.id, args.cardId, args.cardQuery);
      if (cardRes.ambiguous) return cardRes.ambiguous;
      return proposeWorkspaceDraft(ctx, "trello_move_card", {
        boardId: board.id,
        boardName: board.name,
        cardId: cardRes.card.id,
        cardName: cardRes.card.name,
        fromListName: cardRes.card.listName,
        targetListId: listRes.list.id,
        targetListName: listRes.list.name,
      });
    }
    case "trello_propose_update_card": {
      const svc = reqService(ctx.trelloService, "Trello");
      const board = await resolveTrelloBoard(args, ctx);
      const cardRes = await resolveTrelloCard(svc, board.id, args.cardId, args.cardQuery);
      if (cardRes.ambiguous) return cardRes.ambiguous;
      return proposeWorkspaceDraft(ctx, "trello_update_card", {
        boardId: board.id,
        boardName: board.name,
        cardId: cardRes.card.id,
        cardName: cardRes.card.name,
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.desc !== undefined ? { desc: args.desc } : {}),
        ...(args.closed !== undefined ? { closed: Boolean(args.closed) } : {}),
      });
    }
    case "notion_list_sources": {
      const { databases, pages } = await reqService(ctx.notionService, "Notion").listConnectedSources();
      const dbText = databases.map((d) => `- [DB] ${d.title} (id: ${d.id})`).join("\n") || "- (kosong)";
      const pgText = pages.map((p) => `- [Page] ${p.title} (id: ${p.id})`).join("\n") || "- (kosong)";
      return `Database Notion:\n${dbText}\n\nRoot Page Notion:\n${pgText}`;
    }
    case "notion_get_database_schema": {
      const db = await resolveNotionDb(args, ctx);
      const meta = await reqService(ctx.notionService, "Notion").getDatabaseSchema(db.id);
      return `Schema ${meta.title}:\n` + meta.schema.map((s) => `- ${s.name} (${s.type})${s.options.length ? ` [${s.options.join(", ")}]` : ""}`).join("\n");
    }
    case "notion_query_database": {
      const db = await resolveNotionDb(args, ctx);
      const res = await reqService(ctx.notionService, "Notion").queryDatabase(db.id, { query: args.query, limit: args.limit || 8 });
      return res.rows.length
        ? res.rows.map((r) => `- ${r.title} (id: ${r.id}) | ${Object.entries(r.fields).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}`).join("\n")
        : `Tidak ada baris cocok di ${db.title}.`;
    }
    case "notion_propose_create_page": {
      const db = await resolveNotionDb(args, ctx);
      const meta = await reqService(ctx.notionService, "Notion").getDatabaseSchema(db.id);
      validateNotionValues(meta.schema, args.values);
      return proposeWorkspaceDraft(ctx, "notion_create_page", {
        databaseId: db.id,
        databaseName: meta.title,
        values: args.values,
      });
    }
    case "notion_propose_update_page": {
      const svc = reqService(ctx.notionService, "Notion");
      const db = await resolveNotionDb(args, ctx);
      const meta = await svc.getDatabaseSchema(db.id);
      if (args.values) validateNotionValues(meta.schema, args.values);
      let pageId = args.pageId;
      let pageTitle = args.pageQuery || pageId;
      if (!pageId) {
        if (!args.pageQuery) throw new Error("Sebutkan pageId atau pageQuery.");
        const hits = await svc.queryDatabase(db.id, { query: args.pageQuery, pageSize: 5 });
        if (!hits.rows.length) throw new Error(`Baris "${args.pageQuery}" tidak ditemukan di ${meta.title}.`);
        if (hits.rows.length > 1) {
          return `Ditemukan >1 baris mirip "${args.pageQuery}":\n` + hits.rows.map((r) => `- ${r.title} (pageId: ${r.id})`).join("\n");
        }
        pageId = hits.rows[0].id;
        pageTitle = hits.rows[0].title;
      }
      return proposeWorkspaceDraft(ctx, "notion_update_page", {
        databaseId: db.id,
        databaseName: meta.title,
        pageId,
        pageTitle,
        ...(args.values ? { values: args.values } : {}),
        ...(args.archived !== undefined ? { archived: Boolean(args.archived) } : {}),
      });
    }
    case "superhuman_list_docs": {
      const docs = await reqService(ctx.superhumanService, "Superhuman Docs").listDocs();
      return docs.length ? docs.map((d) => `- ${d.name} (docId: ${d.id})`).join("\n") : "Tidak ada dokumen Superhuman Docs.";
    }
    case "superhuman_get_doc_structure": {
      const { ov, docName } = await resolveSuperhumanDocAndTable(args, ctx, false);
      return `Doc ${docName} (ACL: ${ov.canWrite ? "write" : "read-only"})\nHalaman: ${ov.pages.map((p) => p.name).join(", ") || "-"}\nTabel: ${ov.tables.map((t) => `${t.name} (${t.id})`).join(", ") || "-"}`;
    }
    case "superhuman_query_table": {
      const { svc, docId, table } = await resolveSuperhumanDocAndTable(args, ctx, true);
      const ov = await svc.getTableOverview(docId, table.id, { limit: args.limit || 8, query: args.query });
      const cols = ov.columns.map((c) => c.name).join(", ");
      const rows = ov.rows.map((r) => `- ${r.name || r.id} (rowId: ${r.id}): ${JSON.stringify(r.values)}`).join("\n") || "(kosong)";
      return `Tabel ${table.name}\nKolom: ${cols}\nBaris:\n${rows}`;
    }
    case "superhuman_propose_add_row": {
      const { svc, ov, docId, docName, table } = await resolveSuperhumanDocAndTable(args, ctx, true);
      if (!ov.canWrite) throw new Error(`Dokumen "${docName}" hanya read-only.`);
      const tbl = await svc.getTableOverview(docId, table.id, { limit: 1 });
      const colNames = new Set(tbl.columns.map((c) => c.name.toLowerCase()));
      for (const k of Object.keys(args.row || {})) {
        if (!colNames.has(k.toLowerCase())) throw new Error(`Kolom "${k}" tidak ditemukan di ${table.name}. Kolom: ${tbl.columns.map((c) => c.name).join(", ")}`);
      }
      return proposeWorkspaceDraft(ctx, "superhuman_add_row", {
        docId,
        docName,
        tableId: table.id,
        tableName: table.name,
        rows: [args.row],
      });
    }
    case "superhuman_propose_update_row": {
      const { svc, ov, docId, docName, table } = await resolveSuperhumanDocAndTable(args, ctx, true);
      if (!ov.canWrite) throw new Error(`Dokumen "${docName}" hanya read-only.`);
      let rowId = args.rowId;
      let rowName = args.rowQuery || rowId;
      if (!rowId) {
        if (!args.rowQuery) throw new Error("Sebutkan rowId atau rowQuery.");
        const found = await svc.getTableOverview(docId, table.id, { limit: 5, query: args.rowQuery });
        if (!found.rows.length) throw new Error(`Baris "${args.rowQuery}" tidak ditemukan di ${table.name}.`);
        if (found.rows.length > 1) {
          return `Ditemukan >1 baris mirip "${args.rowQuery}":\n` + found.rows.map((r) => `- ${r.name || JSON.stringify(r.values)} (rowId: ${r.id})`).join("\n");
        }
        rowId = found.rows[0].id;
        rowName = found.rows[0].name || rowId;
      }
      return proposeWorkspaceDraft(ctx, "superhuman_update_row", {
        docId,
        docName,
        tableId: table.id,
        tableName: table.name,
        rowId,
        rowName,
        cells: args.cells,
      });
    }
    case "kb_search": {
      const hits = await reqService(ctx.kbService, "Knowledge Base").searchNotes(args.query, {
        folder: args.folder || "",
        limit: args.limit || 8,
      });
      return hits.length
        ? hits.map((h) => `- ${h.path}${h.snippets.length ? ` | ${h.snippets.map((s) => `L${s.line}: ${s.text}`).join(" ; ")}` : ""}`).join("\n")
        : `Tidak ada catatan KB cocok "${args.query}".`;
    }
    case "kb_read_note": {
      const note = await reqService(ctx.kbService, "Knowledge Base").readNote(args.path, {
        startLine: args.startLine || 1,
        maxLines: args.maxLines || 50,
      });
      return `${note.path} (Baris ${note.startLine}-${note.endLine}/${note.totalLines}):\n\n${note.text}${note.hasMore ? `\n\n[Lanjut baca mulai baris ${note.nextStartLine}]` : ""}`;
    }
    default:
      return null;
  }
}
