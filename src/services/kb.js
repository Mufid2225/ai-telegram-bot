import fs from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules"]);

function toPosix(rel) {
  return String(rel || "").replace(/\\/g, "/");
}

function isWithinRoot(rootReal, targetPath) {
  const rootCmp = process.platform === "win32" ? rootReal.toLowerCase() : rootReal;
  const targetCmp = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
  return targetCmp === rootCmp || targetCmp.startsWith(rootCmp + path.sep);
}

/**
 * Read-only local Markdown/Obsidian Knowledge Base service with traversal protection.
 */
export function createKBService(config) {
  const kbDir = (config?.kbDir || "").trim();

  function isConfigured() {
    return Boolean(kbDir);
  }

  async function resolveSafePath(relPath = "") {
    if (!isConfigured()) {
      throw new Error("Knowledge Base belum dikonfigurasi. Isi KB_DIR di .env.local terlebih dahulu.");
    }
    const clean = String(relPath ?? "").trim();
    if (path.isAbsolute(clean)) {
      throw new Error("Path tidak valid: path berada di luar folder Knowledge Base.");
    }
    const rootReal = await fs.realpath(kbDir);
    const candidate = path.resolve(rootReal, clean);
    if (!isWithinRoot(rootReal, candidate)) {
      throw new Error("Path tidak valid: path berada di luar folder Knowledge Base.");
    }
    const realTarget = await fs.realpath(candidate);
    if (!isWithinRoot(rootReal, realTarget)) {
      throw new Error("Path tidak valid: symlink mengarah ke luar folder Knowledge Base.");
    }
    return { rootReal, targetReal: realTarget };
  }

  async function collectMarkdownFiles(dir, rootReal, out = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectMarkdownFiles(full, rootReal, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push({ full, rel: toPosix(path.relative(rootReal, full)) });
      }
    }
    return out;
  }

  return {
    isConfigured,

    async listDirectory(relDir = "", { page = 0, pageSize = 10 } = {}) {
      const { rootReal, targetReal } = await resolveSafePath(relDir);
      const entries = await fs.readdir(targetReal, { withFileTypes: true });

      const folders = [];
      const files = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        const rel = toPosix(path.relative(rootReal, path.join(targetReal, entry.name)));
        if (entry.isDirectory()) {
          folders.push({ type: "dir", name: entry.name, path: rel });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          files.push({ type: "file", name: entry.name, path: rel });
        }
      }

      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => {
        if (a.name.toLowerCase() === "home.md") return -1;
        if (b.name.toLowerCase() === "home.md") return 1;
        return a.name.localeCompare(b.name);
      });

      const all = [...folders, ...files];
      const totalItems = all.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
      const start = safePage * pageSize;

      return {
        currentDir: toPosix(path.relative(rootReal, targetReal)),
        page: safePage,
        pageSize,
        totalItems,
        totalPages,
        items: all.slice(start, start + pageSize),
      };
    },

    async searchNotes(query, { folder = "", limit = 8 } = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      if (!q) throw new Error("Kata kunci pencarian Knowledge Base wajib diisi.");
      const { rootReal, targetReal } = await resolveSafePath(folder);
      const files = await collectMarkdownFiles(targetReal, rootReal);
      const maxResults = Math.min(Math.max(Number(limit) || 8, 1), 20);
      const hits = [];

      for (const file of files) {
        const nameMatch = file.rel.toLowerCase().includes(q);
        const content = await fs.readFile(file.full, "utf8");
        const lines = content.split(/\r?\n/);
        const snippets = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            snippets.push({ line: i + 1, text: lines[i].trim().slice(0, 140) });
            if (snippets.length >= 2) break;
          }
        }
        if (nameMatch || snippets.length) {
          hits.push({ path: file.rel, name: path.basename(file.rel), snippets });
          if (hits.length >= maxResults) break;
        }
      }
      return hits;
    },

    async readNote(relPath, { startLine = 1, maxLines = 50 } = {}) {
      const { rootReal, targetReal } = await resolveSafePath(relPath);
      const raw = await fs.readFile(targetReal, "utf8");
      const allLines = raw.split(/\r?\n/);
      const start = Math.max(1, Number(startLine) || 1);
      const count = Math.min(Math.max(Number(maxLines) || 50, 1), 100);
      const end = Math.min(allLines.length, start + count - 1);
      const text = allLines.slice(start - 1, end).join("\n").slice(0, 3400);

      return {
        path: toPosix(path.relative(rootReal, targetReal)),
        startLine: start,
        endLine: end,
        totalLines: allLines.length,
        hasMore: end < allLines.length,
        nextStartLine: end < allLines.length ? end + 1 : null,
        text,
      };
    },
  };
}
