'use strict';

require('dotenv').config();
const { startMainBot } = require('./bot');
const { startReportBot } = require('./reportBot');

console.log("=========================================");
console.log("Menjalankan Bot secara LOKAL (Mode Polling)");
console.log("=========================================\n");

process.on('unhandledRejection', (error) => {
  console.error('⚠️ [Peringatan Jaringan] Request ke database sedikit terhambat:', error.message);
});

try {
  const mainBot = startMainBot();
  const reportBot = startReportBot();

  // Mengaktifkan polling hanya untuk testing lokal
  mainBot.startPolling();
  reportBot.startPolling();

  // Mengirim notifikasi ke Super Admin
  const config = require('./config');
  // Notify all admins
  const allAdmins = new Set([...config.SUPER_ADMIN_IDS, ...config.ADMIN_IDS]);
  allAdmins.forEach(id => {
    mainBot.sendMessage(id, '🚀 Bot berhasil dijalankan di mode lokal (Polling).').catch(err => {
      console.error(`Gagal mengirim notif ke ${id}:`, err.message);
    });
  });

  console.log("✅ Main Bot dan Report Bot sedang berjalan.");
  console.log("💡 (Tekan Ctrl+C di terminal ini untuk berhenti)\n");
} catch (error) {
  console.error("❌ Gagal menjalankan bot:", error.message);
  console.log("👉 Pastikan Anda sudah mengisi MAIN_BOT_TOKEN dan REPORT_BOT_TOKEN di config.js atau .env");
}
