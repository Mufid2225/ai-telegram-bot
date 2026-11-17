# AGENTS.md — Panduan AI Coding Agent (`ai-telegram-bot`)

> File ini ditujukan **khusus untuk AI coding agent** (Antigravity, Claude Code, OpenCode, Codex, dll.) yang sedang mengembangkan repository ini. **Tidak dibaca oleh runtime bot Telegram** (karakter & instruksi perilaku runtime bot diatur di `SOUL.md`).

## Ringkasan Proyek
- **Nama:** `telegram-ai-bot` (Nerissa Bot)
- **Runtime:** Node.js 22+ (ESM `"type": "module"`)
- **Stack utama:** `telegraf`, `better-sqlite3` (`13.x`), `chartjs-node-canvas`, `dayjs`, `dotenv`, `tesseract.js`, `pdf-parse`, `mammoth`, `yahoo-finance2`, native `fetch`
- **Tes:** `npm test` (`node --test`, 100% offline tanpa dependensi jaringan; gunakan mock `fetch`, SQLite `:memory:`, dan direktori sementara `fs.mkdtemp`)

## Peta File Penting
- `SOUL.md`: Konfigurasi persona, gaya bicara, & aturan perilaku runtime bot Nerissa (dibaca setiap giliran via `src/utils/soul.js`).
- `src/index.js`: Entry point Telegraf, inisialisasi store & service, registrasi menu command (`setMyCommands`), startup reminder poller, health check HTTP server, dan graceful shutdown.
- `src/config.js`: Validasi env dari `.env.local` (`override: true`) + fallback otomatis ke environment OS untuk kredensial opsional (`SHEET_*`, `TRELLO_*`, `NOTION_API_KEY`, `SUPERHUMAN_API_TOKEN`, `KB_DIR`).
- `src/database.js`: SQLite factory (`createDatabase`) & schema (`memories`, `conversations`, `knowledge`, `pending_actions`, `reminders`, `active_context`, `callback_refs`).
- `src/tools.js` & `src/tools/workspace.js`: Definisi & eksekutor tool AI:
  - `src/tools.js`: Tool utama (`MoneyTracker` read/propose, catatan, reminder, knowledge graph, kalkulator, waktu) + penggabungan tool workspace.
  - `src/tools/workspace.js`: 15 tool terarah untuk Trello, Notion, Superhuman Docs, dan Knowledge Base (termasuk resolusi konteks aktif & disambiguasi kandidat kembar).
- `src/handlers/`:
  - `menu.js`: `/start` & `/menu` interaktif (Inline Keyboard in-place via `editMessageText`, tanpa Reply Keyboard) + `BOT_COMMANDS`.
  - `workspace-menu.js`: Sub-menu dinamis live untuk `📋 Trello`, `📓 Notion`, `📄 Superhuman Docs`, dan `🧠 Knowledge Base` dengan pagination & short callback refs.
  - `actions.js`: Runner konfirmasi atomik terpadu (`runPendingConfirmation`) untuk tombol `✅ Simpan` / `❌ Batal` (`action:*` & `money:*`) serta eksekutor mutasi workspace (`executeWorkspaceAction`).
  - `money.js`: `/catat`, `/keuangan`, `/pengeluaran`, pengiriman grafik PNG, dan delegasi callback `money:*`.
  - `messages.js`: Handler chat teks utama dengan injeksi ringkas `active_context`, tool calling, & animasi progress bar.
  - `files.js`: OCR foto (`Tesseract.js`) & ekstraksi PDF/DOCX + deteksi struk transaksi.
  - `tasks.js`: `/catatan`, `/tugas`, `/hapus`, `/update`, `/remind`.
  - `market.js`: `/saham`, `/ekonomi`, `/cari`, `/test`.
