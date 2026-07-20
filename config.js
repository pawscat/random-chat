'use strict';

module.exports = {
  MAIN_BOT_TOKEN: '8356605064:AAHHbsnwpxQDAL4iCCxPmxATDtYzjiwNwKo',
  REPORT_BOT_TOKEN: '8333226823:AAEZ0c1QDfXGRXZMTNo7VY79GaEFbaMnuMA',

  // Konfigurasi Database Turso & Vercel
  TURSO_DATABASE_URL: 'libsql://random-chat-db-pawscat.aws-ap-northeast-1.turso.io',
  TURSO_AUTH_TOKEN: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODQyMjQ5NDIsImlkIjoiMDE5ZjZjMTctOTkwMS03ZGVhLTg0M2EtOWU3NGY3NGI4NTIyIiwia2lkIjoiamdpLVVsSndJNTBlekhuNUpiTDVfd214TmQ1QURJeHBldjNZemwxVlpybyIsInJpZCI6IjY1NmY0NDMwLTkyYTctNGZmMy05YTA1LTM2OGRkYjc5NjNiMSJ9._xLpqYWRxKUTVbR7wnarEhcSNxCJUT737yWiQx2wwcWR-3_NWfQpE6Ef7wffQFEkXlBQHKuPBXRKRp-p952ECw',
  WEBHOOK_URL: 'https://random-chat-nu.vercel.app/api/webhook',

  DB_FILE: 'bot_data.sqlite',
  DASHBOARD_PASSWORD: 'adminrahasia', // Password login web dashboard
  MAIN_BOT_USERNAME: 'randomchating_bot',
  REPORT_BOT_USERNAME: 'randomreport_bot',
  ADMIN_IDS: [8637897098, 6255931724],
  SUPER_ADMIN_IDS: [8637897098],
  BOT_NAME: 'Random Chatting Bot',
  REPORT_LIMIT_PER_DAY: 3,
  REPORT_COOLDOWN_MS: 60 * 1000,
  ADMIN_NOTIFICATION_COOLDOWN_MS: 5 * 60 * 1000,
  ACTIVE_USER_WINDOW_MS: 10 * 60 * 1000,
  ADMIN_LIST_PAGE_SIZE: 20,
  BROADCAST_DELAY_MS: 50,
  ADMIN_COMMANDS: {
    STATS: '/stats',
    USERS: '/users',
    ACTIVE_USERS: '/activeusers',
    WAITING_USERS: '/waitingusers',
    CHATTING_USERS: '/chattingusers',
    BROADCAST: '/broadcast',
    BAN: '/ban',
    UNBAN: '/unban',
    BANNED: '/banned',
    USER_INFO: '/userinfo',
    PING: '/ping',
    SERVER: '/server',
    ADMIN: '/admin'
  },
  USER_MESSAGE_RATE_LIMIT: {
    windowMs: 3000,
    maxMessages: 5
  },
  MAX_REPORT_DESCRIPTION_LENGTH: 700,
  MAX_ADMIN_NOTE_LENGTH: 500,
  REPORT_VIOLATION_TYPES: [
    'chat tidak senonoh',
    'pelecehan',
    'spam',
    'ancaman',
    'penipuan',
    'konten ilegal',
    'lainnya'
  ],
  MESSAGES: {
    banned: 'Akun kamu diblokir dari bot ini karena melanggar aturan.',
    unbanned: 'Akun kamu sudah dibuka kembali dan bisa menggunakan bot.',
    start: 'Selamat datang di Random Chatting Bot. Gunakan /search untuk mencari partner anonim.',
    help: [
      'Perintah user:',
      '/start - Mulai bot',
      '/search - Cari partner anonim',
      '/stop - Hentikan chat sekarang',
      '/next - Ganti partner',
      '/report - Laporkan partner aktif',
      '/help - Bantuan'
    ].join('\n'),
    alreadyWaiting: 'Anda sudah berada di antrean. Mohon tunggu partner.',
    waiting: 'Sedang mencari partner anonim...',
    partnerFound: 'Partner ditemukan. Chat dimulai secara anonim. Gunakan /stop atau /next kapan saja.',
    noActiveChat: 'Anda belum dalam chat aktif. Gunakan /search.',
    chatStopped: 'Chat dihentikan.',
    partnerStopped: 'Partner telah mengakhiri chat.',
    rateLimitedMessage: 'Terlalu cepat mengirim pesan. Coba beberapa detik lagi.',
    unsupportedMessage: 'Jenis pesan belum didukung. Kirim text/photo/video/voice/sticker/document/animation/audio/video note.',
    reportOnlyInChat: 'Anda hanya bisa report saat sedang chatting dengan partner.',
    reportCreated: 'Laporan dibuat. Lanjutkan di bot report melalui link berikut:',
    reportLimitExceeded: 'Batas laporan harian tercapai (maksimal 3 per 24 jam).',
    reportCooldown: 'Anda terlalu cepat membuat report. Tunggu minimal 60 detik antar report.',
    reportAlreadyActive: 'Anda masih punya laporan aktif. Selesaikan dulu sebelum membuat laporan baru.',
    adminOnly: 'Perintah ini hanya untuk admin.',
    adminNewReportNotification: 'Ada laporan baru masuk. Gunakan /nextreport untuk mengambil laporan.'
  },

  // Fungsi untuk memuat pengaturan dinamis dari database
  loadDynamicConfig: async function(database) {
    try {
      const state = await database.getRuntimeState('dynamic_settings');
      if (state) {
        const parsed = JSON.parse(state);
        for (const key in parsed) {
          if (key !== 'loadDynamicConfig' && key !== 'TURSO_DATABASE_URL' && key !== 'TURSO_AUTH_TOKEN' && this.hasOwnProperty(key)) {
            this[key] = parsed[key];
          }
        }
      }
    } catch (e) {
      console.error('Failed to load dynamic config:', e);
    }
  }
};
