# Anonymous Chat Telegram Bot (Node.js)

Bot Telegram anonymous chat ringan dengan 2 bot:

1. **Bot Utama** (`bot.js`) untuk anonymous chat.
2. **Bot Report** (`reportBot.js`) untuk laporan pelanggaran + moderation queue admin.

Project ini menggunakan `node-telegram-bot-api` + `better-sqlite3`.
Semua data penting disimpan ke SQLite agar **tetap aman saat server restart**:
- users, active chats, waiting queue
- reports + report rate limits
- admin actions + broadcast logs

`sharedStore.js` sekarang hanya untuk data sementara (ephemeral runtime cache) seperti step report form dan rate limit pesan per window.

---

## Fitur Utama

### Bot Utama (Anonymous Chat)
- Pairing random user (`/search`) dengan antrean ringan.
- Status user: `idle`, `waiting`, `chatting`, `banned`.
- Forward pesan anonim (tanpa identitas partner):
  - text, photo, video, voice, sticker, document, animation, audio, video note.
- `/stop` untuk berhenti chat.
- `/next` untuk ganti partner.
- `/report` membuat `report_id` + deep link ke bot report.
- Tidak menyimpan isi chat user.

### Bot Report (Report Management)
- User submit laporan via deep link: `/start report_REPORTID`.
- Wajib upload:
  1. screenshot (photo),
  2. deskripsi,
  3. jenis pelanggaran.
- Report queue admin dengan status:
  - `pending_evidence`, `submitted`, `under_review`, `resolved`, `rejected`, `banned`.
- Lock report ke admin agar tidak diproses dobel.

### Admin Bot Utama
- `/stats`
- `/users [PAGE]`
- `/activeusers [PAGE]`
- `/waitingusers [PAGE]`
- `/chattingusers [PAGE]`
- `/broadcast isi pesan`
- `/ban USER_ID alasan`
- `/unban USER_ID`
- `/banned [PAGE]`
- `/userinfo USER_ID`

---

## Arsitektur Singkat

- `database.js` adalah pusat persistence SQLite (`bot_data.sqlite`):
  - inisialisasi koneksi + schema + index
  - prepared statements
  - helper CRUD untuk user/chat/report/admin log/broadcast log
- `sharedStore.js` hanya menyimpan cache runtime non-persistent:
  - `messageRateLimits`
  - `reportSteps`
  - `runtimeState`
- `index.js` menjalankan dua bot sekaligus:
  - `startMainBot()` dari `bot.js`
  - `startReportBot()` dari `reportBot.js`

> Catatan: karena SQLite adalah file lokal, untuk multi-instance horizontal Anda perlu migrasi ke database server (mis. PostgreSQL).

---

## Instalasi & Menjalankan

## 1) Install dependency
```bash
npm install
```

Atau manual:
```bash
npm install node-telegram-bot-api better-sqlite3
```

## 2) Isi konfigurasi
Edit `config.js`:
- `MAIN_BOT_TOKEN`
- `REPORT_BOT_TOKEN`
- `DB_FILE` (contoh: `bot_data.sqlite`)
- `MAIN_BOT_USERNAME`
- `REPORT_BOT_USERNAME`
- `ADMIN_IDS`
- `SUPER_ADMIN_IDS`

## 3) Jalankan bot
```bash
node index.js
```

---

## Struktur File

```txt
.
├── database.js      # SQLite schema, prepared statements, CRUD
├── bot.js           # Bot utama anonymous chat + admin main bot
├── reportBot.js     # Bot report + admin moderation queue
├── sharedStore.js   # Ephemeral runtime cache (non-persistent)
├── config.js        # Konfigurasi token, admin, limit, messages
├── index.js         # Entrypoint jalankan dua bot dalam satu proses
├── package.json
└── README.md
```

---

## Konfigurasi (`config.js`)

Konfigurasi penting:

- `MAIN_BOT_TOKEN`
- `REPORT_BOT_TOKEN`
- `DB_FILE`
- `MAIN_BOT_USERNAME`
- `REPORT_BOT_USERNAME`
- `ADMIN_IDS`
- `SUPER_ADMIN_IDS`
- `REPORT_LIMIT_PER_DAY`
- `REPORT_COOLDOWN_MS`
- `ADMIN_NOTIFICATION_COOLDOWN_MS`
- `ACTIVE_USER_WINDOW_MS`
- `ADMIN_LIST_PAGE_SIZE`
- `BROADCAST_DELAY_MS`
- `USER_MESSAGE_RATE_LIMIT`
- `ADMIN_COMMANDS`
- `MESSAGES`

Contoh default admin multi user:
```js
ADMIN_IDS: [123456789, 987654321, 111222333]
```

---

## Daftar Command

### A) Bot Utama - User
- `/start`
- `/help`
- `/search`
- `/stop`
- `/next`
- `/report`

