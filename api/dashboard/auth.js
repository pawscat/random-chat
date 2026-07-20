const config = require('../../config');
const database = require('../../database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    await config.loadDynamicConfig(database);
    const { password } = req.body || {};
    if (password === config.DASHBOARD_PASSWORD) {
      return res.status(200).json({ success: true, token: 'authenticated' });
    } else {
      return res.status(401).json({ success: false, error: 'Password salah' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
