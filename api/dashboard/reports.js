const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = req.headers['authorization'] || req.query.token;
  if (token !== config.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await config.loadDynamicConfig(database);

    // Proxy foto evidence dari Telegram
    if (req.method === 'GET' && req.query.photo === '1' && req.query.file_id) {
      if (!config.REPORT_BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });
      
      const fileId = req.query.file_id;
      // Get file path dari Telegram
      const getFileRes = await fetch(`https://api.telegram.org/bot${config.REPORT_BOT_TOKEN}/getFile?file_id=${fileId}`);
      const getFileData = await getFileRes.json();
      
      if (!getFileData.ok) {
        return res.status(404).json({ error: 'File not found on Telegram' });
      }

      const filePath = getFileData.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${config.REPORT_BOT_TOKEN}/${filePath}`;
      
      // Ambil file aslinya
      const imgRes = await fetch(fileUrl);
      if (!imgRes.ok) throw new Error('Failed to fetch image');
      
      // Teruskan sebagai stream dengan content type
      const contentType = imgRes.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24 jam
      
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return res.status(200).send(buffer);
    }

    // List reports
    if (req.method === 'GET') {
      const type = req.query.type || 'pending'; // pending, claimed, handled
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      let result;
      if (type === 'pending') {
        result = await database.listReportsByStatus('submitted', page, limit);
      } else if (type === 'claimed') {
        result = await database.listReportsByStatus('under_review', page, limit);
      } else if (type === 'handled') {
        result = await database.listReportsByStatuses('resolved', 'banned', page, limit);
      } else {
        result = await database.listReportsByStatus('submitted', page, limit);
      }

      return res.status(200).json({ success: true, reports: result.items, pagination: { page: result.page, totalPages: result.totalPages, total: result.total }, type });
    }

    // Handle Report Action (Claim, Resolve, Ban)
    if (req.method === 'POST') {
      const { action, reportId, note } = req.body || {};
      if (!action || !reportId) return res.status(400).json({ error: 'Missing parameters' });

      // Gunakan ID admin semu untuk aksi dari web dashboard jika tidak login dengan Telegram admin ID
      // Atau bisa ambil dari ADMIN_IDS pertama sebagai fallback
      const adminId = (config.ADMIN_IDS && config.ADMIN_IDS.length > 0) ? config.ADMIN_IDS[0] : 0;

      if (action === 'claim') {
        const claimRes = await database.claimReport(reportId, adminId);
        if (claimRes.ok) return res.json({ success: true, message: 'Laporan berhasil diklaim', report: claimRes.report });
        return res.status(400).json({ error: 'Gagal mengklaim laporan. Alasan: ' + claimRes.reason });
      }

      if (action === 'resolve') {
        const resolveRes = await database.resolveReport(reportId, adminId, note || 'Diselesaikan via Web Dashboard');
        if (resolveRes.ok) return res.json({ success: true, message: 'Laporan ditandai selesai', report: resolveRes.report });
        return res.status(400).json({ error: 'Gagal menandai laporan. Alasan: ' + resolveRes.reason });
      }

      if (action === 'ban') {
        const rep = await database.getReport(reportId);
        if (!rep) return res.status(404).json({ error: 'Report not found' });
        
        await database.banUser(rep.reported_user_id, adminId, note || 'Diban via Web Dashboard berdasarkan laporan');
        const banRes = await database.markReportBanned(reportId, adminId, note || 'Diban via Web Dashboard');
        if (banRes.ok) return res.json({ success: true, message: 'Terlapor berhasil di-ban', report: banRes.report });
        return res.status(400).json({ error: 'Gagal memproses. Alasan: ' + banRes.reason });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Reports API error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
