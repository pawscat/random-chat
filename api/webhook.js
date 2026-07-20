const { startMainBot } = require('../bot');
const { startReportBot } = require('../reportBot');

// Cache bot instances untuk performa (hanya di-recreate jika token berubah)
let mainBot = null;
let reportBot = null;
let cachedMainToken = null;
let cachedReportToken = null;

module.exports = async function handler(req, res) {
  // Hanya menerima HTTP POST (Telegram Webhook)
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is active.');
  }

  const { bot } = req.query;
  const update = req.body;

  try {
    const config = require('../config');
    const database = require('../database');
    await config.loadDynamicConfig(database);

    // Inisialisasi dinamis dengan token terbaru dari database
    if (!mainBot || cachedMainToken !== config.MAIN_BOT_TOKEN) {
      mainBot = startMainBot();
      cachedMainToken = config.MAIN_BOT_TOKEN;
    }
    if (!reportBot || cachedReportToken !== config.REPORT_BOT_TOKEN) {
      reportBot = startReportBot();
      cachedReportToken = config.REPORT_BOT_TOKEN;
    }

    if (bot === 'main') {
      await mainBot.processUpdate(update);
      if (mainBot.pendingPromises && mainBot.pendingPromises.length) await Promise.allSettled(mainBot.pendingPromises);
    } else if (bot === 'report') {
      await reportBot.processUpdate(update);
      if (reportBot.pendingPromises && reportBot.pendingPromises.length) await Promise.allSettled(reportBot.pendingPromises);
    } else if (update && update.message && update.message.text && update.message.text.startsWith('/continue_broadcast')) {
      // Self-trigger untuk sistem broadcast estafet (menghindari timeout Vercel)
      await mainBot.processUpdate(update);
      if (mainBot.pendingPromises && mainBot.pendingPromises.length) await Promise.allSettled(mainBot.pendingPromises);
    } else {
      // Jika bot query parameter tidak ada, return error
      console.warn('Unknown webhook destination', req.query);
    }
  } catch (error) {
    console.error('Error processing update', error);
  }

  // Wajib membalas 200 OK agar Telegram tidak mencoba mengirim ulang pesan terus-menerus
  return res.status(200).send('OK');
};
