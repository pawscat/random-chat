const crypto = require('crypto');
'use strict';

require('dotenv').config();
const { createClient } = require('@libsql/client');
const config = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;

let dbUrl = config.TURSO_DATABASE_URL && config.TURSO_DATABASE_URL !== 'ISI_TURSO_URL_DISINI' ? config.TURSO_DATABASE_URL : 'file:bot_data.sqlite';
if (dbUrl.startsWith('libsql://')) {
  dbUrl = dbUrl.replace('libsql://', 'https://');
}

const client = createClient({
  url: dbUrl,
  authToken: config.TURSO_AUTH_TOKEN && config.TURSO_AUTH_TOKEN !== 'ISI_TURSO_TOKEN_DISINI' ? config.TURSO_AUTH_TOKEN : undefined
});

async function initDB() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      joined_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      is_banned INTEGER NOT NULL DEFAULT 0,
      banned_at INTEGER,
      banned_by INTEGER,
      ban_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS active_chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message_text TEXT,
      message_type TEXT NOT NULL,
      file_id TEXT,
      session_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS active_chats (
      user_id INTEGER PRIMARY KEY,
      partner_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS waiting_queue (
      user_id INTEGER PRIMARY KEY,
      queued_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      reporter_id INTEGER NOT NULL,
      reported_user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      violation_type TEXT,
      evidence_photo_file_id TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      submitted_at INTEGER,
      claimed_by_admin_id INTEGER,
      claimed_at INTEGER,
      handled_by_admin_id INTEGER,
      handled_at INTEGER,
      admin_note TEXT
    );
    CREATE TABLE IF NOT EXISTS report_rate_limits (
      user_id INTEGER PRIMARY KEY,
      last_report_at INTEGER,
      report_count_24h INTEGER NOT NULL DEFAULT 0,
      window_start_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      target_user_id INTEGER,
      report_id TEXT,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broadcast_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      total_target INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      fail_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS report_steps (
      user_id INTEGER PRIMARY KEY,
      report_id TEXT NOT NULL,
      step TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits_mem (
      user_id INTEGER PRIMARY KEY,
      window_start_at INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS broadcast_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      total_target INTEGER NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      current_page INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS admin_steps (
      user_id INTEGER PRIMARY KEY,
      step TEXT NOT NULL,
      payload TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);
    CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
    CREATE INDEX IF NOT EXISTS idx_waiting_queue_queued_at ON waiting_queue(queued_at);
    CREATE INDEX IF NOT EXISTS idx_active_chats_partner_id ON active_chats(partner_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
    CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports(reported_user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_claimed_by_admin_id ON reports(claimed_by_admin_id);
    CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
    CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);
  `);

  // Migration: tambah kolom
  const migrations = [
    "ALTER TABLE users ADD COLUMN username TEXT",
    "ALTER TABLE users ADD COLUMN first_name TEXT",
    "ALTER TABLE users ADD COLUMN last_name TEXT",
    "ALTER TABLE users ADD COLUMN language_code TEXT",
    "ALTER TABLE active_chat_logs ADD COLUMN file_id TEXT",
    "ALTER TABLE active_chat_logs ADD COLUMN session_id TEXT",
    "ALTER TABLE active_chats ADD COLUMN session_id TEXT"
  ];
  for (const sql of migrations) {
    try { await client.execute(sql); } catch (e) {
      // Kolom sudah ada, abaikan error
    }
  }
}
initDB().catch(console.error);

const queries = {
  upsertUser: `
    INSERT INTO users (user_id, status, joined_at, last_active, username, first_name, last_name, language_code)
    VALUES (?, 'idle', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      last_active = excluded.last_active,
      username = COALESCE(excluded.username, users.username),
      first_name = COALESCE(excluded.first_name, users.first_name),
      last_name = COALESCE(excluded.last_name, users.last_name),
      language_code = COALESCE(excluded.language_code, users.language_code)
    RETURNING *
  `,
  getUser: 'SELECT * FROM users WHERE user_id = ?',
  updateUserStatus: 'UPDATE users SET status = ? WHERE user_id = ?',
  updateLastActive: 'UPDATE users SET last_active = ? WHERE user_id = ?',

  countUsers: 'SELECT COUNT(*) AS total FROM users',
  listUsers: `
    SELECT user_id, username, first_name, last_name, language_code, status, joined_at, last_active, is_banned, banned_at, banned_by, ban_reason
    FROM users
    ORDER BY joined_at ASC
    LIMIT ? OFFSET ?
  `,
  countActiveUsers: 'SELECT COUNT(*) AS total FROM users WHERE last_active >= ?',
  listActiveUsers: `
    SELECT user_id, username, first_name, last_name, status, joined_at, last_active, is_banned
    FROM users
    WHERE last_active >= ?
    ORDER BY last_active DESC
    LIMIT ? OFFSET ?
  `,
  countWaitingUsers: 'SELECT COUNT(*) AS total FROM waiting_queue',
  listWaitingUsers: `
    SELECT w.user_id, w.queued_at, u.username, u.first_name, u.last_name, u.status, u.last_active, u.is_banned
    FROM waiting_queue w
    JOIN users u ON u.user_id = w.user_id
    ORDER BY w.queued_at ASC
    LIMIT ? OFFSET ?
  `,
  countChattingUsers: "SELECT COUNT(*) AS total FROM users WHERE status = 'chatting'",
  listChattingUsers: `
    SELECT user_id, username, first_name, last_name, status, last_active
    FROM users
    WHERE status = 'chatting'
    ORDER BY last_active DESC
    LIMIT ? OFFSET ?
  `,

  getStatsBase: `
    SELECT
      COUNT(*) AS total_users,
      SUM(CASE WHEN last_active >= ? THEN 1 ELSE 0 END) AS total_online,
      SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) AS total_idle,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS total_waiting,
      SUM(CASE WHEN status = 'chatting' THEN 1 ELSE 0 END) AS total_chatting,
      SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) AS total_banned
    FROM users
  `,
  countActiveChatsRaw: 'SELECT COUNT(*) AS total FROM active_chats',
  countWaitingQueue: 'SELECT COUNT(*) AS total FROM waiting_queue',
  countActiveReportSessions: `
    SELECT COUNT(*) AS total
    FROM reports
    WHERE status IN ('pending_evidence', 'submitted', 'under_review')
  `,

  banUser: `
    UPDATE users
    SET
      status = 'banned',
      is_banned = 1,
      banned_at = ?,
      banned_by = ?,
      ban_reason = ?,
      last_active = ?
    WHERE user_id = ?
  `,
  unbanUser: `
    UPDATE users
    SET
      status = 'idle',
      is_banned = 0,
      banned_at = NULL,
      banned_by = NULL,
      ban_reason = NULL,
      last_active = ?
    WHERE user_id = ?
  `,
  isUserBanned: 'SELECT is_banned FROM users WHERE user_id = ?',
  countBannedUsers: 'SELECT COUNT(*) AS total FROM users WHERE is_banned = 1',
  listBannedUsers: `
    SELECT user_id, banned_at, banned_by, ban_reason
    FROM users
    WHERE is_banned = 1
    ORDER BY banned_at DESC
    LIMIT ? OFFSET ?
  `,

  userWaitingFlag: 'SELECT 1 AS yes FROM waiting_queue WHERE user_id = ? LIMIT 1',
  userPartner: 'SELECT partner_id FROM active_chats WHERE user_id = ? LIMIT 1',
  countReportsByUser: 'SELECT COUNT(*) AS total FROM reports WHERE reporter_id = ?',
  countReportsAgainstUser: 'SELECT COUNT(*) AS total FROM reports WHERE reported_user_id = ?',

  addToWaitingQueue: 'INSERT OR IGNORE INTO waiting_queue (user_id, queued_at) VALUES (?, ?)',
  removeFromWaitingQueue: 'DELETE FROM waiting_queue WHERE user_id = ?',
  getNextWaitingUser: `
    SELECT w.user_id
    FROM waiting_queue w
    JOIN users u ON u.user_id = w.user_id
    LEFT JOIN active_chats c ON c.user_id = w.user_id
    WHERE
      w.user_id != ?
      AND u.is_banned = 0
      AND u.status = 'waiting'
      AND c.user_id IS NULL
    ORDER BY w.queued_at ASC
    LIMIT 1
  `,

  upsertChatPair: `
    INSERT INTO active_chats (user_id, partner_id, started_at, session_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      partner_id = excluded.partner_id,
      started_at = excluded.started_at,
      session_id = excluded.session_id
  `,
  getPartner: 'SELECT partner_id, session_id FROM active_chats WHERE user_id = ?',
  removeActiveChatByUser: 'DELETE FROM active_chats WHERE user_id = ?',
  countChatPairs: 'SELECT CAST(COUNT(*) / 2 AS INTEGER) AS total FROM active_chats',
  countChatPairsRows: 'SELECT COUNT(*) AS total FROM active_chats WHERE user_id < partner_id',
  listChatPairs: `
    SELECT user_id, partner_id, started_at
    FROM active_chats
    WHERE user_id < partner_id
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `,

  createReport: `
    INSERT INTO reports (
      report_id, reporter_id, reported_user_id, status, created_at
    ) VALUES (?, ?, ?, 'pending_evidence', ?)
  `,
  getReport: 'SELECT * FROM reports WHERE report_id = ?',
  updateReportEvidence: 'UPDATE reports SET evidence_photo_file_id = ? WHERE report_id = ?',
  updateReportDescription: 'UPDATE reports SET description = ? WHERE report_id = ?',
  updateReportViolationType: 'UPDATE reports SET violation_type = ? WHERE report_id = ?',
  submitReport: `
    UPDATE reports
    SET status = 'submitted', submitted_at = ?
    WHERE report_id = ?
  `,

  countReportsByStatus: 'SELECT COUNT(*) AS total FROM reports WHERE status = ?',
  listReportsByStatus: `
    SELECT * FROM reports WHERE status = ? ORDER BY created_at ASC LIMIT ? OFFSET ?
  `,
  countReportsByReporter: 'SELECT COUNT(*) AS total FROM reports WHERE reporter_id = ?',
  listReportsByReporter: `
    SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `,
  countReportsByClaimedAdmin: `
    SELECT COUNT(*) AS total FROM reports WHERE claimed_by_admin_id = ? AND status = 'under_review'
  `,
  listReportsByClaimedAdmin: `
    SELECT * FROM reports WHERE claimed_by_admin_id = ? AND status = 'under_review' ORDER BY claimed_at DESC LIMIT ? OFFSET ?
  `,
  countReportsByStatuses: `
    SELECT COUNT(*) AS total FROM reports WHERE status IN (?, ?)
  `,
  listReportsByStatuses: `
    SELECT * FROM reports WHERE status IN (?, ?) ORDER BY created_at ASC LIMIT ? OFFSET ?
  `,
  getNextSubmittedReport: `
    SELECT * FROM reports WHERE status = 'submitted' ORDER BY COALESCE(submitted_at, created_at) ASC LIMIT 1
  `,
  updateReportClaim: `
    UPDATE reports SET status = 'under_review', claimed_by_admin_id = ?, claimed_at = ? WHERE report_id = ?
  `,
  releaseReportClaim: `
    UPDATE reports SET status = 'submitted', claimed_by_admin_id = NULL, claimed_at = NULL WHERE report_id = ?
  `,
  resolveReport: `
    UPDATE reports SET status = 'resolved', handled_by_admin_id = ?, handled_at = ?, admin_note = ? WHERE report_id = ?
  `,
  rejectReport: `
    UPDATE reports SET status = 'rejected', handled_by_admin_id = ?, handled_at = ?, admin_note = ? WHERE report_id = ?
  `,
  markReportBanned: `
    UPDATE reports SET status = 'banned', handled_by_admin_id = ?, handled_at = ?, admin_note = ? WHERE report_id = ?
  `,
  deleteReport: 'DELETE FROM reports WHERE report_id = ?',
  deleteUser: 'DELETE FROM users WHERE user_id = ?',
  deleteUserChat: 'DELETE FROM active_chats WHERE user_id = ? OR partner_id = ?',
  deleteUserWaiting: 'DELETE FROM waiting_queue WHERE user_id = ?',
  deleteUserMsgLimit: 'DELETE FROM message_rate_limits WHERE user_id = ?',
  deleteUserRepLimit: 'DELETE FROM report_rate_limits WHERE user_id = ?',
  deleteUserRepStep: 'DELETE FROM report_draft_steps WHERE user_id = ?',
  groupedReportStatus: 'SELECT status, COUNT(*) AS total FROM reports GROUP BY status',
  countOpenReportsByUser: `
    SELECT COUNT(*) AS total FROM reports WHERE reporter_id = ? AND status IN ('pending_evidence', 'submitted', 'under_review')
  `,

  getRateLimit: 'SELECT * FROM report_rate_limits WHERE user_id = ?',
  createRateLimit: `
    INSERT INTO report_rate_limits (user_id, last_report_at, report_count_24h, window_start_at)
    VALUES (?, NULL, 0, ?)
    ON CONFLICT(user_id) DO NOTHING
  `,
  resetRateLimitWindow: `
    UPDATE report_rate_limits SET report_count_24h = 0, window_start_at = ? WHERE user_id = ?
  `,
  recordReportCreated: `
    UPDATE report_rate_limits SET last_report_at = ?, report_count_24h = report_count_24h + 1 WHERE user_id = ?
  `,

  logAdminAction: `
    INSERT INTO admin_actions (admin_id, action_type, target_user_id, report_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  logBroadcast: `
    INSERT INTO broadcast_logs (admin_id, message, total_target, success_count, fail_count, skipped_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  countNonBannedUsers: 'SELECT COUNT(*) AS total FROM users WHERE is_banned = 0',
  listNonBannedUsers: `
    SELECT user_id FROM users WHERE is_banned = 0 ORDER BY user_id ASC LIMIT ? OFFSET ?
  `,

  // Shared store replacements
  
  getAdminStep: 'SELECT * FROM admin_steps WHERE user_id = ?',
  setAdminStep: 'INSERT INTO admin_steps (user_id, step, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET step=excluded.step, payload=excluded.payload, updated_at=excluded.updated_at',
  deleteAdminStep: 'DELETE FROM admin_steps WHERE user_id = ?',

  getReportStep: 'SELECT * FROM report_steps WHERE user_id = ?',
  setReportStep: `
    INSERT INTO report_steps (user_id, report_id, step, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET report_id=excluded.report_id, step=excluded.step, updated_at=excluded.updated_at
  `,
  deleteReportStep: 'DELETE FROM report_steps WHERE user_id = ?',
  
  getMessageRateLimit: 'SELECT * FROM rate_limits_mem WHERE user_id = ?',
  setMessageRateLimit: `
    INSERT INTO rate_limits_mem (user_id, window_start_at, count)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET window_start_at=excluded.window_start_at, count=excluded.count
  `,
  
  getRuntimeState: 'SELECT value FROM runtime_state WHERE key = ?',
  setRuntimeState: `
    INSERT INTO runtime_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `,

  createBroadcastJob: `
    INSERT INTO broadcast_jobs (admin_id, message, total_target, created_at)
    VALUES (?, ?, ?, ?)
  `,
  getBroadcastJob: 'SELECT * FROM broadcast_jobs WHERE id = ?',
  updateBroadcastJobProgress: `
    UPDATE broadcast_jobs
    SET success_count = success_count + ?, fail_count = fail_count + ?, skipped_count = skipped_count + ?, current_page = ?
    WHERE id = ?
  `,
  finishBroadcastJob: `
    UPDATE broadcast_jobs SET status = 'completed' WHERE id = ?
  `,
  listBroadcastJobs: `
    SELECT * FROM broadcast_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?
  `,
  countBroadcastJobs: `
    SELECT COUNT(*) as total FROM broadcast_jobs
  `
};

function normalizePagination(page, limit) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;
  return { safePage, safeLimit, offset };
}

function withPagination(rows, total, page, limit) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, items: rows };
}

async function upsertUser(userId, profile) {
  const uid = Number(userId);
  const now = Date.now();
  const username = profile?.username || null;
  const firstName = profile?.first_name || null;
  const lastName = profile?.last_name || null;
  const languageCode = profile?.language_code || null;
  const res = await client.execute({ sql: queries.upsertUser, args: [uid, now, now, username, firstName, lastName, languageCode] });
  return res.rows[0] || null;
}

async function getUser(userId) {
  const res = await client.execute({ sql: queries.getUser, args: [Number(userId)] });
  return res.rows[0] || null;
}

async function updateUserStatus(userId, status) {
  await client.execute({ sql: queries.updateUserStatus, args: [String(status), Number(userId)] });
}

async function updateLastActive(userId) {
  await upsertUser(userId);
}

async function listUsers(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countUsers);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listUsers, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listActiveUsers(activeWindowMs, page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const cutoff = Date.now() - Math.max(0, Number(activeWindowMs) || 0);
  const totalRes = await client.execute({ sql: queries.countActiveUsers, args: [cutoff] });
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listActiveUsers, args: [cutoff, safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listWaitingUsers(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countWaitingUsers);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listWaitingUsers, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listChattingUsers(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countChattingUsers);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listChattingUsers, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function getUserStats(activeWindowMs) {
  const cutoff = Date.now() - Math.max(0, Number(activeWindowMs) || 0);
  const baseRes = await client.execute({ sql: queries.getStatsBase, args: [cutoff] });
  const base = baseRes.rows[0] || {};
  const activeChatsRawRes = await client.execute(queries.countActiveChatsRaw);
  const activeChatsRaw = activeChatsRawRes.rows[0].total || 0;
  const waitingQueueRes = await client.execute(queries.countWaitingQueue);
  const waitingQueueCount = waitingQueueRes.rows[0].total || 0;
  const activeReportRes = await client.execute(queries.countActiveReportSessions);
  const activeReportSessions = activeReportRes.rows[0].total || 0;

  return {
    totalUsers: base.total_users || 0,
    totalOnline: base.total_online || 0,
    totalIdle: base.total_idle || 0,
    totalWaiting: base.total_waiting || 0,
    totalChatting: base.total_chatting || 0,
    totalBanned: base.total_banned || 0,
    totalActiveChats: Math.floor(activeChatsRaw / 2),
    totalWaitingQueue: waitingQueueCount,
    totalActiveReportSessions: activeReportSessions
  };
}

async function banUser(userId, adminId, reason) {
  const uid = Number(userId);
  await upsertUser(uid);
  const now = Date.now();
  const safeReason = reason ? String(reason) : null;
  await client.execute({ sql: queries.banUser, args: [now, adminId != null ? Number(adminId) : null, safeReason, now, uid] });
  
  // Otomatis keluarkan dari antrean atau chat aktif jika ada
  await client.execute({ sql: queries.removeWaitingUser, args: [uid] });
  
  const tx = await client.transaction('write');
  try {
    const res = await tx.execute({ sql: queries.getPartner, args: [uid] });
    const row = res.rows[0];
    await tx.execute({ sql: queries.removeActiveChatByUser, args: [uid] });
    if (row && row.partner_id != null) {
      const partnerId = Number(row.partner_id);
      await tx.execute({ sql: queries.removeActiveChatByUser, args: [partnerId] });
      await tx.execute({ sql: queries.updateUserStatus, args: ['idle', now, partnerId] });
      await tx.execute({
        sql: 'DELETE FROM active_chat_logs WHERE user_id = ? AND partner_id = ?',
        args: [Math.min(uid, partnerId), Math.max(uid, partnerId)]
      });
    }
    await tx.execute({ sql: queries.updateUserStatus, args: ['idle', now, uid] });
    await tx.commit();
  } catch(e) {
    await tx.rollback();
  }
}

async function unbanUser(userId) {
  const uid = Number(userId);
  await upsertUser(uid);
  await client.execute({ sql: queries.unbanUser, args: [Date.now(), uid] });
}

async function isUserBanned(userId) {
  const res = await client.execute({ sql: queries.isUserBanned, args: [Number(userId)] });
  const row = res.rows[0];
  return Boolean(row && row.is_banned === 1);
}

async function getBannedUsers(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countBannedUsers);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listBannedUsers, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function getUserInfo(userId) {
  const uid = Number(userId);
  const user = await getUser(uid);
  if (!user) return null;

  const waitRes = await client.execute({ sql: queries.userWaitingFlag, args: [uid] });
  const waiting = Boolean(waitRes.rows[0]);
  const partnerRes = await client.execute({ sql: queries.userPartner, args: [uid] });
  const partnerRow = partnerRes.rows[0];
  
  const reportMadeRes = await client.execute({ sql: queries.countReportsByUser, args: [uid] });
  const reportMade = reportMadeRes.rows[0].total || 0;
  
  const reportAgainstRes = await client.execute({ sql: queries.countReportsAgainstUser, args: [uid] });
  const reportAgainst = reportAgainstRes.rows[0].total || 0;

  return {
    ...user,
    is_waiting: waiting,
    partner_id: partnerRow ? partnerRow.partner_id : null,
    total_reports_made: reportMade,
    total_reports_against: reportAgainst
  };
}

async function addToWaitingQueue(userId) {
  const uid = Number(userId);
  await upsertUser(uid);
  await client.execute({ sql: queries.addToWaitingQueue, args: [uid, Date.now()] });
}

async function removeFromWaitingQueue(userId) {
  await client.execute({ sql: queries.removeFromWaitingQueue, args: [Number(userId)] });
}

async function getNextWaitingUser(excludeUserId) {
  const tx = await client.transaction('write');
  try {
    const res = await tx.execute({ sql: queries.getNextWaitingUser, args: [Number(excludeUserId)] });
    const row = res.rows[0];
    if (!row) {
      await tx.commit();
      return null;
    }
    await tx.execute({ sql: queries.removeFromWaitingQueue, args: [row.user_id] });
    await tx.commit();
    return Number(row.user_id);
  } catch(e) {
    await tx.rollback();
    throw e;
  }
}

async function countWaitingQueue() {
  const res = await client.execute(queries.countWaitingQueue);
  return res.rows[0].total || 0;
}

async function clearWaitingUser(userId) {
  await removeFromWaitingQueue(userId);
}

  async function createChatPair(userA, userB) {
  const a = Number(userA);
  const b = Number(userB);
  const now = Date.now();
  const sessionId = Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  const tx = await client.transaction('write');
  try {
    await tx.execute({ sql: queries.upsertUser, args: [a, now, now, null, null, null, null] });
    await tx.execute({ sql: queries.upsertUser, args: [b, now, now, null, null, null, null] });
    await tx.execute({ sql: queries.removeFromWaitingQueue, args: [a] });
    await tx.execute({ sql: queries.removeFromWaitingQueue, args: [b] });
    await tx.execute({ sql: queries.upsertChatPair, args: [a, b, now, sessionId] });
    await tx.execute({ sql: queries.upsertChatPair, args: [b, a, now, sessionId] });
    await tx.execute({ sql: queries.updateUserStatus, args: ['chatting', a] });
    await tx.execute({ sql: queries.updateUserStatus, args: ['chatting', b] });
    await tx.execute({ sql: queries.updateLastActive, args: [now, a] });
    await tx.execute({ sql: queries.updateLastActive, args: [now, b] });
    await tx.commit();
    return true;
  } catch(e) {
    await tx.rollback();
    throw e;
  }
}

async function getPartner(userId) {
  const res = await client.execute({ sql: queries.getPartner, args: [Number(userId)] });
  const row = res.rows[0];
  return row ? Number(row.partner_id) : null;
}

async function removeChatPair(userId) {
  const uid = Number(userId);
  const tx = await client.transaction('write');
  try {
    const res = await tx.execute({ sql: queries.getPartner, args: [uid] });
    const row = res.rows[0];
    await tx.execute({ sql: queries.removeActiveChatByUser, args: [uid] });
    if (row && row.partner_id != null) {
      const partnerId = Number(row.partner_id);
      await tx.execute({ sql: queries.removeActiveChatByUser, args: [partnerId] });
      
      // Delete chat logs
      const uid1 = Math.min(uid, partnerId);
      const uid2 = Math.max(uid, partnerId);
      await tx.execute({
        sql: 'DELETE FROM active_chat_logs WHERE user_id = ? AND partner_id = ?',
        args: [uid1, uid2]
      });
      await tx.commit();
      return Number(row.partner_id);
    }
    await tx.commit();
    return null;
  } catch(e) {
    await tx.rollback();
    throw e;
  }
}

async function countActiveChats() {
  const res = await client.execute(queries.countChatPairs);
  return res.rows[0].total || 0;
}

async function listChatPairs(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countChatPairsRows);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listChatPairs, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function createReport(reportId, reporterId, reportedUserId) {
  const rid = String(reportId);
  const reporter = Number(reporterId);
  const reported = Number(reportedUserId);
  await upsertUser(reporter);
  await upsertUser(reported);
  await client.execute({ sql: queries.createReport, args: [rid, reporter, reported, Date.now()] });
  return await getReport(rid);
}

async function getReport(reportId) {
  const res = await client.execute({ sql: queries.getReport, args: [String(reportId)] });
  return res.rows[0] || null;
}

async function updateReportEvidence(reportId, fileId) {
  await client.execute({ sql: queries.updateReportEvidence, args: [String(fileId), String(reportId)] });
}

async function updateReportDescription(reportId, description) {
  await client.execute({ sql: queries.updateReportDescription, args: [String(description), String(reportId)] });
}

async function updateReportViolationType(reportId, violationType) {
  await client.execute({ sql: queries.updateReportViolationType, args: [String(violationType), String(reportId)] });
}

async function submitReport(reportId) {
  await client.execute({ sql: queries.submitReport, args: [Date.now(), String(reportId)] });
}

async function listReportsByStatus(status, page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute({ sql: queries.countReportsByStatus, args: [String(status)] });
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listReportsByStatus, args: [String(status), safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listReportsByReporter(reporterId, page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute({ sql: queries.countReportsByReporter, args: [Number(reporterId)] });
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listReportsByReporter, args: [Number(reporterId), safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listClaimedReportsByAdmin(adminId, page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute({ sql: queries.countReportsByClaimedAdmin, args: [Number(adminId)] });
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listReportsByClaimedAdmin, args: [Number(adminId), safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function listReportsByStatuses(statusA, statusB, page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute({ sql: queries.countReportsByStatuses, args: [String(statusA), String(statusB)] });
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listReportsByStatuses, args: [String(statusA), String(statusB), safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

async function getNextSubmittedReport() {
  const res = await client.execute(queries.getNextSubmittedReport);
  return res.rows[0] || null;
}

function isTerminalReportStatus(status) {
  return status === 'resolved' || status === 'rejected' || status === 'banned';
}

async function claimReport(reportId, adminId) {
  const rid = String(reportId);
  const aid = Number(adminId);
  const tx = await client.transaction('write');
  try {
    const repRes = await tx.execute({ sql: queries.getReport, args: [rid] });
    const report = repRes.rows[0];
    if (!report) { await tx.rollback(); return { ok: false, reason: 'not_found' }; }
    if (isTerminalReportStatus(report.status)) { await tx.rollback(); return { ok: false, reason: 'already_closed' }; }
    if (report.status === 'pending_evidence') { await tx.rollback(); return { ok: false, reason: 'pending_evidence' }; }
    if (report.status === 'under_review' && report.claimed_by_admin_id && report.claimed_by_admin_id !== aid) {
      await tx.rollback(); return { ok: false, reason: 'locked_by_other' };
    }
    if (report.status !== 'submitted' && report.status !== 'under_review') {
      await tx.rollback(); return { ok: false, reason: 'invalid_status' };
    }
    await tx.execute({ sql: queries.updateReportClaim, args: [aid, Date.now(), rid] });
    const finRes = await tx.execute({ sql: queries.getReport, args: [rid] });
    await tx.commit();
    return { ok: true, report: finRes.rows[0] };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function releaseReport(reportId, adminId, isSuperAdmin) {
  const rid = String(reportId);
  const aid = Number(adminId);
  const tx = await client.transaction('write');
  try {
    const repRes = await tx.execute({ sql: queries.getReport, args: [rid] });
    const report = repRes.rows[0];
    if (!report) { await tx.rollback(); return { ok: false, reason: 'not_found' }; }
    if (isTerminalReportStatus(report.status)) { await tx.rollback(); return { ok: false, reason: 'already_closed' }; }
    if (!isSuperAdmin && report.claimed_by_admin_id && report.claimed_by_admin_id !== aid) {
      await tx.rollback(); return { ok: false, reason: 'locked_by_other' };
    }
    await tx.execute({ sql: queries.releaseReportClaim, args: [rid] });
    const finRes = await tx.execute({ sql: queries.getReport, args: [rid] });
    await tx.commit();
    return { ok: true, report: finRes.rows[0] };
  } catch(e) {
    await tx.rollback();
    throw e;
  }
}

async function resolveReport(reportId, adminId, note) {
  const rid = String(reportId);
  const report = await getReport(rid);
  if (!report) return { ok: false, reason: 'not_found' };
  if (isTerminalReportStatus(report.status)) return { ok: false, reason: 'already_closed' };
  await client.execute({ sql: queries.resolveReport, args: [Number(adminId), Date.now(), String(note), rid] });
  return { ok: true, report: await getReport(rid) };
}

async function rejectReport(reportId, adminId, reason) {
  const rid = String(reportId);
  const report = await getReport(rid);
  if (!report) return { ok: false, reason: 'not_found' };
  if (isTerminalReportStatus(report.status)) return { ok: false, reason: 'already_closed' };
  await client.execute({ sql: queries.rejectReport, args: [Number(adminId), Date.now(), String(reason), rid] });
  return { ok: true, report: await getReport(rid) };
}

async function markReportBanned(reportId, adminId, reason) {
  const rid = String(reportId);
  const report = await getReport(rid);
  if (!report) return { ok: false, reason: 'not_found' };
  if (isTerminalReportStatus(report.status)) return { ok: false, reason: 'already_closed' };
  await client.execute({ sql: queries.markReportBanned, args: [Number(adminId), Date.now(), String(reason), rid] });
  return { ok: true, report: await getReport(rid) };
}

async function deleteReport(reportId) {
  const rid = String(reportId);
  const tx = await client.transaction('write');
  try {
    await tx.execute({ sql: queries.deleteReport, args: [rid] });
    await tx.commit();
    return { ok: true };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function deleteUser(userId) {
  const uid = Number(userId);
  const tx = await client.transaction('write');
  try {
    await tx.execute({ sql: queries.deleteUser, args: [uid] });
    await tx.execute({ sql: queries.deleteUserChat, args: [uid, uid] });
    await tx.execute({ sql: queries.deleteUserWaiting, args: [uid] });
    await tx.execute({ sql: queries.deleteUserMsgLimit, args: [uid] });
    await tx.execute({ sql: queries.deleteUserRepLimit, args: [uid] });
    await tx.execute({ sql: queries.deleteUserRepStep, args: [uid] });
    await tx.commit();
    return { ok: true };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function countReportsByStatusMap() {
  const res = await client.execute(queries.groupedReportStatus);
  const output = { pending_evidence: 0, submitted: 0, under_review: 0, resolved: 0, rejected: 0, banned: 0 };
  for (const row of res.rows) {
    if (output[row.status] !== undefined) {
      output[row.status] = row.total;
    }
  }
  return output;
}

async function countReportsByUser(userId) {
  const res = await client.execute({ sql: queries.countReportsByUser, args: [Number(userId)] });
  return res.rows[0].total || 0;
}

async function countReportsAgainstUser(userId) {
  const res = await client.execute({ sql: queries.countReportsAgainstUser, args: [Number(userId)] });
  return res.rows[0].total || 0;
}

async function resetReportWindowIfNeeded(userId) {
  const uid = Number(userId);
  const now = Date.now();
  await client.execute({ sql: queries.createRateLimit, args: [uid, now] });
  let res = await client.execute({ sql: queries.getRateLimit, args: [uid] });
  let row = res.rows[0];
  if (!row) {
    row = { user_id: uid, last_report_at: null, report_count_24h: 0, window_start_at: now };
  }
  if (now - row.window_start_at >= DAY_MS) {
    await client.execute({ sql: queries.resetRateLimitWindow, args: [now, uid] });
    res = await client.execute({ sql: queries.getRateLimit, args: [uid] });
    row = res.rows[0];
  }
  return row;
}

async function canCreateReport(userId) {
  const uid = Number(userId);
  const now = Date.now();
  const limiter = await resetReportWindowIfNeeded(uid);
  if (limiter.report_count_24h >= config.REPORT_LIMIT_PER_DAY) return { ok: false, reason: 'daily_limit' };
  if (limiter.last_report_at && now - limiter.last_report_at < config.REPORT_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  const res = await client.execute({ sql: queries.countOpenReportsByUser, args: [uid] });
  const activeOpen = res.rows[0].total || 0;
  if (activeOpen > 0) return { ok: false, reason: 'active_report' };
  return { ok: true };
}

async function recordReportCreated(userId) {
  const uid = Number(userId);
  await resetReportWindowIfNeeded(uid);
  await client.execute({ sql: queries.recordReportCreated, args: [Date.now(), uid] });
}

async function logAdminAction(adminId, actionType, targetUserId, reportId, reason) {
  await client.execute({
    sql: queries.logAdminAction,
    args: [
      Number(adminId), String(actionType), targetUserId != null ? Number(targetUserId) : null,
      reportId != null ? String(reportId) : null, reason != null ? String(reason) : null, Date.now()
    ]
  });
}

async function logBroadcast(adminId, message, totalTarget, success, fail, skipped) {
  await client.execute({
    sql: queries.logBroadcast,
    args: [Number(adminId), String(message), Number(totalTarget), Number(success), Number(fail), Number(skipped), Date.now()]
  });
}

async function listBroadcastTargets(page, limit) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const totalRes = await client.execute(queries.countNonBannedUsers);
  const total = totalRes.rows[0].total;
  const rowsRes = await client.execute({ sql: queries.listNonBannedUsers, args: [safeLimit, offset] });
  return withPagination(rowsRes.rows, total, safePage, safeLimit);
}

// SharedStore memory equivalents
function generateReportId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `R${Date.now().toString(36).toUpperCase()}${rand}`;
}


async function getAdminStep(userId) {
  const res = await client.execute({ sql: queries.getAdminStep, args: [Number(userId)] });
  return res.rows.length > 0 ? res.rows[0] : null;
}

async function setAdminStep(userId, step, payload = null) {
  await client.execute({ sql: queries.setAdminStep, args: [Number(userId), String(step), payload ? String(payload) : null, Date.now()] });
}

async function deleteAdminStep(userId) {
  await client.execute({ sql: queries.deleteAdminStep, args: [Number(userId)] });
}

async function getReportStep(userId) {
  const res = await client.execute({ sql: queries.getReportStep, args: [Number(userId)] });
  return res.rows[0] ? { reportId: res.rows[0].report_id, step: res.rows[0].step } : null;
}

async function setReportStep(userId, reportId, step) {
  await client.execute({ sql: queries.setReportStep, args: [Number(userId), String(reportId), String(step), Date.now()] });
}

async function deleteReportStep(userId) {
  await client.execute({ sql: queries.deleteReportStep, args: [Number(userId)] });
}

async function getMessageRateLimit(userId) {
  const res = await client.execute({ sql: queries.getMessageRateLimit, args: [Number(userId)] });
  return res.rows[0] ? { windowStart: res.rows[0].window_start_at, count: res.rows[0].count } : null;
}

async function setMessageRateLimit(userId, windowStart, count) {
  await client.execute({ sql: queries.setMessageRateLimit, args: [Number(userId), windowStart, count] });
}

async function getRuntimeState(key) {
  const res = await client.execute({ sql: queries.getRuntimeState, args: [String(key)] });
  return res.rows[0] ? res.rows[0].value : null;
}

async function setRuntimeState(key, value) {
  await client.execute({ sql: queries.setRuntimeState, args: [String(key), String(value)] });
}

async function createBroadcastJob(adminId, message, totalTarget) {
  const res = await client.execute({
    sql: queries.createBroadcastJob,
    args: [Number(adminId), String(message), Number(totalTarget), Date.now()]
  });
  return Number(res.lastInsertRowid);
}

async function getBroadcastJob(jobId) {
  const res = await client.execute({ sql: queries.getBroadcastJob, args: [Number(jobId)] });
  return res.rows[0] || null;
}

async function updateBroadcastJobProgress(jobId, success, fail, skipped, page) {
  await client.execute({
    sql: queries.updateBroadcastJobProgress,
    args: [Number(success), Number(fail), Number(skipped), Number(page), Number(jobId)]
  });
}

async function finishBroadcastJob(jobId) {
  await client.execute({ sql: queries.finishBroadcastJob, args: [Number(jobId)] });
}


async function logChatMessage(userId, partnerId, senderId, messageText, messageType, fileId = null) {
  const uid1 = Math.min(userId, partnerId);
  const uid2 = Math.max(userId, partnerId);
  try {
    await client.execute({
      sql: 'INSERT INTO active_chat_logs (user_id, partner_id, sender_id, message_text, message_type, file_id) VALUES (?, ?, ?, ?, ?, ?)',
      args: [uid1, uid2, senderId, messageText, messageType, fileId]
    });
  } catch (err) {
    console.error('Error logging chat message:', err);
  }
}

async function getChatLogs(userId, partnerId) {
  const uid1 = Math.min(userId, partnerId);
  const uid2 = Math.max(userId, partnerId);
  try {
    const res = await client.execute({
      sql: 'SELECT sender_id, message_text, message_type, file_id, created_at FROM active_chat_logs WHERE user_id = ? AND partner_id = ? ORDER BY created_at ASC',
      args: [uid1, uid2]
    });
    return res.rows;
  } catch (err) {
    console.error('Error getting chat logs:', err);
    return [];
  }
}

module.exports = {
  client, upsertUser, getUser, updateUserStatus, updateLastActive, listUsers, listActiveUsers,
  listWaitingUsers, listChattingUsers, getUserStats, banUser, unbanUser, isUserBanned,
  getBannedUsers, getUserInfo, addToWaitingQueue, removeFromWaitingQueue, getNextWaitingUser,
  countWaitingQueue, clearWaitingUser, createChatPair, getPartner, removeChatPair, countActiveChats,
  listChatPairs, createReport, getReport, updateReportEvidence, updateReportDescription,
  updateReportViolationType, submitReport, listReportsByStatus, listReportsByReporter,
  listClaimedReportsByAdmin, listReportsByStatuses, getNextSubmittedReport, claimReport, releaseReport,
  resolveReport, rejectReport, markReportBanned, deleteReport, countReportsByStatus: countReportsByStatusMap,
  countReportsByUser, countReportsAgainstUser, canCreateReport, recordReportCreated,
  resetReportWindowIfNeeded, logAdminAction, logBroadcast, listBroadcastTargets,
  getAdminStep, setAdminStep, deleteAdminStep, getReportStep, setReportStep, deleteReportStep, getMessageRateLimit, setMessageRateLimit,
  getRuntimeState, setRuntimeState, createBroadcastJob, getBroadcastJob, updateBroadcastJobProgress, finishBroadcastJob,
  listBroadcastJobs, generateReportId, deleteUser, logChatMessage, getChatLogs
};
async function listBroadcastJobs(page = 1, limit = 20) {
  const { safePage, safeLimit, offset } = normalizePagination(page, limit);
  const countRes = await client.execute(queries.countBroadcastJobs);
  const total = countRes.rows[0]?.total || 0;
  const res = await client.execute({ sql: queries.listBroadcastJobs, args: [safeLimit, offset] });
  return withPagination(res.rows, total, safePage, safeLimit);
}