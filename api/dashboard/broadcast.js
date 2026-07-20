const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Authentication check
  const token = req.headers['authorization'] || req.query.token;
  if (token !== config.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await config.loadDynamicConfig(database);

    if (req.method === 'POST') {
      const { message } = req.body || {};
      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
      }

      // Gunakan ID admin semu untuk aksi dari web dashboard jika tidak login dengan Telegram admin ID
      const adminId = (config.ADMIN_IDS && config.ADMIN_IDS.length > 0) ? config.ADMIN_IDS[0] : 0;

      // Create broadcast job
      const targets = await database.listBroadcastTargets(1, 1);
      const totalTarget = targets.total;
      
      if (totalTarget === 0) {
        return res.status(400).json({ error: 'Tidak ada pengguna aktif untuk menerima siaran.' });
      }

      const jobId = await database.createBroadcastJob(adminId, message, totalTarget);

      // Trigger the broadcast cron via webhook / processAsyncBroadcast
      // Bot has processAsyncBroadcast running if deployed locally or triggered by Vercel Cron.
      // We can also trigger the Vercel API `/api/cron/broadcast` directly so it starts right away
      try {
        const domain = req.headers.host;
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        await fetch(`${protocol}://${domain}/api/cron/broadcast`, { method: 'GET' }).catch(() => {});
      } catch (e) {}

      return res.status(200).json({ success: true, message: `Siaran dijadwalkan ke ${totalTarget} pengguna.` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Broadcast API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
