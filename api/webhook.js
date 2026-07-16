const { startMainBot } = require('../bot');
const { startReportBot } = require('../reportBot');

// Inisialisasi bot tanpa mode polling
const mainBot = startMainBot();
const reportBot = startReportBot();

module.exports = async function handler(req, res) {
  // Hanya menerima HTTP POST (Telegram Webhook)
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is active.');
  }

  const { bot } = req.query;
  const update = req.body;

  try {
    if (bot === 'main') {
      await mainBot.processUpdate(update);
    } else if (bot === 'report') {
      await reportBot.processUpdate(update);
    } else if (update && update.message && update.message.text && update.message.text.startsWith('/continue_broadcast')) {
      // Self-trigger untuk sistem broadcast estafet (menghindari timeout Vercel)
      await mainBot.processUpdate(update);
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
