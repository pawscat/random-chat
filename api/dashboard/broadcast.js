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
  

  try {
    await config.loadDynamicConfig(database);

    const token = req.headers['authorization'] || req.query.token;
    if (token !== config.DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'POST') {
      const { message, media } = req.body || {};
      if (!message && !media) {
        return res.status(400).json({ error: 'Pesan atau media tidak boleh kosong' });
      }

      const adminId = (config.ADMIN_IDS && config.ADMIN_IDS.length > 0) ? config.ADMIN_IDS[0] : 0;
      if (media && (!adminId || adminId === 0)) {
        return res.status(400).json({ error: 'Admin ID belum diatur di pengaturan. Siaran media memerlukan Admin ID.' });
      }
      
      let finalMessage = message;
      
      if (media && adminId) {
        try {
          const buffer = Buffer.from(media.data, 'base64');
          const formData = new FormData();
          const isPhoto = media.type.startsWith('image/');
          const method = isPhoto ? 'sendPhoto' : 'sendDocument';
          
          formData.append('chat_id', adminId);
          if (message) formData.append('caption', message);
          
          const blob = new Blob([buffer], { type: media.type });
          formData.append(isPhoto ? 'photo' : 'document', blob, media.name);

          const tgRes = await fetch(`https://api.telegram.org/bot${config.MAIN_BOT_TOKEN}/${method}`, {
            method: 'POST',
            body: formData
          });
          const tgData = await tgRes.json();
          
          if (tgData.ok && tgData.result.message_id) {
            finalMessage = JSON.stringify({
              type: 'copy',
              message_id: tgData.result.message_id,
              caption: message
            });
          } else {
            console.error('Telegram API error:', tgData);
            return res.status(500).json({ error: 'Gagal mengunggah media ke Telegram' });
          }
        } catch (e) {
          console.error('Upload media error:', e);
          return res.status(500).json({ error: 'Gagal memproses media' });
        }
      }

      // Create broadcast job
      const targets = await database.listBroadcastTargets(1, 1);
      const totalTarget = targets.total;
      
      if (totalTarget === 0) {
        return res.status(400).json({ error: 'Tidak ada pengguna aktif untuk menerima siaran.' });
      }

      const jobId = await database.createBroadcastJob(adminId, finalMessage || 'Media Broadcast', totalTarget);

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

    if (req.method === 'GET') {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const history = await database.listBroadcastJobs(page, limit);
      return res.status(200).json({ success: true, history });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Broadcast API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
