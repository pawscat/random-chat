const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    // GET: list users
    if (req.method === 'GET') {
      const type = req.query.type || 'all'; // all, active, waiting, chatting, banned
      let users = [];
      switch (type) {
        case 'active':
          users = await database.listActiveUsers(100);
          break;
        case 'waiting':
          users = await database.listWaitingUsers();
          break;
        case 'chatting':
          users = await database.listChattingUsers();
          break;
        case 'banned':
          users = await database.getBannedUsers();
          break;
        default:
          users = await database.listUsers(100);
      }
      return res.status(200).json({ success: true, users, type });
    }

    // POST: action on user (ban/unban)
    if (req.method === 'POST') {
      const { action, userId, reason } = req.body || {};
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const numericUserId = Number(userId);

      switch (action) {
        case 'ban':
          await database.banUser(numericUserId, reason || 'Banned via Dashboard');
          return res.status(200).json({ success: true, message: `User ${numericUserId} telah di-ban.` });
        case 'unban':
          await database.unbanUser(numericUserId);
          return res.status(200).json({ success: true, message: `User ${numericUserId} telah di-unban.` });
        case 'info':
          const info = await database.getUserInfo(numericUserId);
          return res.status(200).json({ success: true, user: info });
        default:
          return res.status(400).json({ error: 'Invalid action. Use: ban, unban, info' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
