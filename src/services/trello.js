import { requestJson } from "../utils/http.js";

const BASE_URL = "https://api.trello.com/1";

/**
 * Create a Trello REST API client using key/token credentials with redacted error handling.
 */
export function createTrelloService(config, fetchImpl = fetch) {
  const key = (config?.trelloApiKey || "").trim();
  const token = (config?.trelloApiToken || "").trim();
  const secrets = [key, token];

  function isConfigured() {
    return Boolean(key && token);
  }

  function assertConfigured() {
    if (!isConfigured()) {
      throw new Error("Trello belum dikonfigurasi. Pastikan TRELLO_API_KEY dan TRELLO_API_TOKEN tersedia di environment.");
    }
  }

  async function api(path, { method = "GET", params = {}, body } = {}) {
    assertConfigured();
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("key", key);
    url.searchParams.set("token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers = body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" };
    return requestJson(url.toString(), { method, headers, body }, { label: "Trello", fetchImpl, extraSecrets: secrets });
  }

  async function fetchBoardLists(boardId) {
    const lists = await api(`/boards/${encodeURIComponent(boardId)}/lists`, {
      params: { filter: "open", fields: "id,name,pos" },
    });
    const counts = new Map();
    for (const l of lists) {
      const k = String(l.name || "").trim().toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return lists.map((l) => ({
      id: l.id,
      name: l.name,
      pos: l.pos,
      duplicate: (counts.get(String(l.name || "").trim().toLowerCase()) || 0) > 1,
    }));
  }

  return {
    isConfigured,

    async listBoards({ includeClosed = false } = {}) {
      const boards = await api("/members/me/boards", {
        params: { fields: "id,name,desc,shortUrl,closed,prefs" },
      });
      return boards
        .filter((b) => includeClosed || !b.closed)
        .map((b) => ({
          id: b.id,
          name: b.name,
          desc: b.desc || "",
          shortUrl: b.shortUrl || "",
          closed: Boolean(b.closed),
          permissionLevel: b.prefs?.permissionLevel || "private",
        }));
    },

    async getBoardOverview(boardId, { page = 0, pageSize = 10 } = {}) {
      const [board, lists, cards] = await Promise.all([
        api(`/boards/${encodeURIComponent(boardId)}`, { params: { fields: "id,name,desc,shortUrl,closed" } }),
        fetchBoardLists(boardId),
        api(`/boards/${encodeURIComponent(boardId)}/cards`, {
          params: { filter: "open", fields: "id,name,idList,dateLastActivity,shortUrl" },
        }),
      ]);

      const countByList = new Map();
      const listNameById = new Map();
      for (const l of lists) listNameById.set(l.id, l.name);
      for (const c of cards) countByList.set(c.idList, (countByList.get(c.idList) || 0) + 1);

      const enrichedLists = lists.map((l) => ({ ...l, cardCount: countByList.get(l.id) || 0 }));
      const totalLists = enrichedLists.length;
      const totalPages = Math.max(1, Math.ceil(totalLists / pageSize));
      const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
      const start = safePage * pageSize;

      const recentCards = [...cards]
        .sort((a, b) => String(b.dateLastActivity || "").localeCompare(String(a.dateLastActivity || "")))
        .slice(0, 5)
        .map((c) => ({
          id: c.id,
          name: c.name,
          idList: c.idList,
          listName: listNameById.get(c.idList) || "-",
          shortUrl: c.shortUrl || "",
        }));

      return {
        board: { id: board.id, name: board.name, desc: board.desc || "", shortUrl: board.shortUrl || "" },
        page: safePage,
        pageSize,
        totalLists,
        totalPages,
        totalOpenCards: cards.length,
        lists: enrichedLists.slice(start, start + pageSize),
        allLists: enrichedLists,
        recentCards,
      };
    },

    async listCardsInList(listId, { page = 0, pageSize = 8 } = {}) {
      const cards = await api(`/lists/${encodeURIComponent(listId)}/cards`, {
        params: { filter: "open", fields: "id,name,desc,shortUrl,dateLastActivity" },
      });
      const totalCards = cards.length;
      const totalPages = Math.max(1, Math.ceil(totalCards / pageSize));
      const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
      const start = safePage * pageSize;
      return {
        listId,
        page: safePage,
        pageSize,
        totalCards,
        totalPages,
        cards: cards.slice(start, start + pageSize),
      };
    },

    async searchCards(boardId, query, { limit = 10 } = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      const [lists, cards] = await Promise.all([
        fetchBoardLists(boardId),
        api(`/boards/${encodeURIComponent(boardId)}/cards`, {
          params: { filter: "open", fields: "id,name,desc,idList,dateLastActivity,shortUrl" },
        }),
      ]);
      const listById = new Map(lists.map((l) => [l.id, l]));
      const filtered = q
        ? cards.filter((c) => String(c.name || "").toLowerCase().includes(q) || String(c.desc || "").toLowerCase().includes(q))
        : cards;
      return filtered.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 25)).map((c) => ({
        id: c.id,
        name: c.name,
        idList: c.idList,
        listName: listById.get(c.idList)?.name || "-",
        shortUrl: c.shortUrl || "",
      }));
    },

    async getBoardLists(boardId) {
      return fetchBoardLists(boardId);
    },

    async createCard({ listId, name, desc = "", pos = "bottom" }) {
      return api("/cards", {
        method: "POST",
        params: { idList: listId, name, desc, pos },
      });
    },

    async moveCard({ cardId, targetListId, pos = "bottom" }) {
      return api(`/cards/${encodeURIComponent(cardId)}`, {
        method: "PUT",
        params: { idList: targetListId, pos },
      });
    },

    async updateCard({ cardId, name, desc, closed }) {
      const params = {};
      if (name !== undefined) params.name = name;
      if (desc !== undefined) params.desc = desc;
      if (closed !== undefined) params.closed = Boolean(closed);
      return api(`/cards/${encodeURIComponent(cardId)}`, { method: "PUT", params });
    },
  };
}
