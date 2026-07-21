const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// Cache config and bot
let cachedConfig = null;
let bot = null;

module.exports = async (req, res) => {
  // Hanya melayani GET
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  try {
    if (!cachedConfig) {
      cachedConfig = require('../../config');
      const database = require('../../database');
      await cachedConfig.loadDynamicConfig(database);
      bot = new TelegramBot(cachedConfig.MAIN_BOT_TOKEN);
    }
    
    const token = req.query.token;
    if (token !== cachedConfig.DASHBOARD_PASSWORD) {
      return res.status(401).send('Unauthorized');
    }
    
    const fileId = req.query.file_id;
    if (!fileId) {
      return res.status(400).send('Bad Request');
    }

    // Ambil info file dari Telegram
    const file = await bot.getFile(fileId);
    if (!file || !file.file_path) {
      return res.status(404).send('File not found');
    }

    const url = `https://api.telegram.org/file/bot${cachedConfig.MAIN_BOT_TOKEN}/${file.file_path}`;
    
    // Proxy (pipe) request ke Telegram
    https.get(url, (proxyRes) => {
      // Set header yang relevan dari response Telegram
      if (proxyRes.headers['content-type']) res.setHeader('Content-Type', proxyRes.headers['content-type']);
      if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache di browser 1 hari
      
      proxyRes.pipe(res);
    }).on('error', (err) => {
      console.error('Error saat proxy file:', err);
      res.status(500).send('Proxy Error');
    });

  } catch (error) {
    console.error('File API Error:', error);
    res.status(500).send('Internal Server Error');
  }
};
