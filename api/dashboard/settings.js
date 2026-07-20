const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['authorization'] || req.query.token;
  if (token !== config.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Muat setting terbaru dari DB
    await config.loadDynamicConfig(database);

    if (req.method === 'GET') {
      // Return the current resolved configuration
      return res.status(200).json({ success: true, settings: config });
    }

    if (req.method === 'POST') {
      const updates = req.body || {};
      const state = await database.getRuntimeState('dynamic_settings');
      let currentDynamic = {};
      if (state) {
        try { currentDynamic = JSON.parse(state); } catch (e) {}
      }

      // Gabungkan update baru ke dynamic config
      for (const key in updates) {
        if (key !== 'loadDynamicConfig' && key !== 'TURSO_DATABASE_URL' && key !== 'TURSO_AUTH_TOKEN' && config.hasOwnProperty(key)) {
           currentDynamic[key] = updates[key];
        }
      }

      await database.setRuntimeState('dynamic_settings', JSON.stringify(currentDynamic));
      return res.status(200).json({ success: true, message: 'Settings saved' });
    }
  } catch (error) {
    console.error('Settings API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
