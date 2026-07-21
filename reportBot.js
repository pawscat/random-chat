'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const database = require('./database');

const {
  getReport, updateReportEvidence, updateReportDescription, updateReportViolationType,
  submitReport, listReportsByStatus, listReportsByReporter, listClaimedReportsByAdmin,
  listReportsByStatuses, getNextSubmittedReport, claimReport, releaseReport, resolveReport,
  rejectReport, markReportBanned, countReportsByStatus, banUser, updateUserStatus,
  clearWaitingUser, getPartner, removeChatPair, isUserBanned, logAdminAction,
  getReportStep, setReportStep, deleteReportStep, getRuntimeState, setRuntimeState
} = database;

function startReportBot() {
  if (!config.REPORT_BOT_TOKEN || config.REPORT_BOT_TOKEN.includes('ISI_TOKEN')) {
    throw new Error('REPORT_BOT_TOKEN belum diisi di config.js');
  }

  // Hapus polling: true untuk Vercel Serverless
  const bot = new TelegramBot(config.REPORT_BOT_TOKEN);
  
  bot.setMyCommands([
    { command: '/start', description: 'Mulai bot laporan' },
    { command: '/status', description: 'Cek status laporan Anda' }
  ]).catch(err => console.error('Gagal set command report bot:', err.message));
  function isAdmin(userId) {
    const ids = Array.isArray(config.ADMIN_IDS) ? config.ADMIN_IDS : [];
    const supers = Array.isArray(config.SUPER_ADMIN_IDS) ? config.SUPER_ADMIN_IDS : [];
    return ids.includes(Number(userId)) || supers.includes(Number(userId));
  }
  
  function isSuperAdmin(userId) {
    const supers = Array.isArray(config.SUPER_ADMIN_IDS) ? config.SUPER_ADMIN_IDS : [];
    return supers.includes(Number(userId));
  }

  function sanitizeInput(text, maxLen) {
    return String(text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  function formatTs(ts) {
    if (!ts) return '-';
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString();
  }

  async function safeSendMessage(chatId, text, options = {}) {
    try {
      await bot.sendMessage(chatId, text, options);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function safeSendPhoto(chatId, photoId, options = {}) {
    try {
      await bot.sendPhoto(chatId, photoId, options);
      return true;
    } catch (error) {
      return false;
    }
  }

  function isTerminalStatus(status) {
    return status === 'resolved' || status === 'rejected' || status === 'banned';
  }

  function canStartReportFlow(userId, report) {
    if (report.reporter_id !== userId) return { ok: false, reason: 'owner_mismatch' };
    if (report.status !== 'pending_evidence' && !isTerminalStatus(report.status)) return { ok: false, reason: 'not_editable' };
    if (isTerminalStatus(report.status)) return { ok: false, reason: 'already_closed' };
    return { ok: true };
  }

  function getReportDetailText(report) {
    return [
      `Report ID: ${report.report_id}`,
      `Status: ${report.status}`,
      `Reporter: ${report.reporter_id}`,
      `Reported User: ${report.reported_user_id}`,
      `Violation: ${report.violation_type || '-'}`,
      `Description: ${report.description || '-'}`,
      `Created At: ${formatTs(report.created_at)}`,
      `Admin Note: ${report.admin_note || '-'}`
    ].join('\n');
  }

  async function listUnfinishedReports(limit = 30) {
    const pending = (await listReportsByStatus('pending_evidence', 1, limit)).items;
    const active = (await listReportsByStatuses('submitted', 'under_review', 1, limit)).items;
    return [...pending, ...active].sort((a, b) => Number(a.created_at) - Number(b.created_at)).slice(0, limit);
  }

  async function notifyAdminsNewReport() {
    const now = Date.now();
    const lastAt = Number(await getRuntimeState('lastAdminNotificationAt')) || 0;
    if (now - lastAt < config.ADMIN_NOTIFICATION_COOLDOWN_MS) return;
    
    await setRuntimeState('lastAdminNotificationAt', now.toString());
    const ids = Array.isArray(config.ADMIN_IDS) ? config.ADMIN_IDS : [];
    const supers = Array.isArray(config.SUPER_ADMIN_IDS) ? config.SUPER_ADMIN_IDS : [];
    const allAdmins = new Set([...ids, ...supers].map(Number));

    for (const adminId of allAdmins) {
      await safeSendMessage(adminId, config.MESSAGES.adminNewReportNotification);
    }
  }

  function hasAdminAccessToFinalize(report, adminId) {
    if (!report.claimed_by_admin_id) return isSuperAdmin(adminId);
    if (Number(report.claimed_by_admin_id) === Number(adminId)) return true;
    return isSuperAdmin(adminId);
  }

  async function banUserInMainScope(userId, reason, adminId = 0) {
    const uid = Number(userId);
    const safeReason = sanitizeInput(reason, config.MAX_ADMIN_NOTE_LENGTH) || 'Pelanggaran aturan.';

    await banUser(uid, adminId, safeReason);
    await updateUserStatus(uid, 'banned');
    await clearWaitingUser(uid);

    const partnerId = await getPartner(uid);
    if (partnerId) {
      await removeChatPair(uid);
      await safeSendMessage(partnerId, 'Partner dihentikan karena pelanggaran aturan.');
      if (!await isUserBanned(partnerId)) {
        await updateUserStatus(partnerId, 'idle');
      }
    }
    await safeSendMessage(uid, `${config.MESSAGES.banned}\nAlasan: ${safeReason}`);
  }

  bot.pendingPromises = [];
  function runSafely(handler) {
    return async (...args) => {
      const p = (async () => {
        try {
          await handler(...args);
        } catch (error) {
          const msg = args[0];
          if (msg?.chat?.id) {
            await safeSendMessage(msg.chat.id, 'Terjadi kesalahan. Silakan coba lagi.');
          }
        }
      })();
      bot.pendingPromises.push(p);
      await p;
      bot.pendingPromises = bot.pendingPromises.filter(x => x !== p);
    };
  }


  const getViolationKeyboard = () => {
    const keyboard = [];
    let row = [];
    config.REPORT_VIOLATION_TYPES.forEach((v, idx) => {
      row.push({ text: v, callback_data: 'viol_' + idx });
      if (row.length === 2) { keyboard.push(row); row = []; }
    });
    if (row.length > 0) keyboard.push(row);
    return { reply_markup: { inline_keyboard: keyboard } };
  };

  bot.on('callback_query', runSafely(async (query) => {
    if (!query.data || !query.message) return;
    const userId = Number(query.from.id);
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (isAdmin(userId) && query.data.startsWith('admin_cmd_')) {
      const cmd = query.data.replace('admin_cmd_', '');
      bot.processUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: query.from, chat: query.message.chat, date: Math.floor(Date.now() / 1000), text: cmd } });
      await bot.answerCallbackQuery(query.id);
      return;
    } else if (isAdmin(userId) && query.data.startsWith('admin_prompt_')) {
      const cmd = query.data.replace('admin_prompt_', '');
      let text = '';
      let stepName = '';
      if (cmd === '/claim') { text = 'Kirimkan Report ID yang ingin diklaim:'; stepName = 'awaiting_claim_id'; }
      if (cmd === '/resolve') { text = 'Kirimkan Report ID yang ingin diselesaikan:\n(Anda akan diminta memberi catatan setelah ini)'; stepName = 'awaiting_resolve_id'; }
      if (cmd === '/reject') { text = 'Kirimkan Report ID yang ingin ditolak:\n(Anda akan diminta alasan setelah ini)'; stepName = 'awaiting_reject_id'; }
      if (cmd === '/banreported') { text = 'Kirimkan Report ID untuk mem-banned pelakunya:'; stepName = 'awaiting_banreported_id'; }
      
      if (stepName) {
        await setAdminStep(userId, stepName);
        await safeSendMessage(chatId, text, { reply_markup: { force_reply: true } });
      }
      await bot.answerCallbackQuery(query.id);
      return;
    } else if (isAdmin(userId) && query.data === 'admin_cancel_step') {
      await deleteAdminStep(userId);
      await safeSendMessage(chatId, 'Operasi dibatalkan.');
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (query.data.startsWith('viol_')) {
      const idx = parseInt(query.data.split('_')[1], 10);
      const violationType = config.REPORT_VIOLATION_TYPES[idx];
      if (!violationType) return;

      const draft = await getReportStep(userId);
      if (!draft || draft.step !== 'awaiting_violation') {
        await bot.answerCallbackQuery(query.id, { text: 'Sesi report tidak valid.' });
        return;
      }

      if (violationType.toLowerCase() === 'lainnya') {
        await setReportStep(userId, draft.reportId, 'awaiting_custom_violation');
        await bot.editMessageText('Silakan ketik manual jenis pelanggarannya:', { chat_id: chatId, message_id: msgId });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      await updateReportViolationType(draft.reportId, violationType);
      await submitReport(draft.reportId);
      await deleteReportStep(userId);
      await bot.editMessageText('Jenis pelanggaran: ' + violationType + '\n\nReport ' + draft.reportId + ' disubmit.', { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id);
      await notifyAdminsNewReport();
    }
  }));

  bot.onText(/^\/admin(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    if (!isAdmin(userId)) {
      await safeSendMessage(msg.chat.id, 'Perintah ini hanya untuk admin.');
      return;
    }
    
    const opts = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 Laporan Menunggu', callback_data: 'admin_cmd_/waitingreports' }],
          [{ text: '🔍 Klaim Laporan', callback_data: 'admin_prompt_/claim' }, { text: '✅ Resolve', callback_data: 'admin_prompt_/resolve' }],
          [{ text: '❌ Tolak Laporan', callback_data: 'admin_prompt_/reject' }, { text: '🔨 Ban Pelaku', callback_data: 'admin_prompt_/banreported' }],
          [{ text: '📊 Status Laporan', callback_data: 'admin_cmd_/statusreports' }]
        ]
      }
    };
    
    await safeSendMessage(msg.chat.id, '<b>⚖️ Panel Kontrol Laporan Admin</b>\nSilakan pilih aksi di bawah ini:', opts);
  }));

  bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from) return;
    const userId = Number(msg.from.id);
    const payload = (match?.[1] || '').trim();

    if (!payload || !payload.startsWith('report_')) {
      await safeSendMessage(msg.chat.id, 'Masuk dari link /report di bot utama untuk melanjutkan laporan.');
      return;
    }

    const reportId = payload.slice('report_'.length).trim();
    const report = await getReport(reportId);
    if (!report) {
      await safeSendMessage(msg.chat.id, 'Report ID tidak valid atau tidak ditemukan.');
      return;
    }

    const canStart = canStartReportFlow(userId, report);
    if (!canStart.ok) {
      await safeSendMessage(msg.chat.id, `Gagal memproses report. Alasan: ${canStart.reason}`);
      return;
    }

    let step = 'awaiting_photo';
    if (report.evidence_photo_file_id && !report.description) step = 'awaiting_description';
    else if (report.evidence_photo_file_id && report.description && !report.violation_type) step = 'awaiting_violation';

    await setReportStep(userId, reportId, step);

    if (step === 'awaiting_photo') await safeSendMessage(msg.chat.id, `Report ${reportId} aktif. Kirim screenshot bukti (foto).`);
    else if (step === 'awaiting_description') await safeSendMessage(msg.chat.id, `Kirim penjelasan singkat pelanggaran.`);
    else {
      await safeSendMessage(msg.chat.id, 'Pilih jenis pelanggaran:', getViolationKeyboard());
    }
  }));

  bot.on('photo', runSafely(async (msg) => {
    if (!msg.from || !msg.photo || !msg.photo.length) return;
    const userId = Number(msg.from.id);
    const draft = await getReportStep(userId);
    if (!draft || draft.step !== 'awaiting_photo') return;

    const report = await getReport(draft.reportId);
    if (!report || report.reporter_id !== userId || report.status !== 'pending_evidence') {
      await deleteReportStep(userId);
      await safeSendMessage(msg.chat.id, 'Report tidak valid.');
      return;
    }

    const photo = msg.photo[msg.photo.length - 1];
    await updateReportEvidence(draft.reportId, photo.file_id);
    await setReportStep(userId, draft.reportId, 'awaiting_description');
    await safeSendMessage(msg.chat.id, 'Screenshot diterima. Sekarang kirim penjelasan singkat pelanggaran.');
  }));

  bot.on('message', runSafely(async (msg) => {
    if (!msg.from || !msg.chat || msg.chat.type !== 'private') return;
    const userId = Number(msg.from.id);

    const adminStep = isAdmin(userId) ? await getAdminStep(userId) : null;
    if (adminStep) {
      if (msg.text && msg.text.startsWith('/')) {
        await deleteAdminStep(userId);
        if (msg.text === '/cancel') {
          await safeSendMessage(msg.chat.id, 'Operasi dibatalkan.');
          return;
        }
      } else {
        if (adminStep.step === 'awaiting_claim_id') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          bot.processUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: msg.from, chat: msg.chat, date: Math.floor(Date.now() / 1000), text: `/claim ${msg.text}` }});
          await deleteAdminStep(userId);
          return;
        }
        if (adminStep.step === 'awaiting_resolve_id') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          await setAdminStep(userId, 'awaiting_resolve_note', msg.text);
          await safeSendMessage(msg.chat.id, 'Kirimkan catatan penyelesaian (note):', { reply_markup: { force_reply: true } });
          return;
        }
        if (adminStep.step === 'awaiting_resolve_note') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          const targetId = adminStep.payload;
          bot.processUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: msg.from, chat: msg.chat, date: Math.floor(Date.now() / 1000), text: `/resolve ${targetId} ${msg.text}` }});
          await deleteAdminStep(userId);
          return;
        }
        if (adminStep.step === 'awaiting_reject_id') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          await setAdminStep(userId, 'awaiting_reject_reason', msg.text);
          await safeSendMessage(msg.chat.id, 'Kirimkan alasan penolakan:', { reply_markup: { force_reply: true } });
          return;
        }
        if (adminStep.step === 'awaiting_reject_reason') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          const targetId = adminStep.payload;
          bot.processUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: msg.from, chat: msg.chat, date: Math.floor(Date.now() / 1000), text: `/reject ${targetId} ${msg.text}` }});
          await deleteAdminStep(userId);
          return;
        }
        if (adminStep.step === 'awaiting_banreported_id') {
          if (!msg.text) { await deleteAdminStep(userId); return; }
          bot.processUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: msg.from, chat: msg.chat, date: Math.floor(Date.now() / 1000), text: `/banreported ${msg.text}` }});
          await deleteAdminStep(userId);
          return;
        }
      }
    }

    if (msg.text && msg.text.startsWith('/')) return;
    const draft = await getReportStep(userId);
    if (!draft) return;

    const report = await getReport(draft.reportId);
    if (!report || report.reporter_id !== userId) {
      await deleteReportStep(userId);
      return;
    }

    if (draft.step === 'awaiting_description') {
      const desc = sanitizeInput(msg.text || '', config.MAX_REPORT_DESCRIPTION_LENGTH);
      if (desc.length < 10) {
        await safeSendMessage(msg.chat.id, 'Penjelasan terlalu singkat.');
        return;
      }
      await updateReportDescription(draft.reportId, desc);
      await setReportStep(userId, draft.reportId, 'awaiting_violation');
      await safeSendMessage(msg.chat.id, 'Pilih jenis pelanggaran:', getViolationKeyboard());
      return;
    }

    if (draft.step === 'awaiting_violation') {
      await safeSendMessage(msg.chat.id, 'Silakan pilih jenis pelanggaran menggunakan tombol di atas.');
      return;
    }

    if (draft.step === 'awaiting_custom_violation') {
      const customViolation = sanitizeInput(msg.text || '', 100);
      if (customViolation.length < 3) {
        await safeSendMessage(msg.chat.id, 'Jenis pelanggaran terlalu singkat.');
        return;
      }
      await updateReportViolationType(draft.reportId, customViolation);
      await submitReport(draft.reportId);
      await deleteReportStep(userId);
      await safeSendMessage(msg.chat.id, `Report ${draft.reportId} disubmit.`);
      await notifyAdminsNewReport();
    }
  }));

  bot.onText(/^\/admin(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminHelp = '🛠 <b>Panel Admin Report Bot:</b>\nPilih aksi yang ingin dilakukan:';
    
    const inlineKeyboard = [
      [{ text: '📋 Lihat Semua Laporan', callback_data: 'admin_cmd_/reports' }],
      [{ text: '⏭️ Proses Laporan Berikutnya', callback_data: 'admin_cmd_/nextreport' }],
      [{ text: '✋ Claim Laporan', callback_data: 'admin_prompt_/claim' }, { text: '✅ Resolve Laporan', callback_data: 'admin_prompt_/resolve' }],
      [{ text: '❌ Reject Laporan', callback_data: 'admin_prompt_/reject' }, { text: '🔨 Ban Pelaku', callback_data: 'admin_prompt_/banreported' }]
    ];
    
    await safeSendMessage(msg.chat.id, adminHelp, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }));

  bot.onText(/^\/reports(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const items = await listUnfinishedReports(30);
    if (!items.length) {
      await safeSendMessage(msg.chat.id, 'Tidak ada laporan aktif.');
      return;
    }
    const lines = items.map(r => `${r.report_id} | ${r.status} | ${r.claimed_by_admin_id || ''}`);
    await safeSendMessage(msg.chat.id, ['Daftar laporan aktif:', ...lines].join('\n'));
  }));

  bot.onText(/^\/nextreport(?:@\w+)?$/i, runSafely(async (msg) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminId = Number(msg.from.id);
    const selected = await getNextSubmittedReport();
    if (!selected) {
      await safeSendMessage(msg.chat.id, 'Tidak ada report submitted yang tersedia.');
      return;
    }
    const claimed = await claimReport(selected.report_id, adminId);
    if (!claimed.ok) {
      await safeSendMessage(msg.chat.id, `Gagal claim: ${claimed.reason}`);
      return;
    }
    await logAdminAction(adminId, 'claim_report', null, selected.report_id, 'nextreport');
    await safeSendMessage(msg.chat.id, `Report diambil: ${claimed.report.report_id}\n\n${getReportDetailText(claimed.report)}`);
    if (claimed.report.evidence_photo_file_id) {
      await safeSendPhoto(msg.chat.id, claimed.report.evidence_photo_file_id, { caption: 'Bukti Pelanggaran' });
    }
  }));
  bot.onText(/^\/claim(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminId = Number(msg.from.id);
    const reportId = match?.[1];
    if (!reportId) { await safeSendMessage(msg.chat.id, 'Format: /claim <report_id>'); return; }
    
    const claimed = await claimReport(reportId, adminId);
    if (!claimed.ok) {
      await safeSendMessage(msg.chat.id, `Gagal claim: ${claimed.reason}`);
      return;
    }
    await logAdminAction(adminId, 'claim_report', null, reportId, null);
    await safeSendMessage(msg.chat.id, `Report diambil: ${claimed.report.report_id}\n\n${getReportDetailText(claimed.report)}`);
    if (claimed.report.evidence_photo_file_id) {
      await safeSendPhoto(msg.chat.id, claimed.report.evidence_photo_file_id, { caption: 'Bukti Pelanggaran' });
    }
  }));

  bot.onText(/^\/resolve(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?(?:\s+([\s\S]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminId = Number(msg.from.id);
    const reportId = match?.[1];
    if (!reportId) { await safeSendMessage(msg.chat.id, 'Format: /resolve <report_id> [note]'); return; }
    const note = sanitizeInput(match?.[2] || 'Resolved', config.MAX_ADMIN_NOTE_LENGTH);

    const res = await resolveReport(reportId, adminId, note);
    if (!res.ok) { await safeSendMessage(msg.chat.id, `Gagal: ${res.reason}`); return; }
    
    await logAdminAction(adminId, 'resolve_report', null, reportId, note);
    await safeSendMessage(msg.chat.id, `Report ${reportId} ditutup (Resolved).`);
    const mainBotToken = config.MAIN_BOT_TOKEN;
    if (mainBotToken && !mainBotToken.includes('ISI_TOKEN')) {
      const mb = new TelegramBot(mainBotToken);
      mb.sendMessage(res.report.reporter_id, `Laporan Anda (${reportId}) telah ditangani Admin.`).catch(() => {});
    }
  }));

  bot.onText(/^\/reject(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?(?:\s+([\s\S]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminId = Number(msg.from.id);
    const reportId = match?.[1];
    if (!reportId) { await safeSendMessage(msg.chat.id, 'Format: /reject <report_id> [alasan]'); return; }
    const note = sanitizeInput(match?.[2] || 'Rejected', config.MAX_ADMIN_NOTE_LENGTH);

    const res = await rejectReport(reportId, adminId, note);
    if (!res.ok) { await safeSendMessage(msg.chat.id, `Gagal: ${res.reason}`); return; }
    
    await logAdminAction(adminId, 'reject_report', null, reportId, note);
    await safeSendMessage(msg.chat.id, `Report ${reportId} ditolak (Rejected).`);
    const mainBotToken = config.MAIN_BOT_TOKEN;
    if (mainBotToken && !mainBotToken.includes('ISI_TOKEN')) {
      const mb = new TelegramBot(mainBotToken);
      mb.sendMessage(res.report.reporter_id, `Laporan Anda (${reportId}) ditolak.`).catch(() => {});
    }
  }));

  bot.onText(/^\/banreported(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?(?:\s+([\s\S]+))?$/i, runSafely(async (msg, match) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    const adminId = Number(msg.from.id);
    const reportId = match?.[1];
    if (!reportId) { await safeSendMessage(msg.chat.id, 'Format: /banreported <report_id> [alasan]'); return; }
    const note = sanitizeInput(match?.[2] || 'Banned based on report', config.MAX_ADMIN_NOTE_LENGTH);

    const res = await markReportBanned(reportId, adminId, note);
    if (!res.ok) { await safeSendMessage(msg.chat.id, `Gagal: ${res.reason}`); return; }
    
    await logAdminAction(adminId, 'ban_from_report', res.report.reported_user_id, reportId, note);
    await safeSendMessage(msg.chat.id, `Report ${reportId} ditutup (Banned). Memproses pemblokiran user...`);
    
    await banUser(Number(res.report.reported_user_id), adminId, note);
    
    const mainBotToken = config.MAIN_BOT_TOKEN;
    if (mainBotToken && !mainBotToken.includes('ISI_TOKEN')) {
      const mb = new TelegramBot(mainBotToken);
      mb.sendMessage(res.report.reported_user_id, `${config.MESSAGES.banned}\nAlasan: Terkena report pelanggaran.`).catch(() => {});
    }
  }));

  return bot;
}

module.exports = { startReportBot };
