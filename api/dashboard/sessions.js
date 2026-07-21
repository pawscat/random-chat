const config = require('../../config');
const database = require('../../database');
const TelegramBot = require('node-telegram-bot-api');

async function sendTelegramMessage(chatId, text) {
  if (!config.MAIN_BOT_TOKEN || config.MAIN_BOT_TOKEN.includes('ISI_TOKEN')) return;
  try {
    const bot = new TelegramBot(config.MAIN_BOT_TOKEN);
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Failed to send telegram message from dashboard:', err.message);
  }
}


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Authentication check
  

  try {
    await config.loadDynamicConfig(database);

    const token = req.headers['authorization'] || req.query.token;
    if (token !== config.DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
      if (req.query.action === 'view_logs') {
        const uId = Number(req.query.userId);
        const pId = Number(req.query.partnerId);
        if (!uId || !pId) return res.status(400).json({ error: 'Missing parameters' });
        const logs = await database.getChatLogs(uId, pId);
        return res.status(200).json({ success: true, logs });
      }

      const type = req.query.type || 'active'; // active, waiting
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      let result;
      if (type === 'waiting') {
        result = await database.listWaitingUsers(page, limit);
      } else {
        result = await database.listChatPairs(page, limit);
      }
      return res.status(200).json({ success: true, items: result.items, pagination: { page: result.page, totalPages: result.totalPages, total: result.total }, type });
    }

    if (req.method === 'POST') {
      const { action, userId } = req.body || {};
      if (!userId || !action) return res.status(400).json({ error: 'Missing parameters' });
      const numericUserId = Number(userId);

      if (action === 'stop_chat') {
        const partner = await database.getPartner(numericUserId);
        if (partner) {
          await database.removeChatPair(numericUserId, partner);
          await database.updateUserStatus('idle', numericUserId);
          await database.updateUserStatus('idle', partner);
          
          await sendTelegramMessage(numericUserId, '⚠️ Obrolan Anda telah dihentikan secara paksa oleh Admin.\nKetik /search untuk mencari teman baru.');
          await sendTelegramMessage(partner, '⚠️ Obrolan Anda telah dihentikan secara paksa oleh Admin.\nKetik /search untuk mencari teman baru.');
          
          return res.status(200).json({ success: true, message: `Chat antara ${numericUserId} dan ${partner} dihentikan.` });
        }
        return res.status(400).json({ error: 'User sedang tidak dalam chat aktif' });
      }

      if (action === 'kick_queue') {
        await database.removeFromWaitingQueue(numericUserId);
        await database.updateUserStatus('idle', numericUserId);
        
        await sendTelegramMessage(numericUserId, '⚠️ Anda telah dikeluarkan dari antrean oleh Admin.');
        
        return res.status(200).json({ success: true, message: `User ${numericUserId} dikeluarkan dari antrean.` });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Sessions API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
