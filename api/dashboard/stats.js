const config = require('../../config');
const database = require('../../database');
const os = require('os');
const fs = require('fs');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Authentication check (via Header token or Query)
  const token = req.headers['authorization'] || req.query.token;
  if (token !== config.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const userStats = await database.getUserStats();
    const totalWaiting = await database.countWaitingQueue();
    const totalActiveChats = await database.countActiveChats();
    const totalPendingReports = await database.countReportsByStatus('SUBMITTED');
    const totalClaimedReports = await database.countReportsByStatus('CLAIMED');

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
    const d = Math.floor(uptime / (3600*24));
    const h = Math.floor(uptime % (3600*24) / 3600);
    const m = Math.floor(uptime % 3600 / 60);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: userStats.total,
        totalActive: userStats.active,
        totalBanned: userStats.banned,
        totalWaiting,
        totalActiveChats,
        totalPendingReports,
        totalClaimedReports
      },
      system: {
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        cpu: `${os.cpus().length} Cores`,
        ram: `${usedMem}GB / ${totalMem}GB`,
        storage: storageText,
        uptime: `${d}h ${h}m ${m}s`,
        environment: process.env.VERCEL ? 'Vercel Serverless' : 'Local / VPS',
        node: process.version
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
