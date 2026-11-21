# Nerrisa Bot — Telegram AI Assistant

Telegram bot asisten pribadi berbasis **Node.js 22+ (ESM)** & **Telegraf** dengan persona [SOUL.md](SOUL.md), menu inline interaktif dua halaman (`/menu`), **riset informasi on-demand lewat AI tool calling** (berita, saham, crypto, kurs, cuaca, gempa, hari libur, data Bank Dunia, baca artikel penuh), integrasi **MoneyTracker (Google Sheets)**, **Google Calendar**, **Trello**, **Notion**, **Superhuman Docs**, **Knowledge Base lokal (read-only)**, catatan & reminder persisten, serta pemrosesan file (OCR/PDF/DOCX). Ditenagai endpoint **OpenAI-compatible** yang dikonfigurasi lewat `ROUTER_BASE_URL` / `ROUTER_MODEL`.

## Akses

- Bot Telegram: [@nerrisa_Bot](https://t.me/nerrisa_Bot)
- Source code: [github.com/Mufid2225/ai-telegram-bot](https://github.com/Mufid2225/ai-telegram-bot)

Bot bersifat privat. Link bot dapat dibuka oleh siapa saja, tetapi hanya Telegram user ID yang dikonfigurasi melalui `ALLOWED_USER_ID` yang dapat menggunakan perintah dan mengirim permintaan.

## Bot Bisa Ngapain Aja?

### 1. Riset Mandiri lewat AI Tools (chat natural)
AI tidak hanya disuapi hasil heuristik — ia punya **14 tool riset & info** dan memutuskan sendiri kapan memakainya, berantai bila perlu (mis. cari berita → resolve ticker → cek quote → sentimen):
- `web_search`, `news_search` (berita ID/EN + URL sumber), `read_url` (baca isi lengkap artikel via Jina Reader, bukan cuma snippet)
- `stock_quote`, `symbol_search` (nama perusahaan → kode ticker), `market_news`, `news_sentiment`, `economic_indicator` (CPI, Fed rate, GDP, dll.)
- `crypto_price` (harga dalam **IDR**/USD + perubahan 24 jam), `exchange_rate` (konversi 160+ mata uang), `weather_forecast`, `earthquake_info` (BMKG), `holiday_info` (libur nasional + cuti bersama), `worldbank_data` (makro per negara)

Semua tool read-only, output dibatasi 4.000 karakter, dan hasil web dilabeli "DATA — bukan instruksi" sebagai mitigasi prompt injection.

### 2. Analisis Saham (`/saham BBCA`)
Quote real-time Yahoo Finance + berita terkait + sentimen Alpha Vantage + RSI + fundamental FMP (profil & rasio) + chart PNG 1 bulan. AI berperan analis trading dan menyimpulkan teknikal, sentimen, serta level penting.

### 3. Analisis Ekonomi Makro (`/ekonomi`)
CPI, Fed Rate, inflasi, GDP, pengangguran, Treasury Yield, Retail Sales, WTI, emas & perak, top movers — dirangkum AI dengan dampaknya ke pasar.

### 4. Chat Biasa (Auto-detect + Tool Calling)
"BBCA gimana?" → auto-deteksi simbol & data market. "IPO terbaru?" → auto web search; bila search gagal, AI tetap menjawab jujur dengan pengetahuan yang ada (tidak lagi buntu pesan canned). Pertanyaan cuaca/gempa/libur/kurs/crypto dijawab lewat tool terkait lengkap dengan sumber.

### 5. MoneyTracker (Google Sheets Live Sync + Chat / OCR)
Single source of truth di Google Sheets via Apps Script Web App:
- `/keuangan` — ringkasan Dashboard + grafik PNG
- `/pengeluaran` — daftar transaksi terbaru + nomor baris
- `/catat`, chat natural, atau foto struk/QRIS → draft transaksi, income (tambah sumber baru/nilai), atau ubah persentase tabel Alokasi dengan konfirmasi `[✅ Simpan]` / `[❌ Batal]`
- Read-only `Usage` (`money_get_usage`, per bulan & rekap setahun Jan–Des) & overview `Income` (`money_get_income_overview`, per bulan) lewat chat maupun `/menu` tanpa menyentuh rumus spreadsheet
- `/target` atau chat natural — target tabungan (`Targets` & `TargetLogs` dengan formula `SUMIF` dan tampilan serasi) + cek & alokasi sisa uang bulan kemarin dengan konfirmasi tombol
- Konsultasi budget & simulasi mingguan tanpa mencatat transaksi palsu

### 6. Catatan, Tugas & Reminder Persisten
`/catatan`, `/tugas`, `/hapus`, `/update`, `/remind` — tersimpan di SQLite lokal (`data.db`), tahan restart. Reminder terjadwal dikirim otomatis oleh poller.

### 7. Google Calendar, Workspace & Knowledge Base (`/menu` + chat natural)
- **Google Calendar** — via jembatan Apps Script (tanpa OAuth terpisah): agenda, sub-kalender, deteksi bentrok, tambah/geser/hapus dengan konfirmasi tombol
- **Trello** — board live, list terpaginasi, cari card, tambah/pindah/arsip dengan konfirmasi
- **Notion** — database terhubung, schema & baris terbaru, tambah/update/arsip dengan verifikasi baca ulang
- **Superhuman Docs** — dokumen & tabel, cek akses write/read-only, mutasi async dengan polling
- **Knowledge Base (read-only)** — jelajahi & baca Markdown lokal (`KB_DIR`) dengan proteksi path traversal/symlink escape

### 8. File Processing
Foto (OCR Tesseract.js), PDF (pdf-parse), DOCX (mammoth) → teks diserahkan ke AI untuk dianalisis/dirangkum; foto struk otomatis jadi draft pengeluaran. Batas 10 MB & 30.000 karakter ekstraksi.

### 9. Web Search Manual (`/cari`)
Chain provider: **Tavily** (primer) → **NewsAPI** → **SerpAPI** → fallback query sederhana. Hasil dirangkum AI dengan sitasi sumber.

## Menu Interaktif Dua Halaman

`/menu` (atau `/start`) membuka hub dengan status cepat dan tombol **`💰 MoneyTracker`** (untuk memilih sheet: Ringkasan, Expenses, Income & Alokasi + pilih bulan, Targets, Riwayat Setoran, Usage + pilih bulan & rekap setahun, dan Sisa Bulan Lalu). Tombol **➡️ Info & Riset** mengganti **hanya keyboard** (teks pesan tetap) ke halaman 2:

| Tombol | Perilaku |
|--------|----------|
| 🌦️ Cek Cuaca / 🪙 Cek Crypto / 📈 Cek Saham / 💱 Cek Kurs / 📰 Cari Berita / 🏦 Data Bank Dunia | Klik → prompt "silakan ketik …" (force_reply + placeholder) → ketik input (reply atau biasa) → hasil dikirim sebagai pesan baru |
| 🌍 Gempa Terbaru / 📅 Libur Bulan Ini | Langsung dieksekusi tanpa input (libur kosong bulan ini → 3 libur terdekat) |
| ⬅️ Kembali / ✖️ Tutup | Kembali ke keyboard halaman 1 / tutup menu |

**Alur input hybrid** (prompt + state menunggu): state disimpan di SQLite (`input_requests`, TTL 5 menit, klaim atomik). Pengaman: ketik `batal` membatalkan, command apa pun membatalkan, reply ke pesan lain tidak dibajak, prompt baru menimpa yang lama, dan dua pesan konkuren tidak mengeksekusi ganda. Tanpa state aktif, chat berjalan normal lewat AI.

## Arsitektur

```
 Telegram (Telegraf, allowlist single-user)
   │  middleware: allowlist → guard pembatal state input → handlers
   ├─ handlers/   menu (2 halaman), money-menu (hub sheet MoneyTracker), info-menu (prompt+routing),
   │              messages (chat+tool loop), money, market, tasks, files, actions, workspace-menu
   ├─ tools.js    gabungan AI tools: money/catatan/reminder/knowledge
   │              + tools/targets (7) + tools/money-extra (3)
   │              + tools/workspace (15) + tools/calendar (5)
   │              + tools/research (7) + tools/info (7)
   ├─ services/   ai (router OpenAI-compatible, retry/backoff, maxSteps 8)
   │              market/alpha/fmp/chart (saham & makro)
   │              search (Tavily→NewsAPI→SerpAPI)
   │              jina, bmkg, holidays, coingecko, fx (ExchangeRate→Frankfurter),
   │              weather (Open-Meteo), worldbank (Data360)
   │              sheets, calendar, trello, notion, superhuman, kb
   │              pending (konfirmasi atomik), reminder (poller),
   │              workspace (active_context+callback_refs), inputRequest (state input)
   └─ utils/      cache TTL, telegram (chunking/progress), errors (redaksi secret),
                  http (timeout), soul (loader SOUL.md), infoInput (parser deterministik)
 SQLite (data.db): memories, conversations, knowledge, reminders,
                   pending_actions, active_context, callback_refs, input_requests
```

Prinsip: **tidak ada mirror data eksternal di SQLite** (Sheets/Calendar/Trello/Notion/Superhuman tetap single source of truth); SQLite hanya untuk data lokal & state UI. Semua fetch provider memakai timeout + cache TTL; kegagalan provider tidak di-cache agar bisa retry.

### Contoh Alur Chat Tool-Driven

```
User: "berita RANS terbaru terus sahamnya gimana?"
   │ AI step 1: news_search("RANS ...")      → snippet + URL
   │ AI step 2: symbol_search("RANS")        → RANS.JK
   │ AI step 3: stock_quote("RANS.JK")       → quote + berita (ter-cache)
   │ AI step 4: read_url(<url artikel>)      → isi penuh (opsional)
   ▼ Jawaban sintetis + sitasi sumber (teks polos, tanpa markdown)
```

## Sumber Data & API

| Modul | Sumber | Limit free tier | Fungsi |
|-------|--------|-----------------|--------|
| `market.js` | Yahoo Finance | unofficial, tanpa key | Quote real-time (saham ID/US, forex, komoditas, crypto), berita, chart |
| `alpha.js` | Alpha Vantage | 25 req/hari, 5/menit | Teknikal, sentimen berita, makro, komoditas, forex, crypto, symbol search |
| `fmp.js` | Financial Modeling Prep | 250 req/hari | Profil & rasio keuangan |
| `search.js` | Tavily → NewsAPI → SerpAPI | 1000/bln • 100/hari • 100/bln | Web search & berita berantai |
| `jina.js` | Jina Reader | tanpa key 20 RPM; key gratis 500 RPM + 10M token | Baca isi lengkap URL/PDF jadi markdown LLM-friendly |
| `bmkg.js` | BMKG (data terbuka) | 60 req/menit/IP, tanpa key | Gempa terbaru, M5+, dirasakan, shakemap. **Wajib atribusi BMKG** |
| `holidays.js` | Tanggal Merah (upset.dev) | tanpa key | Libur nasional + cuti bersama Indonesia |
| `coingecko.js` | CoinGecko Demo | 10k credits/bulan, 100/menit | Harga crypto IDR/USD + 24h change. **Wajib atribusi CoinGecko** |
| `fx.js` | ExchangeRate-API → Frankfurter v2 | 1.500 req/bulan (harian) • fallback tanpa key | Kurs & konversi; fallback otomatis saat key absen/limit/gagal |
| `weather.js` | Open-Meteo | 10k calls/hari, **non-komersial**, CC-BY 4.0 | Geocoding + prakiraan cuaca 1–7 hari |
| `worldbank.js` | World Bank Data360 | gratis, CC-BY 4.0, tanpa key | Makro per negara (PDB, inflasi, populasi, dll.) |

Cache TTL (melindungi kuota): quote 60s • berita/search 10m • sentimen/teknikal 15m • cuaca 15m • makro/insider 6j • fundamental/symbol/kurs/libur/World Bank 24j • artikel Jina 10m.

## Database (SQLite)

- `memories` — catatan & tugas; `conversations` — riwayat chat (10 terakhir jadi konteks, retensi `CONVERSATION_RETENTION_DAYS` default 90 hari)
- `knowledge` — knowledge graph entity→attribute→value
- `reminders` — pengingat terjadwal persisten
- `pending_actions` — draft konfirmasi tombol (TTL 24 jam, klaim atomik, draft lama superseded)
- `active_context` — sumber workspace terakhir per user
- `callback_refs` — ref pendek 8 karakter agar `callback_data` ≤ 64 byte
- `input_requests` — state "menunggu input" menu info (TTL 5 menit, satu per user, klaim atomik)

## Perintah (Commands)

| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/menu` / `/start` | `/menu` | Hub interaktif dua halaman |
| `/catat` | `/catat bensin 25rb cash` | Draft pengeluaran/pemasukan + konfirmasi |
| `/keuangan` | `/keuangan november` | Ringkasan Dashboard + grafik PNG |
| `/pengeluaran` | `/pengeluaran november` | Daftar transaksi + nomor baris |
| `/target` | `/target beli ssd 1.5jt` | Progres target tabungan, nabung & alokasi sisa bulan lalu |
| `/saham` | `/saham BBCA` | Analisis saham + chart PNG |
| `/ekonomi` | `/ekonomi` | Ringkasan makro global |
| `/cari` | `/cari IPO terbaru 2026` | Web search + rangkuman AI |
| `/catatan` `/tugas` `/hapus` `/update` `/remind` | `/update 3 deadline 2026-05-15` | Kelola catatan/tugas/reminder |
| `/test` | `/test` | Tes koneksi AI router |

Chat natural tanpa command: saham/ekonomi/IPO auto-detect; "cuaca Malang besok", "gempa terbaru", "1 USD berapa IDR", "harga BTC rupiah", "PDB Indonesia 2023", "besok libur gak"; MoneyTracker & Calendar & Workspace lewat kalimat biasa; foto struk/PDF/DOCX auto-proses.

## Cara Kerja AI

Endpoint OpenAI-compatible (`ROUTER_BASE_URL`, model `ROUTER_MODEL`) dengan **multi-step tool calling** (maks 8 langkah per pesan), retry/backoff untuk 429/503, dan fallback parse SSE. Respon diatur persona [SOUL.md](SOUL.md) (dibaca runtime), teks polos (`stripMarkdown`), Bahasa Indonesia informal. Indikator typing native untuk chat; progress bar `0% → 100%` untuk interaksi menu & konfirmasi. Output tool di-cap 4.000 karakter; konten web diberi label data-bukan-instruksi.

## Keamanan & Privasi

- **Single-user gate**: semua update dari user selain `ALLOWED_USER_ID` ditolak sebelum handler.
- **Konfirmasi wajib** untuk semua tulis/edit/arsip eksternal (Sheets, Calendar, Trello, Notion, Superhuman) lewat `pending_actions` + tombol inline; hanya pemilik yang bisa konfirmasi.
- **Non-destruktif**: Trello/Notion diarsipkan (`closed`/`archived`), tidak pernah DELETE permanen; KB selalu read-only dengan validasi realpath.
- **Redaksi secret** otomatis pada error (`Bearer`, query `key/token/api_key/apikey`, path key ExchangeRate `/v6/…`, token bot/Notion/Trello, URL Apps Script).
- **Tanpa mirror** data eksternal di SQLite; secret hanya di env (`.env.local` di-gitignore), tidak pernah di source/test/docs.
- Test 100% offline dengan data dummy; repo public sehingga tidak ada ID personal/path lokal/kredensial di kode.

## Setup

### Prerequisites
- Node.js 22+
- API key endpoint OpenAI-compatible (`ROUTER_API_KEY`) + model pilihan

### Instalasi
```bash
git clone https://github.com/Mufid2225/ai-telegram-bot.git
cd ai-telegram-bot
npm install
cp .env.example .env.local   # lalu isi nilainya; JANGAN commit .env.local
```

Aplikasi memuat `.env.local` (`override: true`); kredensial opsional yang tidak tertulis di situ tetap dibaca dari OS/User Environment Variables.

**Wajib:** `BOT_TOKEN`, `ALLOWED_USER_ID`, `ROUTER_API_KEY`, `ROUTER_BASE_URL`, `ROUTER_MODEL`.

**Opsional — market & search:** `ALPHA_VANTAGE_KEY`, `FMP_API_KEY`, `TAVILY_API_KEY`, `SERPAPI_KEY`, `NEWSAPI_KEY`.

**Opsional — info & riset:** `JINA_API_KEY` (tanpa key tetap jalan 20 RPM), `COINGECKO_API_KEY` (Demo), `EXCHANGERATE_API_KEY` (tanpa key otomatis fallback Frankfurter). **Tanpa key sama sekali:** BMKG, Tanggal Merah, Open-Meteo, Frankfurter, World Bank Data360.

**Opsional — MoneyTracker/Calendar:** `SHEET_WEBHOOK_URL`, `SHEET_API_SECRET`.
**Opsional — workspace & KB:** `TRELLO_API_KEY`, `TRELLO_API_TOKEN`, `NOTION_API_KEY`, `SUPERHUMAN_API_TOKEN`, `KB_DIR`.
**Lain:** `CONVERSATION_RETENTION_DAYS` (default 90), `PORT` (default 3000).

#### Setup Google Apps Script (MoneyTracker & Calendar)
1. Google Sheets `MoneyTracker` → **Ekstensi → Apps Script**; tempel isi `apps-script/MoneyTracker.gs`.
2. Set Script Property `SHEET_API_SECRET` sama dengan nilai di `.env.local`.
3. (Calendar) Jalankan fungsi `authorizeCalendar` sekali → Allow.
4. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**.
5. Salin URL `/exec` ke `SHEET_WEBHOOK_URL`; restart bot.

### Menjalankan
```bash
npm start
```
atau PowerShell background runner: `scripts/nerissa-cli.ps1 start|status|stop`.
Bot connect long-polling, health check di `PORT`, dan membuat `data.db` otomatis.

### Test
```bash
npm test        # 206 test, 100% offline (mock fetch, SQLite :memory:, tmp dir)
node --check src/index.js
```

### Struktur
```text
SOUL.md            # Persona & aturan runtime bot
AGENTS.md          # Panduan AI coding agent repo ini
apps-script/       # Bridge Apps Script MoneyTracker & Calendar
docs/superpowers/  # Spec & implementation plan
scripts/           # CLI runner PowerShell
src/
├── index.js       # Entry point, wiring, allowlist, guard, poller, health, shutdown
├── config.js      # Validasi env
├── database.js    # Schema SQLite & pool
├── memory.js      # Knowledge graph & memory
├── tools.js       # Registrasi + dispatch gabungan AI tools
├── tools/         # targets (7), money-extra (3), workspace (15), calendar (5), research (7), info (7)
├── handlers/      # menu, money-menu, info-menu, workspace-menu, actions,
│                  # money, market, tasks, files, messages
├── services/      # ai, sheets, calendar, trello, notion, superhuman, kb,
│                  # market, alpha, fmp, chart, search, jina, bmkg, holidays,
│                  # coingecko, fx, weather, worldbank, pending, reminder,
│                  # workspace, inputRequest, money
└── utils/         # cache, telegram, errors, http, soul, infoInput
test/              # 206 test offline (node --test)
```

## Dependencies

`telegraf`, `better-sqlite3`, `yahoo-finance2`, `tesseract.js`, `pdf-parse`, `mammoth`, `dayjs`, `dotenv`, `canvas` + `chart.js` + `chartjs-node-canvas` (grafik PNG), native `fetch`.

## Catatan

- Kuota free tier kecil (Alpha Vantage 25/hari, CoinGecko 10k credits/bulan, ExchangeRate 1.500/bulan) — cache TTL di atas membuat pemakaian normal aman; kegagalan tidak di-cache agar retry mungkin.
- Atribusi wajib ditampilkan: BMKG, CoinGecko, Open-Meteo (CC-BY), World Bank (CC-BY), ExchangeRate-API (link sumber).
- Open-Meteo free tier **non-komersial**; bot personal aman, komersialisasi butuh tier berbayar.
- NewsAPI free tier menunda artikel ~24 jam; untuk berita real-time andalkan Tavily/Jina.
- Backup `data.db` bila datanya perlu dipertahankan; jangan commit `.env.local`, database, log, atau artefak chart.
- Pengguna hasil clone wajib memakai bot token & API key milik sendiri.
