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

      // Trigger broadcast engine via webhook by sending a fake update
      const webhookUrl = config.WEBHOOK_URL;
      if (webhookUrl && webhookUrl !== 'ISI_URL_VERCEL_DISINI') {
        const fakeUpdate = {
          update_id: Date.now(),
          message: {
            message_id: Date.now(),
            from: { id: config.SUPER_ADMIN_IDS[0] },
            chat: { id: config.SUPER_ADMIN_IDS[0], type: 'private' },
            text: `/continue_broadcast ${jobId} 1`
          }
        };
        try {
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fakeUpdate)
          }).catch(() => {});
        } catch (e) {
          console.error('Failed to trigger webhook broadcast:', e);
        }
      }

      return res.status(200).json({ success: true, message: `Siaran dijadwalkan ke ${totalTarget} pengguna.` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Broadcast API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
