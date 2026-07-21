const db = require('./database.js');
(async () => {
  await db.client.execute('UPDATE broadcast_jobs SET status = \'completed\' WHERE status = \'running\'');
  console.log('Fixed DB running jobs');
})();