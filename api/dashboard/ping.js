const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await config.loadDynamicConfig(database);

    const token = req.headers['authorization'] || req.query.token;
    if (token !== config.DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const dbLatency = await database.pingDb();

    return res.status(200).json({
      success: true,
      dbLatency
    });
  } catch (err) {
    console.error('Ping API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