- `src/services/`:
  - `ai.js`: Klien OpenAI-compatible router dengan multi-step tool-calling loop, retry/backoff, dan `stripMarkdown`.
  - `pending.js`: Store SQLite `pending_actions` terpadu (klaim atomik `claimForExecution`, `superseded` draft lama, TTL).
  - `workspace.js`: Store SQLite `active_context` (target kerja terakhir per user) & `callback_refs` (hash ref 8-karakter agar `callback_data` selalu `<= 64` byte).
  - `sheets.js` & `money.js`: Integrasi & pemformatan `MoneyTracker` Google Sheets.
  - `trello.js`: Klien REST Trello v1 (board/list overview terpaginasi, deteksi nama list duplikat, pencarian card, create/move/archive card).
  - `notion.js`: Klien REST Notion (`2022-06-28`, paginated search, validasi schema & opsi `select`/`status`, verifikasi baca ulang `GET` setelah tulis, archive-only).
  - `superhuman.js`: Klien REST Superhuman Docs / Coda v1 (cek ACL `write` vs `read-only`, prioritas tabel bernama, pembersihan cell kosong, polling `mutationStatus` HTTP `202`).
  - `kb.js`: Layanan baca & cari Markdown Knowledge Base lokal (`read-only`) dengan proteksi path traversal & symlink escape (`resolveSafePath`).
  - `reminder.js`, `chart.js`, `market.js`, `alpha.js`, `fmp.js`, `search.js`.
- `src/utils/`:
  - `http.js`: Helper `requestJson` dengan `AbortSignal.timeout` dan redaksi rahasia otomatis pada error jaringan/HTTP.
  - `errors.js`: Pemformatan error ramah pengguna (`formatFriendlyError`, `formatAIHttpError`) + `redactSecrets` (menyensor token bot, Bearer, URL Apps Script, query `?key=...&token=...` Trello, token `ntn_`/`secret_`/`ATTA`, dan `extraSecrets`).
  - `telegram.js`: Chunking pesan, `runWithProgress` (`0% → 25% → 50% → 75% → 100%`), `buildConfirmExtra`.
  - `soul.js`: Loader `SOUL.md`.
- `apps-script/MoneyTracker.gs`: Bridge Google Apps Script Web App untuk spreadsheet `MoneyTracker`.
- `docs/superpowers/`: Dokumen spesifikasi desain (`specs/`) dan rencana implementasi (`plans/`).

## Aturan Pengembangan, Skalabilitas & Keamanan (Repo Public)
1. **Single Source of Truth Eksternal:** Google Sheets (`MoneyTracker`), Trello, Notion, dan Superhuman Docs adalah kebenaran utama data masing-masing. Jangan membuat tabel mirror/salinan transaksi, card, atau dokumen eksternal di SQLite lokal.
2. **Konfirmasi Wajib & Operasi Non-Destruktif:**
   - Semua operasi tulis/edit/arsip ke Google Sheets, Trello, Notion, dan Superhuman Docs wajib melewati `pending_actions` (SQLite) dan konfirmasi tombol inline (`✅ Simpan` / `❌ Batal`), hanya untuk `ALLOWED_USER_ID`.
   - Jangan pernah melakukan penghapusan permanen (`DELETE`) ke API Trello atau Notion; gunakan pengarsipan (`closed: true` / `archived: true`).
   - Layanan `kb.js` wajib selalu **read-only** dan memvalidasi bahwa target berada di dalam `realpath(KB_DIR)`.
3. **Skalabilitas & Batas Platform Telegram:**
   - Jangan pernah menumpahkan seluruh isi board/database besar (ratusan card/row) ke satu pesan Telegram (batas 4.096 karakter) atau ke system prompt AI. Gunakan ringkasan terpaginasi di menu dan pencarian terarah (`limit` kecil) di tool AI.
   - Setiap tombol inline dinamis yang memuat ID panjang (UUID Notion, table ID, path file KB) wajib memakai `workspaceStore.createCallbackRef()` agar `callback_data` tidak pernah melampaui batas **64 byte** Telegram.
4. **Persistensi Lokal (`data.db`):** Catatan (`memories`), fakta (`knowledge`), `reminders`, `pending_actions`, `active_context`, dan `callback_refs` disimpan di SQLite agar tahan restart server.
5. **Keamanan Secret & Data Pribadi:**
   - Repo ini bersifat **public** di GitHub.
   - Jangan pernah membaca/mencetak isi `.env` atau `.env.local` ke output atau commit, dan jangan masukkan ID personal, path folder lokal beridentitas pribadi, nama/email personal, URL webhook asli, atau API key ke source code, test fixture, maupun dokumentasi repo.
   - Jangan menjalankan `git commit` atau `git push` tanpa persetujuan eksplisit dari user.
   - Sebelum commit/push, jalankan `npm test` dan `gitleaks` pada file perubahan.
6. **Verifikasi Wajib:** Jalankan `npm test` (`node --test`) dan `node --check` setelah perubahan kode sebelum menyatakan selesai.
