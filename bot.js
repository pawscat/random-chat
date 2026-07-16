'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const database = require('./database');

const {
  upsertUser, getUser, updateUserStatus, updateLastActive, listUsers, listActiveUsers,
  listWaitingUsers, getUserStats, banUser, unbanUser, isUserBanned, getBannedUsers,
  getUserInfo, addToWaitingQueue, getNextWaitingUser, clearWaitingUser, createChatPair,
  getPartner, removeChatPair, listChatPairs, createReport, getReport, countReportsByStatus,
  countReportsByUser, countReportsAgainstUser, canCreateReport, recordReportCreated,
  logAdminAction, logBroadcast, listBroadcastTargets, getMessageRateLimit, setMessageRateLimit,
  getRuntimeState, setRuntimeState, createBroadcastJob, getBroadcastJob, updateBroadcastJobProgress,
  finishBroadcastJob, generateReportId
} = database;

function startMainBot() {
  if (!config.MAIN_BOT_TOKEN || config.MAIN_BOT_TOKEN.includes('ISI_TOKEN')) {
    throw new Error('MAIN_BOT_TOKEN belum diisi di config.js');
  }

  // Hapus polling: true untuk mode Vercel Serverless
  const bot = new TelegramBot(config.MAIN_BOT_TOKEN);
  
  const adminSet = new Set([...config.ADMIN_IDS, ...config.SUPER_ADMIN_IDS].map(Number));
  const superAdminSet = new Set(config.SUPER_ADMIN_IDS.map(Number));

  function isAdmin(userId) { return adminSet.has(Number(userId)); }
  function isSuperAdmin(userId) { return superAdminSet.has(Number(userId)); }

  function normalizeStatus(status) {
    if (status === 'waiting' || status === 'chatting' || status === 'banned') return status;
    return 'idle';
  }

  async function getUserStatus(userId) {
    const user = await getUser(Number(userId));
    if (!user) return 'idle';
    if (user.is_banned === 1) return 'banned';
    return normalizeStatus(user.status);
  }

  async function isBanned(userId) {
    const uid = Number(userId);
    return (await isUserBanned(uid)) || (await getUserStatus(uid)) === 'banned';
  }

  async function setUserState(userId, state) {
    const uid = Number(userId);
    const normalized = normalizeStatus(state);
    await upsertUser(uid);
    if (normalized !== 'banned' && await isUserBanned(uid)) return;
    await updateUserStatus(uid, normalized);
    await updateLastActive(uid);
  }

  async function touchUser(userId) {
    const uid = Number(userId);
    const user = await upsertUser(uid);
    if (user && user.is_banned === 1 && user.status !== 'banned') {
      await updateUserStatus(uid, 'banned');
    }
  }

  // DIAGNOSTIC LOG UNTUK USER:
  bot.on('message', (msg) => {
    console.log(`[MainBot] Menerima pesan dari ${msg.from?.id}: ${msg.text}`);
  });

  function sanitizeInput(text, maxLen) {
    return String(text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function formatTs(ms) {
    if (!ms) return '-';
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString();
  }
  function parsePage(pageRaw) {
    const page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 1) return 1;
    return page;
  }

  async function checkRateLimit(userId) {
    const uid = Number(userId);
    const now = Date.now();
    const windowMs = config.USER_MESSAGE_RATE_LIMIT.windowMs;
    const maxMessages = config.USER_MESSAGE_RATE_LIMIT.maxMessages;
    
    let entry = await getMessageRateLimit(uid);
    if (!entry || now - entry.windowStart > windowMs) {
      await setMessageRateLimit(uid, now, 1);
      return true;
    }
    if (entry.count >= maxMessages) return false;
    await setMessageRateLimit(uid, entry.windowStart, entry.count + 1);
    return true;
  }

  async function safeSendMessage(chatId, text, options = {}) {
    try {
      await bot.sendMessage(chatId, text, options);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function safeCopyMessage(toChatId, fromChatId, messageId) {
    try {
      await bot.copyMessage(toChatId, fromChatId, messageId);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function enforceBanState(userId, options = {}) {
    const uid = Number(userId);
    const { notifySelf = false, selfChatId = uid, partnerText = 'Partner dihentikan karena pelanggaran aturan.' } = options;
    await clearWaitingUser(uid);
    await setUserState(uid, 'banned');
    if (await getPartner(uid)) {
      await stopChat(uid, { notifySelf: false, notifyPartner: true, partnerText });
    }
    if (notifySelf) {
      await safeSendMessage(selfChatId, config.MESSAGES.banned);
    }
  }

  async function banUserByAdmin(targetUserId, adminId, reason) {
    const uid = Number(targetUserId);
    const cleanedReason = sanitizeInput(reason, config.MAX_ADMIN_NOTE_LENGTH) || 'Pelanggaran aturan.';
    await banUser(uid, adminId, cleanedReason);
    await logAdminAction(adminId, 'ban_user', uid, null, cleanedReason);
    await enforceBanState(uid, { notifySelf: false, partnerText: 'Partner dihentikan karena pelanggaran aturan.' });
    await safeSendMessage(uid, `${config.MESSAGES.banned}\nAlasan: ${cleanedReason}`);
  }

  function hasForwardableContent(msg) {
    return Boolean(msg.text || msg.photo || msg.video || msg.voice || msg.sticker || msg.document || msg.animation || msg.audio || msg.video_note);
  }

  async function stopChat(userId, options = {}) {
    const uid = Number(userId);
    const { notifySelf = true, selfText = config.MESSAGES.chatStopped, notifyPartner = true, partnerText = config.MESSAGES.partnerStopped } = options;
    
    await clearWaitingUser(uid);
    const partnerId = await removeChatPair(uid);
    if (await getUserStatus(uid) !== 'banned') await setUserState(uid, 'idle');

    if (partnerId) {
      if (await getUserStatus(partnerId) !== 'banned') await setUserState(partnerId, 'idle');
      if (notifyPartner) await safeSendMessage(partnerId, partnerText);
    }
    if (notifySelf) await safeSendMessage(uid, selfText);
    return partnerId;
  }

  async function findPartner(userId) {
    const uid = Number(userId);
    await clearWaitingUser(uid);
    const partnerId = await getNextWaitingUser(uid);

    if (!partnerId) {
      await addToWaitingQueue(uid);
      await setUserState(uid, 'waiting');
      await safeSendMessage(uid, config.MESSAGES.waiting);
      return;
    }

    await createChatPair(uid, partnerId);
    await safeSendMessage(uid, config.MESSAGES.partnerFound);
    await safeSendMessage(partnerId, config.MESSAGES.partnerFound);
  }

  async function createReportSession(reporterId, reportedUserId) {
    const reporter = Number(reporterId);
    const reported = Number(reportedUserId);
    const limiter = await canCreateReport(reporter);
    if (!limiter.ok) return limiter;

    let reportId = generateReportId();
    while (await getReport(reportId)) {
      reportId = generateReportId();
    }
    await createReport(reportId, reporter, reported);
    await recordReportCreated(reporter);
    return { ok: true, reportId };
  }

  async function forwardAnonymousMessage(msg) {
    const fromId = Number(msg.from.id);
    if (await isBanned(fromId)) {
      await enforceBanState(fromId, { notifySelf: true, selfChatId: fromId });
      return;
    }

    const partnerId = await getPartner(fromId);
    if (!partnerId) return;

    if (await isBanned(partnerId)) {
      await stopChat(fromId, { notifySelf: false, notifyPartner: false });
      await safeSendMessage(fromId, 'Partner tidak tersedia lagi. Gunakan /search untuk mencari partner baru.');
      return;
    }

    if (!await checkRateLimit(fromId)) {
      await safeSendMessage(fromId, config.MESSAGES.rateLimitedMessage);
      return;
    }

    if (!hasForwardableContent(msg)) {
      await safeSendMessage(fromId, config.MESSAGES.unsupportedMessage);
      return;
    }

    const sent = await safeCopyMessage(partnerId, msg.chat.id, msg.message_id);
    if (!sent) await safeSendMessage(fromId, 'Pesan gagal diteruskan. Coba kirim ulang.');
  }

  function runSafely(handler) {
    return async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        const msg = args[0];
        if (msg?.chat?.id) {
          await safeSendMessage(msg.chat.id, 'Terjadi kesalahan sistem. Coba lagi beberapa saat.');
        }
      }
    };
  }

  function getAdminCommandsHelp() {
    return [
      'Perintah admin:',
      `${config.ADMIN_COMMANDS.STATS}`,
      `${config.ADMIN_COMMANDS.USERS} [PAGE]`,
      `${config.ADMIN_COMMANDS.ACTIVE_USERS} [PAGE]`,
      `${config.ADMIN_COMMANDS.WAITING_USERS} [PAGE]`,
      `${config.ADMIN_COMMANDS.CHATTING_USERS} [PAGE]`,
      `${config.ADMIN_COMMANDS.BROADCAST} isi pesan`,
      `${config.ADMIN_COMMANDS.BAN} USER_ID alasan`,
      `${config.ADMIN_COMMANDS.UNBAN} USER_ID`,
      `${config.ADMIN_COMMANDS.BANNED} [PAGE]`,
      `${config.ADMIN_COMMANDS.USER_INFO} USER_ID`
    ].join('\n');
  }

  bot.onText(/^\/start(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    let helpText = config.MESSAGES.help;
    if (isAdmin(userId)) helpText = `${helpText}\n\n${getAdminCommandsHelp()}`;
    await safeSendMessage(msg.chat.id, `${config.MESSAGES.start}\n\n${helpText}`);
  }));

  bot.onText(/^\/help(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    let helpText = config.MESSAGES.help;
    if (isAdmin(userId)) helpText = `${helpText}\n\n${getAdminCommandsHelp()}`;
    await safeSendMessage(msg.chat.id, helpText);
  }));

  bot.onText(/^\/search(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    if (await getPartner(userId) || await getUserStatus(userId) === 'chatting') {
      await safeSendMessage(msg.chat.id, 'Anda sedang chatting. Gunakan /next atau /stop.');
      return;
    }
    if (await getUserStatus(userId) === 'waiting') {
      await safeSendMessage(msg.chat.id, config.MESSAGES.alreadyWaiting);
      return;
    }
    await setUserState(userId, 'waiting');
    await findPartner(userId);
  }));

  bot.onText(/^\/stop(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    if (!await getPartner(userId)) {
      await clearWaitingUser(userId);
      await setUserState(userId, 'idle');
      await safeSendMessage(msg.chat.id, config.MESSAGES.noActiveChat);
      return;
    }
    await stopChat(userId);
  }));

  bot.onText(/^\/next(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    if (await getPartner(userId)) {
      await stopChat(userId, { notifySelf: false, notifyPartner: true, partnerText: 'Partner berpindah ke chat lain.' });
    } else {
      await clearWaitingUser(userId);
      await setUserState(userId, 'idle');
    }
    await safeSendMessage(msg.chat.id, 'Mencari partner baru...');
    await setUserState(userId, 'waiting');
    await findPartner(userId);
  }));

  bot.onText(/^\/report(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    await touchUser(userId);
    if (await isBanned(userId)) {
      await enforceBanState(userId, { notifySelf: true, selfChatId: msg.chat.id });
      return;
    }
    const partnerId = await getPartner(userId);
    if (!partnerId) {
      await safeSendMessage(msg.chat.id, config.MESSAGES.reportOnlyInChat);
      return;
    }
    const result = await createReportSession(userId, partnerId);
    if (!result.ok) {
      if (result.reason === 'daily_limit') await safeSendMessage(msg.chat.id, config.MESSAGES.reportLimitExceeded);
      else if (result.reason === 'cooldown') await safeSendMessage(msg.chat.id, config.MESSAGES.reportCooldown);
      else await safeSendMessage(msg.chat.id, config.MESSAGES.reportAlreadyActive);
      return;
    }
    const reportLink = `https://t.me/${config.REPORT_BOT_USERNAME}?start=report_${result.reportId}`;
    const text = `${config.MESSAGES.reportCreated}\n${reportLink}\n\nReport ID: ${result.reportId}`;
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/stats(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from || !isAdmin(msg.from.id)) {
      if (msg.chat?.id) await safeSendMessage(msg.chat.id, config.MESSAGES.adminOnly);
      return;
    }
    const stats = await getUserStats(config.ACTIVE_USER_WINDOW_MS);
    const text = [
      'Statistik Main Bot:',
      `- total user: ${stats.totalUsers}`,
      `- online: ${stats.totalOnline}`,
      `- idle: ${stats.totalIdle}`,
      `- waiting: ${stats.totalWaiting}`,
      `- chatting: ${stats.totalChatting}`,
      `- banned: ${stats.totalBanned}`,
      `- active chats: ${stats.totalActiveChats}`,
      `- queue: ${stats.totalWaitingQueue}`,
      `- report sessions: ${stats.totalActiveReportSessions}`
    ].join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/users(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const page = parsePage(match?.[1]);
    const paged = await listUsers(page, config.ADMIN_LIST_PAGE_SIZE);
    if (!paged.items.length) {
      await safeSendMessage(msg.chat.id, 'Belum ada user.');
      return;
    }
    const lines = paged.items.map((user, idx) => {
      const number = (paged.page - 1) * config.ADMIN_LIST_PAGE_SIZE + idx + 1;
      return `${number}. ${user.user_id} | status:${normalizeStatus(user.status)} | joined:${formatTs(user.joined_at)}`;
    });
    await safeSendMessage(msg.chat.id, [`Users page ${paged.page}/${paged.totalPages}`, ...lines].join('\n'));
  }));

  async function triggerNextBroadcast(jobId, page) {
    const webhookUrl = config.WEBHOOK_URL;
    if (!webhookUrl || webhookUrl === 'ISI_URL_VERCEL_DISINI') {
      // Jalankan langsung di memori jika tidak ada webhook URL (contoh: testing lokal)
      bot.processUpdate({
        update_id: Date.now(),
        message: {
          message_id: Date.now(),
          from: { id: config.SUPER_ADMIN_IDS[0] },
          chat: { id: config.SUPER_ADMIN_IDS[0], type: 'private' },
          text: `/continue_broadcast ${jobId} ${page}`
        }
      });
      return;
    }
    
    const fetchObj = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const fakeUpdate = {
      update_id: Date.now(),
      message: {
        message_id: Date.now(),
        from: { id: config.SUPER_ADMIN_IDS[0] },
        chat: { id: config.SUPER_ADMIN_IDS[0], type: 'private' },
        text: `/continue_broadcast ${jobId} ${page}`
      }
    };
    try {
      fetchObj(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fakeUpdate)
      }).catch(() => {});
    } catch(e) {}
  }

  bot.onText(/^\/activeusers(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const page = parsePage(match?.[1]);
    const res = await listActiveUsers(config.ACTIVE_USER_WINDOW_MS, page, config.ADMIN_LIST_PAGE_SIZE);
    if (!res.items.length) { await safeSendMessage(msg.chat.id, 'Tidak ada user aktif.'); return; }
    const text = `Active Users page ${res.page}/${res.totalPages}\n` + res.items.map((u, i) => `${i + 1 + (res.page - 1) * res.limit}. ${u.user_id} | status:${u.status}`).join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/waitingusers(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const page = parsePage(match?.[1]);
    const res = await listWaitingUsers(page, config.ADMIN_LIST_PAGE_SIZE);
    if (!res.items.length) { await safeSendMessage(msg.chat.id, 'Tidak ada user waiting.'); return; }
    const text = `Waiting Users page ${res.page}/${res.totalPages}\n` + res.items.map((u, i) => `${i + 1 + (res.page - 1) * res.limit}. ${u.user_id} | since:${formatTs(u.queued_at)}`).join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/chattingusers(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const page = parsePage(match?.[1]);
    const res = await listChatPairs(page, config.ADMIN_LIST_PAGE_SIZE);
    if (!res.items.length) { await safeSendMessage(msg.chat.id, 'Tidak ada user chatting.'); return; }
    const text = `Chatting Pairs page ${res.page}/${res.totalPages}\n` + res.items.map((u, i) => `${i + 1 + (res.page - 1) * res.limit}. ${u.user_id} & ${u.partner_id} | since:${formatTs(u.started_at)}`).join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/banned(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const page = parsePage(match?.[1]);
    const res = await getBannedUsers(page, config.ADMIN_LIST_PAGE_SIZE);
    if (!res.items.length) { await safeSendMessage(msg.chat.id, 'Tidak ada user banned.'); return; }
    const text = `Banned Users page ${res.page}/${res.totalPages}\n` + res.items.map((u, i) => `${i + 1 + (res.page - 1) * res.limit}. ${u.user_id} | reason:${u.ban_reason || '-'}`).join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/userinfo(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const targetId = Number(match?.[1]);
    if (!targetId || isNaN(targetId)) {
      await safeSendMessage(msg.chat.id, 'Format salah. Gunakan: /userinfo <user_id>');
      return;
    }
    const info = await getUserInfo(targetId);
    if (!info) { await safeSendMessage(msg.chat.id, 'User tidak ditemukan.'); return; }
    const text = [
      `User Info: ${targetId}`,
      `Status: ${info.status}`,
      `Joined: ${formatTs(info.joined_at)}`,
      `Last Active: ${formatTs(info.last_active)}`,
      `Is Waiting: ${info.is_waiting ? 'Ya' : 'Tidak'}`,
      `Partner ID: ${info.partner_id || '-'}`,
      `Banned: ${info.is_banned ? 'Ya' : 'Tidak'}`,
      info.is_banned ? `Ban Reason: ${info.ban_reason || '-'}` : '',
      `Reports Made: ${info.total_reports_made}`,
      `Reports Against: ${info.total_reports_against}`
    ].filter(Boolean).join('\n');
    await safeSendMessage(msg.chat.id, text);
  }));

  bot.onText(/^\/broadcast(?:@\w+)?(?:\s+([\s\S]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const message = sanitizeInput(match?.[1] || '', 1000);
    if (!message) {
      await safeSendMessage(msg.chat.id, 'Format: /broadcast isi pesan');
      return;
    }

    if (await getRuntimeState('broadcastInProgress') === 'true') {
      await safeSendMessage(msg.chat.id, 'Broadcast lain masih berjalan.');
      return;
    }
    await setRuntimeState('broadcastInProgress', 'true');

    const chunk = await listBroadcastTargets(1, 1);
    const totalTarget = chunk.total;
    const jobId = await createBroadcastJob(msg.from.id, message, totalTarget);

    await safeSendMessage(msg.chat.id, `Broadcast #${jobId} dimulai untuk ${totalTarget} user...`);
    
    // Trigger the first page
    await triggerNextBroadcast(jobId, 1);
  }));

  bot.onText(/^\/continue_broadcast(?:@\w+)?\s+(\d+)\s+(\d+)$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const jobId = Number(match?.[1]);
    const page = Number(match?.[2]);
    
    const job = await getBroadcastJob(jobId);
    if (!job || job.status === 'completed') return;

    const pageSize = config.ADMIN_LIST_PAGE_SIZE;
    const chunk = await listBroadcastTargets(page, pageSize);
    if (!chunk.items.length) {
      await finishBroadcastJob(jobId);
      await setRuntimeState('broadcastInProgress', 'false');
      await safeSendMessage(job.admin_id, `Broadcast #${jobId} Selesai!\nBerhasil: ${job.success_count}\nGagal: ${job.fail_count}\nDilewati: ${job.skipped_count}`);
      await logBroadcast(job.admin_id, job.message, job.total_target, job.success_count, job.fail_count, job.skipped_count);
      return;
    }

    let success = 0, failed = 0;
    for (const row of chunk.items) {
      const ok = await safeSendMessage(Number(row.user_id), `[Broadcast]\n${job.message}`);
      if (ok) success++; else failed++;
    }

    await updateBroadcastJobProgress(jobId, success, failed, 0, page + 1);
    
    // Kirim feedback ke admin tiap kelipatan tertentu agar admin tahu proses berjalan
    if (page % 5 === 0) {
      await safeSendMessage(job.admin_id, `Broadcast #${jobId} progress: halaman ${page}/${chunk.totalPages}`);
    }

    // Trigger next page via HTTP call to bypass Vercel 10s limit
    await triggerNextBroadcast(jobId, page + 1);
  }));

  bot.onText(/^\/ban(?:@\w+)?(?:\s+(\d+))?(?:\s+([\s\S]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const targetId = Number(match?.[1]);
    if (!targetId || isNaN(targetId)) {
      await safeSendMessage(msg.chat.id, 'Format salah. Gunakan: /ban <user_id> [alasan]');
      return;
    }
    const adminId = Number(msg.from.id);
    const reason = sanitizeInput(match?.[2] || 'Pelanggaran aturan.', config.MAX_ADMIN_NOTE_LENGTH);
    if (targetId === adminId) return;
    await banUserByAdmin(targetId, adminId, reason);
    await safeSendMessage(msg.chat.id, `User ${targetId} diban.`);
  }));

  bot.onText(/^\/unban(?:@\w+)?(?:\s+(\d+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const targetId = Number(match?.[1]);
    if (!targetId || isNaN(targetId)) {
      await safeSendMessage(msg.chat.id, 'Format salah. Gunakan: /unban <user_id>');
      return;
    }
    await unbanUser(targetId);
    await clearWaitingUser(targetId);
    await logAdminAction(msg.from.id, 'unban_user', targetId, null, null);
    await safeSendMessage(targetId, config.MESSAGES.unbanned);
    await safeSendMessage(msg.chat.id, `User ${targetId} di-unban.`);
  }));

  bot.on('message', runSafely(async (msg) => {
    if (!msg.from || !msg.chat || msg.chat.type !== 'private') return;
    await touchUser(Number(msg.from.id));
    if (msg.text && msg.text.startsWith('/')) return;
    await forwardAnonymousMessage(msg);
  }));

  bot.on('polling_error', (error) => {
    console.error('[MainBot] Polling error:', error?.message);
  });

  return bot;
}

module.exports = { startMainBot };
