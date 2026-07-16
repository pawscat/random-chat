'use strict';

require('dotenv').config();
const config = require('../config');
const TelegramBot = require('node-telegram-bot-api');

async function setupWebhooks() {
  const vercelDomain = config.WEBHOOK_URL;
  if (!vercelDomain || vercelDomain === 'ISI_URL_VERCEL_DISINI') {
    console.error('Error: Variabel WEBHOOK_URL di config.js belum diatur.');
    console.error('Contoh: WEBHOOK_URL: \'https://nama-proyek-anda.vercel.app/api/webhook\'');
    process.exit(1);
  }

  const mainUrl = `${vercelDomain}?bot=main`;
  const reportUrl = `${vercelDomain}?bot=report`;

  try {
    console.log('Mengatur Webhook untuk Main Bot...');
    const mainBot = new TelegramBot(config.MAIN_BOT_TOKEN);
    await mainBot.setWebHook(mainUrl);
    console.log(`Sukses mengatur Main Bot webhook ke: ${mainUrl}`);

    console.log('Mengatur Webhook untuk Report Bot...');
    const reportBot = new TelegramBot(config.REPORT_BOT_TOKEN);
    await reportBot.setWebHook(reportUrl);
    console.log(`Sukses mengatur Report Bot webhook ke: ${reportUrl}`);

    console.log('\nSelesai! Kedua webhook berhasil didaftarkan ke Telegram API.');

    // Kirim notifikasi ke super admin
    for (const adminId of config.SUPER_ADMIN_IDS) {
      mainBot.sendMessage(adminId, `🚀 Webhook Vercel berhasil dipasang!\nBot kini aktif di Cloud: ${vercelDomain}`).catch(() => {});
    }
  } catch (err) {
    console.error('Terjadi kesalahan:', err.message);
  }
}

setupWebhooks();