### B) Bot Utama - Admin
- `/stats`
- `/users` atau `/users PAGE`
- `/activeusers` atau `/activeusers PAGE`
- `/waitingusers` atau `/waitingusers PAGE`
- `/chattingusers` atau `/chattingusers PAGE`
- `/broadcast isi pesan`
- `/ban USER_ID alasan`
- `/unban USER_ID`
- `/banned` atau `/banned PAGE`
- `/userinfo USER_ID`

### C) Bot Report - User
- `/start report_REPORTID`
- `/mystatus`

### D) Bot Report - Admin
- `/admin`
- `/reports`
- `/nextreport`
- `/claim REPORT_ID`
- `/release REPORT_ID`
- `/resolve REPORT_ID catatan_admin`
- `/reject REPORT_ID alasan`
- `/banreported REPORT_ID alasan`
- `/banreporter REPORT_ID alasan`
- `/reportdetail REPORT_ID`
- `/myreports`
- `/reportstats`

---

## Alur Penggunaan

### 1) Anonymous Chat
1. User A kirim `/search`.
2. User B kirim `/search`.
3. Bot pairing random → status keduanya jadi `chatting`.
4. Pesan diteruskan anonim via `copyMessage`.

### 2) Report via Bot Kedua
1. Saat chat aktif, user kirim `/report` di bot utama.
2. Bot utama buat `report_id` (`pending_evidence`) dan kirim deep link:
   - `https://t.me/<REPORT_BOT_USERNAME>?start=report_<REPORT_ID>`
3. User pindah ke bot report, upload screenshot + deskripsi + violation type.
4. Report jadi `submitted` dan masuk queue admin.

### 3) Moderasi Admin
1. Admin ambil report via `/nextreport` atau `/claim REPORT_ID`.
2. Report dilock ke admin tersebut (`under_review`).
3. Admin putuskan:
   - `/resolve`,
   - `/reject`,
   - `/banreported`,
   - `/banreporter`.

---

## Keamanan & Privasi

- Identitas partner tidak dibuka ke user lain.
- Isi chat anonim **tidak disimpan**.
- Isi chat tidak di-log ke console/file.
- Report evidence disimpan sebagai **Telegram `file_id`** (bukan file lokal).
- Screenshot/evidence **tidak diunduh** ke disk server.
- Admin command divalidasi dengan `isAdmin()`.
- Ban/unban memvalidasi target `USER_ID`.
- Admin non-super tidak bisa ban admin lain.
- Broadcast skip user banned.
- Error handling memakai wrapper `try/catch` agar bot tidak mudah crash.

---

## Struktur Data Penting

Semua data utama disimpan di SQLite:
- `users`
- `active_chats`
- `waiting_queue`
- `reports`
- `report_rate_limits`
- `admin_actions`
- `broadcast_logs`

Contoh status user di DB:
- `idle`
- `waiting`
- `chatting`
- `banned`

---

## Rate Limit yang Dipakai

- User message rate limit di bot utama (`USER_MESSAGE_RATE_LIMIT`).
- Anti spam report:
  - max `REPORT_LIMIT_PER_DAY` per 24 jam,
  - cooldown antar report `REPORT_COOLDOWN_MS`,
  - maksimal 1 report aktif/user dalam satu waktu.
- Notifikasi report ke admin dibatasi `ADMIN_NOTIFICATION_COOLDOWN_MS`.

---

## SQLite: Cocok untuk Apa?

SQLite **sangat cocok** untuk tahap awal/menengah bot Telegram seperti ini karena:
- setup cepat, tanpa server DB terpisah
- resource ringan
- performa baik untuk workload read-heavy dan write moderat
- reliability baik untuk single host (ditambah WAL mode)

Dengan desain saat ini (single process polling, dua bot, metadata-only), SQLite sudah tepat dan efisien.

## Batasan SQLite untuk Skala Besar

Walau cukup untuk banyak use case bot, SQLite punya keterbatasan:
- tidak ideal untuk banyak writer paralel lintas proses/host
- sulit untuk horizontal scaling multi-instance
- operasi maintenance/backup perlu perhatian jika traffic sangat tinggi
- observability dan failover tidak sekuat DB server kelas production

---

## Rekomendasi Produksi

- **Redis**: queue, distributed lock, session, shared rate limit cache.
- **PostgreSQL**: migrasi data utama saat butuh multi-instance horizontal.
- **Webhook** (lebih efisien dari polling untuk skala besar).
- **PM2** atau **Docker** untuk process management.
- Tambahkan backup report + audit log terpisah.
- Gunakan rate limiter terdistribusi (Redis-based).

---

## Catatan Menjalankan

Pastikan username bot di `config.js` benar (tanpa `@`) agar deep link report valid.

Contoh:
```js
MAIN_BOT_USERNAME: 'my_main_bot',
REPORT_BOT_USERNAME: 'my_report_bot'
```

Jika butuh, saya bisa bantu lanjut buat script migrasi dari SQLite ke PostgreSQL + checklist load test sebelum production.
