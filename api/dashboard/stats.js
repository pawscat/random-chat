const config = require('../../config');
const database = require('../../database');
const os = require('os');
const fs = require('fs');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
    const userStats = await database.getUserStats(config.ACTIVE_USER_WINDOW_MS);
    const reportStats = await database.countReportsByStatus();

    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);

    let storageText = 'Unknown';
    try {
      const stats = fs.statfsSync(process.env.VERCEL ? '/tmp' : process.cwd());
      const totalDisk = (stats.bsize * stats.blocks / 1024 / 1024 / 1024).toFixed(2);
      const freeDisk = (stats.bsize * stats.bavail / 1024 / 1024 / 1024).toFixed(2);
      const usedDisk = (totalDisk - freeDisk).toFixed(2);
      storageText = `${usedDisk}GB / ${totalDisk}GB`;
    } catch (e) {}

    const uptime = os.uptime();
    const d = Math.floor(uptime / (3600 * 24));
    const h = Math.floor(uptime % (3600 * 24) / 3600);
    const m = Math.floor(uptime % 3600 / 60);
    const s = Math.floor(uptime % 60);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: userStats.totalUsers,
        totalOnline: userStats.totalOnline,
        totalIdle: userStats.totalIdle,
        totalWaiting: userStats.totalWaitingQueue,
        totalChatting: userStats.totalChatting,
        totalActiveChats: userStats.totalActiveChats,
        totalBanned: userStats.totalBanned,
        totalPendingReports: (reportStats.submitted || 0) + (reportStats.pending_evidence || 0),
        totalClaimedReports: reportStats.under_review || 0,
        totalResolvedReports: reportStats.resolved || 0,
        totalRejectedReports: reportStats.rejected || 0,
        reportStats
      },
      system: {
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        cpu: `${os.cpus().length} Cores - ${os.cpus()[0]?.model || 'Unknown'}`,
        ram: `${usedMem}GB / ${totalMem}GB`,
        storage: storageText,
        uptime: `${d} Hari ${h} Jam ${m} Menit ${s} Detik`,
        environment: process.env.VERCEL ? 'Vercel Serverless' : 'Local / VPS',
        node: process.version
      },
      settings: {
        mainBot: `@${config.MAIN_BOT_USERNAME}`,
        reportBot: `@${config.REPORT_BOT_USERNAME}`,
        webhookUrl: config.WEBHOOK_URL,
        adminIds: config.ADMIN_IDS,
        superAdminIds: config.SUPER_ADMIN_IDS,
        botName: config.BOT_NAME,
        rateLimitWindow: `${config.USER_MESSAGE_RATE_LIMIT.windowMs}ms`,
        rateLimitMax: `${config.USER_MESSAGE_RATE_LIMIT.maxMessages} pesan`,
        maxReportDescLength: `${config.MAX_REPORT_DESCRIPTION_LENGTH} karakter`,
        reportLimitPerDay: config.REPORT_LIMIT_PER_DAY,
        broadcastDelay: `${config.BROADCAST_DELAY_MS}ms`
      }
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
