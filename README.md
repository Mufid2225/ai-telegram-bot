# Nerrisa Bot — Telegram AI Assistant

Telegram bot asisten pintar dengan kemampuan analisis saham, trading, ekonomi global, manajemen tugas sekolah, file processing, dan web search. Ditenagai oleh AI (9router) dengan data real-time dari Yahoo Finance, Alpha Vantage, Financial Modeling Prep, dan web search API.

## Bot Bisa Ngapain Aja?

### 1. Analisis Saham (`/saham BBCA`)
Data real-time dari Yahoo Finance (harga, perubahan, volume) + fundamental dari FMP (PE, PB, EPS, ROE, margin) + indikator teknikal dari Alpha Vantage (RSI, MACD, BBANDS) + sentimen berita. Semua data dikumpulin, dikasih ke AI, AI analisa dan kirim hasilnya.

### 2. Analisis Trading (`/trade XAUUSD`)
Forex (EURUSD, GBPUSD, dll), komoditas (emas, perak, minyak, tembaga, gas, gandum, jagung, kopi, gula, kapas, platinum, paladium), crypto (BTC, ETH). Lengkap dengan support/resistance, RSI, Bollinger Bands.

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
Hasilnya dikasih ke AI untuk dianalisis / dirangkum.

### 7. Web Search (`/cari` + Auto)
Cari info real-time dari internet. Chain: **Tavily** (primer) → **NewsAPI** (berita Indonesia) → **SerpAPI** (Google fallback). Bisa manual (`/cari IPO terbaru`) atau auto-detect kalo user nanya informasi terkini.

### 8. Memory & Knowledge Graph
Bot ingat fakta tentang user lewat knowledge graph (entity → attribute → value). Misal: "Sarah ulang tahun 15 Agustus" → disimpan, bisa dipanggil lagi kalo ditanya.

## Arsitektur Bot

```
                        ┌─────────────────────────────────────┐
                        │         Telegram Bot (index.js)       │
                        │         Telegraf framework             │
                        └──────┬──────┬──────┬──────┬──────────┘
                               │      │      │      │
              ┌────────────────┘      │      │      └──────────────────┐
              ▼                       ▼      ▼                         ▼
     ┌──────────────────┐   ┌──────────────┐   ┌───────────────┐  ┌───────────┐
     │    AI Engine      │   │  Market Data  │   │   Database    │  │  Search   │
     │  9router /        │   │  (3 sumber)   │   │   SQLite      │  │  Web      │
     │  PersonalAssistant │   │              │   │               │  │           │
     └──────────────────┘   └──────┬───────┘   └───────┬───────┘  └─────┬─────┘
                                   │                    │                │
                                   ▼                    ▼                ▼
                          ┌────────────────┐    ┌────────────┐    ┌──────────────┐
                          │ Yahoo Finance  │    │  memories  │    │   Tavily     │
                          │  - Quote       │    │    tugas   │    │   (primer)   │
                          │  - News        │    │  convers.  │    │              │
                          │  - Search      │    │  knowl.    │    │   NewsAPI    │
                          │                │    │   graph    │    │   (fallback) │
                          │ Alpha Vantage  │    └────────────┘    │              │
                          │  - 65 fungsi   │                     │   SerpAPI    │
                          │  - Teknikal    │                     │   (last)     │
                          │  - Fundamental │                     └──────────────┘
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

Table `memories` — tugas dan catatan user
Table `conversations` — riwayat chat (10 terakhir per user)
Table `knowledge` — knowledge graph (entity → attribute → value)

## Perintah (Commands)

### Saham & Trading
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/saham` | `/saham BBCA` | Analisis saham lengkap (harga, fundamental, teknikal, berita) |
| `/trade` | `/trade XAUUSD` | Analisis trading forex/komoditas/crypto |
| `/ekonomi` | `/ekonomi` | Ringkasan data ekonomi global terkini |

### Manajemen Tugas
| Command | Contoh | Fungsi |
|---------|--------|--------|
| `/tugas` | `/tugas` | Lihat semua tugas tersimpan |
| `/hapus` | `/hapus 3` | Hapus tugas berdasarkan ID |
| `/update` | `/update 3 deadline 2026-07-15` | Update field tugas |
| `/remind` | `/remind` | Reminder deadline hari ini & besok |

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
- Tanpa emoji
- Bahasa Indonesia informal
- Berdasarkan data real-time yang di-inject ke system prompt

## Setup

### Prerequisites
- Node.js 18+
- 9router running di `localhost:20128` (atau router API lain)

### Instalasi
```bash
git clone <repo-url>
cd telegram-ai-bot
npm install
```

### Environment Variables
Buat file `.env`:
```env
BOT_TOKEN=telegram_bot_token_dari_botfather
ROUTER_API_KEY=sk-... (api key 9router)
ROUTER_BASE_URL=http://localhost:20128/v1
ROUTER_MODEL=PersonalAssistant
ALPHA_VANTAGE_KEY=dapatkan_di_alphavantage.co
TAVILY_API_KEY=dapatkan_di_tavily.com
SERPAPI_KEY=dapatkan_di_serpapi.com
NEWSAPI_KEY=dapatkan_di_newsapi.org
```

### Menjalankan
```bash
npm start
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
- Bot menggunakan SQLite local — data tidak akan hilang selama file `data.db` ada
