# Nerrisa Bot — Telegram AI Assistant

Telegram bot asisten pintar dengan kemampuan analisis saham, trading, ekonomi global, manajemen tugas sekolah, file processing, dan web search. Ditenagai oleh AI (9router) dengan data real-time dari Yahoo Finance, Alpha Vantage, Financial Modeling Prep, dan web search API.

## Akses

- Bot Telegram: [@nerrisa_Bot](https://t.me/nerrisa_Bot)
- Source code: [github.com/Mufid2225/ai-telegram-bot](https://github.com/Mufid2225/ai-telegram-bot)

Bot bersifat privat. Link bot dapat dibuka oleh siapa saja, tetapi hanya Telegram user ID yang dikonfigurasi melalui `ALLOWED_USER_ID` yang dapat menggunakan perintah dan mengirim permintaan.

## Bot Bisa Ngapain Aja?

### 1. Analisis Saham (`/saham BBCA`)
Data real-time dari Yahoo Finance (harga, perubahan, volume) + fundamental dari FMP (PE, PB, EPS, ROE, margin) + indikator teknikal dari Alpha Vantage (RSI, MACD, BBANDS) + sentimen berita. Semua data dikumpulin, dikasih ke AI, AI analisa dan kirim hasilnya.

### 2. Analisis Market Otomatis
Pertanyaan tentang forex, komoditas, crypto, dan indeks dideteksi dari chat biasa. Contoh: "XAUUSD gimana hari ini?" atau "analisa Bitcoin".

### 3. Analisis Ekonomi Makro (`/ekonomi`)
Data ekonomi global: CPI, Fed Rate, Inflasi, GDP, tingkat pengangguran, Treasury Yield, Retail Sales, harga minyak WTI, harga emas & perak. Dirangkum AI dengan dampaknya ke pasar.

### 4. Chat Biasa (Auto-detect Market)
User tinggal nanya "BBCA gimana?" — bot auto-detect kode saham, ambil data market, dan jawab pake AI. Juga detek pertanyaan ekonomi ("inflasi naik?"), web search otomatis ("IPO terbaru?"), dan tugas sekolah.

### 5. Manajemen Tugas Sekolah
Simpan tugas otomatis dari chat. Commands: `/tugas` (lihat semua), `/hapus 3` (hapus), `/update 3 deadline 2026-07-15` (edit), `/remind` (reminder deadline hari ini & besok). Bisa kirim foto tugas, bot OCR + simpen otomatis.

### 6. File Processing
- **Foto** — OCR pake Tesseract.js (extract teks dari gambar)
- **PDF** — Extract teks pake pdf-parse
- **DOCX** — Extract teks pake mammoth
Hasilnya dikasih ke AI untuk dianalisis / dirangkum. Ukuran file dibatasi 10 MB dan teks hasil ekstraksi dibatasi 30.000 karakter.

### 7. Web Search (`/cari` + Auto)
Cari info real-time dari internet. Chain: **Tavily** (primer) → **NewsAPI** (berita Indonesia) → **SerpAPI** (Google fallback). Bisa manual (`/cari IPO terbaru`) atau auto-detect kalo user nanya informasi terkini.

### 9. MoneyTracker (Google Sheets Live Sync + Chat / OCR)
Terhubung langsung ke Google Sheets `MoneyTracker` via Google Apps Script Web App sebagai *single source of truth*:
- `/keuangan` — ringkasan `Dashboard` (Income, Alokasi, Realisasi, Saldo, overbudget) + grafik PNG
- `/pengeluaran` — daftar transaksi terbaru dari tab `Expenses`
- `/catat` atau chat natural / foto struk — ekstraksi transaksi otomatis dengan konfirmasi tombol `[Simpan]` / `[Batal]` sebelum menulis ke sheet
- Konsultasi budget & simulasi mingguan (tanpa mencatatkan transaksi palsu)

### 10. Catatan & Reminder Persisten
Catatan biasa (`/catatan`), fakta user (`knowledge`), dan reminder terjadwal (`/remind`) tersimpan permanen di SQLite lokal (`data.db`) dan tidak hilang saat server restart.

### 11. Workspace & Knowledge Base (`/menu` + Natural Chat)
Integrasi opsional yang dapat dipilih langsung dari `/menu` (dengan indikator loading `0% → 100%` dan konteks aktif):
- **Trello** — pilih board secara live, lihat ringkasan list terpaginasi, cari card, serta tambah/pindah/arsipkan card dengan tombol konfirmasi (`Simpan` / `Batal`)
- **Notion** — pilih database/page yang terhubung ke integrasi Notion, lihat schema properti & baris terbaru, serta tambah/update/arsipkan baris dengan verifikasi baca ulang
- **Superhuman Docs** — pilih dokumen & tabel, cek akses `write`/`read-only`, serta tambah/update baris tabel dengan polling mutasi async
- **Knowledge Base (Read-Only)** — jelajahi folder & baca catatan Markdown lokal (`KB_DIR`) secara aman dengan proteksi path traversal

## Arsitektur Bot

```
                        ┌─────────────────────────────────────┐
                        │         Telegram Bot (index.js)     │
                        │         Telegraf framework          │
                        └──────┬──────┬──────┬──────┬─────────┘
                               │      │      │      │
              ┌────────────────┘      │      │      └──────────────────┐
              ▼                       ▼      ▼                         ▼
     ┌──────────────────┐   ┌──────────────┐   ┌───────────────┐  ┌───────────┐
     │    AI Engine     │   │  Market Data │   │   Database    │  │  Search   │
     │  9router /       │   │  (3 sumber)  │   │   SQLite      │  │  Web      │
     │ PersonalAssistant│   │              │   │               │  │           │
     └──────────────────┘   └──────┬───────┘   └───────┬───────┘  └─────┬─────┘
                                   │                   │                │
                                   ▼                   ▼                ▼
                          ┌────────────────┐    ┌────────────┐    ┌──────────────┐
                          │ Yahoo Finance  │    │  memories  │    │   Tavily     │
                          │  - Quote       │    │    tugas   │    │   (primer)   │
                          │  - News        │    │  convers.  │    │              │
                          │  - Search      │    │  knowl.    │    │   NewsAPI    │
                          │                │    │   graph    │    │   (fallback) │
                          │ Alpha Vantage  │    └────────────┘    │              │
                          │  - 65 fungsi   │                      │   SerpAPI    │
                          │  - Teknikal    │                      │   (last)     │
                          │  - Fundamental │                      └──────────────┘
                          │  - Ekonomi     │
                          │                │
                          │ FMP            │
                          │  - Profile     │
                          │  - Rasio       │
                          └────────────────┘
```

### Alur Data (Contoh: `/saham BBCA`)

```
User: /saham BBCA
   │
   ├─ Yahoo Finance  → Harga real-time, perubahan, volume, high/low
   ├─ Yahoo Finance  → 4 berita terkait BBCA
   ├─ Alpha Vantage  → Sentimen berita (news sentiment)
   ├─ FMP            → Profil perusahaan (sektor, industri, CEO, market cap)
   ├─ FMP            → Rasio keuangan (PE, PB, EPS, ROE, margin, D/E)
   ├─ Alpha Vantage  → Earnings terbaru
   ├─ Alpha Vantage  → RSI (indikator teknikal)
   └─ Alpha Vantage  → Top gainers/losers pasar
        │
        ▼
   Semua data dikumpulkan → diformat → dimasukkan ke system prompt AI
   → AI menganalisis (teknikal + fundamental + sentimen + risiko)
   → Bot kirim hasil analisis ke user
```

### Alur Chat Biasa (Auto-detect Market)

```
User: "BBCA gimana hari ini?"
   │
   ├─ detectSymbol("BBCA") → "BBCA.JK"
   ├─ Yahoo Finance → Quote + berita
   ├─ Alpha Vantage → RSI + sentimen
   ├─ FMP → Profil + rasio
   ├─ Memory → Tugas/catatan user sebelumnya
   ├─ Knowledge graph → Fakta tentang user
   └─ Conversations → 10 pesan terakhir
        │
        ▼
   → AI jawab dengan konteks lengkap
```

### Alur Web Search (Auto-detect)

```
User: "IPO terbaru apa?"
   │
   ├─ detectSearchNeeded() → true (trigger: "IPO" + "terbaru")
   ├─ buildSearchQuery() → "IPO terbaru 2026 Indonesia"
   ├─ webSearch():
   │   1. Tavily (retry 2x)
   │   2. NewsAPI (30 hari terakhir)
   │   3. SerpAPI (Google fallback)
   │   4. Simple query fallback (5 kata terakhir)
   │
   ├─ Sukses → "Informasi terkini: [...]" → AI jawab pake data real-time
   └─ Gagal → Bot kirim panduan manual (IDX/e-IPO/sekuritas)
```

## Sumber Data & API

| Modul | Sumber | Limit | Fungsi |
|-------|--------|-------|--------|
| `market.js` | Yahoo Finance | ~unlimited | Quote real-time, berita, search simbol |
| `alpha.js` | Alpha Vantage | 25 req/hari | 65 fungsi: teknikal (RSI, MACD, BBANDS, SMA, dll), fundamental (earnings, overview), ekonomi (CPI, GDP, Fed Rate, inflasi, unemployment), komoditas (WTI, Brent, emas, tembaga, gandum, dll), forex, crypto, sentimen, top gainers |
| `fmp.js` | Financial Modeling Prep | 250 req/hari | Profil perusahaan, rasio keuangan (PE, PB, EPS, ROE, margin, D/E) |
| `search.js` | Tavily | 1000 req/bulan | Web search AI-optimized (primer) |
| `search.js` | NewsAPI | 100 req/hari | Berita bahasa Indonesia (fallback) |
| `search.js` | SerpAPI | 100 search/bulan | Google search (fallback terakhir) |

## Database (SQLite)

- Table `memories` — tugas dan catatan user
- Table `conversations` — riwayat chat; 10 pesan terakhir dipakai sebagai konteks AI
- Table `knowledge` — knowledge graph (entity → attribute → value)
- Table `reminders` — jadwal reminder persisten (tetap tersimpan saat server restart)
- Table `pending_actions` — draft konfirmasi tombol untuk aksi tulis Google Sheets & Workspace (TTL 24 jam)
- Table `active_context` — menyimpan sumber workspace terakhir yang dibuka user di `/menu`
- Table `callback_refs` — referensi pendek 8-karakter agar `callback_data` tombol inline Telegram selalu di bawah batas 64 byte

Percakapan lama dibersihkan saat startup berdasarkan `CONVERSATION_RETENTION_DAYS` (default 90 hari). Database lokal, WAL, dan file environment sudah diabaikan oleh Git.

## Perintah (Commands)

### Menu & MoneyTracker (Google Sheets)
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/menu` | `/menu` (atau `/start`) | Menu interaktif dengan inline button yang berganti halaman langsung |
| `/catat` | `/catat bensin 25rb cash` | Buat draft catat pengeluaran/pemasukan dengan tombol konfirmasi |
| `/keuangan` | `/keuangan november` | Ringkasan Dashboard (Income, Alokasi, Realisasi, Saldo) + grafik PNG |
| `/pengeluaran` | `/pengeluaran november` | Daftar transaksi terbaru dari tab `Expenses` (beserta nomor baris) |

### Market
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/saham` | `/saham BBCA` | Analisis saham lengkap (harga, fundamental, teknikal, berita) |
| `/ekonomi` | `/ekonomi` | Ringkasan data ekonomi global terkini |

### Manajemen Tugas, Catatan & Reminder
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/catatan` | `/catatan` | Lihat catatan, tugas, dan memo tersimpan |
| `/tugas` | `/tugas` | Lihat daftar tugas tersimpan |
| `/hapus` | `/hapus 3` | Hapus catatan/tugas berdasarkan ID |
| `/update` | `/update 3 deadline 2026-05-15` | Update field tugas |
| `/remind` | `/remind` | Lihat reminder terjadwal & deadline tugas hari ini/besok |

### Web Search
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/cari` | `/cari IPO terbaru 2026` | Cari info dari internet |

### Utility
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/test` | `/test` | Test koneksi ke AI router |

### Auto-detect (Tanpa Command)
- **Saham**: "BBCA gimana?" → auto-analisis
- **Ekonomi**: "inflasi naik?" → auto-ambil data ekonomi
- **IPO**: "IPO terbaru?" → auto-web search
- **Tugas**: "tugas matematika deadline besok" → auto-simpan
- **File**: kirim foto/PDF/DOCX → auto-proses OCR/extract

## Cara Kerja AI

Bot menggunakan **9router** sebagai AI engine dengan model combo **PersonalAssistant** yang merouting ke beberapa model NVIDIA (Nemotron, Mistral, dll). Semua respon AI:

- Natural & santai (kayak ngobrol)
- Tanpa markdown (dibersihkan via `stripMarkdown()`)
- Natural & ramah (boleh pakai emoji secukupnya)
- Bahasa Indonesia informal
- Berdasarkan data real-time yang di-inject ke system prompt

## Setup

### Prerequisites
- Node.js 22+
- 9router running di `localhost:20128` (atau router API lain)

### Instalasi
```bash
git clone https://github.com/Mufid2225/ai-telegram-bot.git
cd ai-telegram-bot
npm install
```

### Environment Variables
Salin `.env.example` menjadi `.env.local`, lalu isi nilainya. Aplikasi hanya memuat `.env.local`:
```bash
cp .env.example .env.local
```

Jangan commit `.env.local`. `ALLOWED_USER_ID` diisi dengan numeric Telegram user ID pemilik bot.

Konfigurasi wajib:
- `BOT_TOKEN`
- `ALLOWED_USER_ID`
- `ROUTER_API_KEY`
- `ROUTER_BASE_URL`
- `ROUTER_MODEL`

Konfigurasi MoneyTracker (Google Sheets Apps Script — opsional):
- `SHEET_WEBHOOK_URL`
- `SHEET_API_SECRET`

#### Setup Google Apps Script (`MoneyTracker`)
1. Buka Google Sheets `MoneyTracker` → menu **Ekstensi → Apps Script**.
2. Salin seluruh isi `apps-script/MoneyTracker.gs` ke editor Apps Script lalu simpan.
3. Atur `SHEET_API_SECRET` (di **Project Settings → Script Properties** atau variabel `FALLBACK_API_SECRET`) agar sama dengan nilai `SHEET_API_SECRET` di `.env.local`.
4. Klik **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Salin URL `/exec` ke `SHEET_WEBHOOK_URL` di `.env.local`, lalu restart bot.

Konfigurasi provider opsional:
- `ALPHA_VANTAGE_KEY`
- `FMP_API_KEY`
- `TAVILY_API_KEY`
- `SERPAPI_KEY`
- `NEWSAPI_KEY`

Konfigurasi Workspace & Knowledge Base (opsional):
- `TRELLO_API_KEY` & `TRELLO_API_TOKEN`
- `NOTION_API_KEY`
- `SUPERHUMAN_API_TOKEN`
- `KB_DIR` (path ke folder Markdown/Obsidian vault lokal, read-only)

Konfigurasi lain:
- `CONVERSATION_RETENTION_DAYS` — default 90 hari
- `PORT` — default 3000

Aplikasi berhenti saat startup jika konfigurasi wajib kosong atau tidak valid. Semua pengguna selain `ALLOWED_USER_ID` diabaikan.

### Struktur
```text
SOUL.md            # Kepribadian & gaya bicara bot Nerissa (dibaca runtime)
AGENTS.md          # Panduan AI coding agent untuk pengembangan repo ini
apps-script/       # Google Apps Script Web App untuk MoneyTracker
src/
├── index.js       # Entry point dan wiring Telegram
├── config.js      # Validasi konfigurasi
├── database.js    # SQLite
├── memory.js      # Knowledge dan memory
├── tools.js       # Definisi AI tools
├── handlers/      # Handler menu, money, task, market, file, dan pesan
├── utils/         # Helper Telegram, error formatter, dan loader SOUL.md
└── services/      # Integrasi AI, Google Sheets, reminder, market, chart, dan search
```

### Menjalankan
```bash
npm start
```

Atau di Windows PowerShell (background runner dengan status health-check):
```powershell
powershell -ExecutionPolicy Bypass -File scripts/nerissa-cli.ps1 start
powershell -ExecutionPolicy Bypass -File scripts/nerissa-cli.ps1 status
powershell -ExecutionPolicy Bypass -File scripts/nerissa-cli.ps1 stop
```

### Test
```bash
npm test
```

Bot akan:
- Connect ke Telegram (long polling)
- Health check server di port 3000
- SQLite database otomatis dibuat (`data.db`)

## Dependencies

- `telegraf` — Telegram bot framework
- `yahoo-finance2` — Yahoo Finance API
- `better-sqlite3` — SQLite database
- `tesseract.js` — OCR untuk gambar
- `pdf-parse` — Baca file PDF
- `mammoth` — Baca file DOCX
- `dayjs` — Manipulasi tanggal
- `dotenv` — Environment variables

## Catatan

- Alpha Vantage free tier: 25 request/hari — gunakan untuk data prioritas (RSI, earnings, CPI)
- FMP free tier: 250 request/hari — cukup untuk analisis fundamental harian
- Tavily free tier: 1000 request/bulan — untuk web search
- Bot menggunakan SQLite lokal; backup `data.db` jika datanya perlu dipertahankan
- Jangan commit `.env.local`, database, log, atau artefak chart pengujian
- Pengguna hasil clone harus memakai bot token, router, dan API key milik sendiri
