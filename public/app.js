/* ======================================
   RANDOM CHAT ADMIN DASHBOARD — APP.JS
   ====================================== */

const API_BASE = '/api/dashboard';
let authToken = '';

// ===================== HELPERS =====================

function $(selector) { return document.querySelector(selector); }
function $$(selector) { return document.querySelectorAll(selector); }

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Baru saja';
  if (diffMins < 60) return `${diffMins} menit lalu`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} hari lalu`;
}

// ===================== AUTH =====================

async function login(password) {
  try {
    const resp = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await resp.json();
    if (data.success) {
      authToken = password;
      sessionStorage.setItem('dashToken', password);
      showLoginScreen(false);
      loadDashboard();
      showToast('Login berhasil! Selamat datang.', 'success');
    } else {
      throw new Error(data.error || 'Password salah');
    }
  } catch (err) {
    throw err;
  }
}

function logout() {
  authToken = '';
  sessionStorage.removeItem('dashToken');
  showLoginScreen(true);
}

function showLoginScreen(show) {
  $('#login-screen').style.display = show ? 'flex' : 'none';
  $('#dashboard').style.display = show ? 'none' : 'flex';
}

// ===================== API CALLS =====================

async function apiGet(endpoint) {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    headers: { 'Authorization': authToken }
  });
  if (resp.status === 401) {
    logout();
    showToast('Sesi berakhir. Silakan login kembali.', 'error');
    throw new Error('Unauthorized');
  }
  return resp.json();
}

async function apiPost(endpoint, body) {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authToken
    },
    body: JSON.stringify(body)
  });
  if (resp.status === 401) {
    logout();
    showToast('Sesi berakhir. Silakan login kembali.', 'error');
    throw new Error('Unauthorized');
  }
  return resp.json();
}

// ===================== LOAD DATA =====================

async function loadStats() {
  try {
    const data = await apiGet('stats');
    if (!data.success) return;

    const s = data.stats;
    $('#stat-total-users .stat-value').textContent = s.totalUsers ?? '—';
    $('#stat-active-users .stat-value').textContent = s.totalOnline ?? '—';
    $('#stat-waiting .stat-value').textContent = s.totalWaiting ?? '—';
    $('#stat-chatting .stat-value').textContent = s.totalActiveChats ?? '—';
    $('#stat-banned .stat-value').textContent = s.totalBanned ?? '—';
    $('#stat-reports .stat-value').textContent = s.totalPendingReports ?? '—';

    const sys = data.system;
    $('#server-os .server-card-value').textContent = sys.os;
    $('#server-cpu .server-card-value').textContent = sys.cpu;
    $('#server-ram .server-card-value').textContent = sys.ram;
    $('#server-storage .server-card-value').textContent = sys.storage;
    $('#server-uptime .server-card-value').textContent = sys.uptime;
    $('#server-env .server-card-value').textContent = sys.environment;
    $('#server-node .server-card-value').textContent = sys.node;

    // Cache settings from the same response
    if (data.settings) {
      window._cachedSettings = data.settings;
    }

    $('#last-updated').textContent = `Diperbarui: ${new Date().toLocaleTimeString('id-ID')}`;
  } catch (err) {
    console.error('loadStats error:', err);
  }
}

async function loadUsers(type = 'all') {
  try {
    const data = await apiGet(`users?type=${type}`);
    if (!data.success) return;

    const tbody = $('#users-table-body');
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Tidak ada data user.</td></tr>';
      return;
    }

    tbody.innerHTML = data.users.map((u, index) => {
      const isBanned = u.is_banned === 1 || u.banned === 1;
      let statusBadge = '';
      if (isBanned) {
        statusBadge = '<span class="badge badge-banned">Banned</span>';
      } else {
        const isActive = (Date.now() - (u.last_active || u.lastActive)) < 5 * 60 * 1000;
        if (u.status === 'chatting') {
          statusBadge = '<span class="badge" style="background:var(--accent-blue);color:white">Chatting</span>';
        } else if (u.status === 'waiting') {
          statusBadge = '<span class="badge" style="background:var(--accent-purple);color:white">Mencari</span>';
        } else if (isActive) {
          statusBadge = '<span class="badge badge-active">Online</span>';
        } else {
          statusBadge = '<span class="badge" style="background:#4b5563;color:white">Offline</span>';
        }
      }
      const actionBtn = isBanned
        ? `<button class="action-btn" onclick="userAction('unban', ${u.user_id || u.userId})">Unban</button>`
        : `<button class="action-btn" style="background:var(--accent-amber);color:#fff" onclick="userAction('ban', ${u.user_id || u.userId})">Ban</button>`;
      
      const deleteBtn = `<button class="action-btn" style="background:var(--accent-rose);color:#fff;margin-left:4px" onclick="userAction('delete', ${u.user_id || u.userId})">Hapus</button>`;
      
      const lastActive = timeAgo(u.last_active || u.lastActive);
      const fullName = [u.first_name || u.firstName, u.last_name || u.lastName].filter(Boolean).join(' ') || 'Tanpa Nama';
      const username = u.username ? `<br><small style="color:var(--accent-blue)">@${u.username}</small>` : '';
      const profileInfo = `<div>${fullName}${username}</div>`;

      return `<tr style="animation-delay: ${index * 0.05}s">
        <td><strong>${u.user_id || u.userId || '—'}</strong></td>
        <td>${profileInfo}</td>
        <td>${statusBadge}</td>
        <td><small>${lastActive}</small></td>
        <td>${actionBtn}${deleteBtn}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('loadUsers error:', err);
  }
}

// ===================== REPORTS =====================

async function loadReports(type = 'pending') {
  try {
    const data = await apiGet(`reports?type=${type}`);
    if (!data.success) return;

    const container = $('#reports-container');
    if (!data.reports || data.reports.length === 0) {
      container.innerHTML = '<div class="table-empty">Tidak ada laporan.</div>';
      container.style.display = 'block';
      return;
    }
    
    container.style.display = 'grid';

    container.innerHTML = data.reports.map((r, index) => {
      let statusBadge = '';
      if (r.status === 'submitted') statusBadge = '<span class="report-status pending">Pending</span>';
      else if (r.status === 'under_review') statusBadge = '<span class="report-status claimed">Direview</span>';
      else if (r.status === 'resolved') statusBadge = '<span class="report-status resolved">Selesai</span>';
      else if (r.status === 'banned') statusBadge = '<span class="report-status banned">Banned</span>';
      else if (r.status === 'pending_evidence') statusBadge = '<span class="report-status" style="background:#f59e0b;color:white;">Draft / Menunggu Bukti</span>';
      else statusBadge = `<span class="report-status">${r.status}</span>`;

      const imgHtml = r.evidence_photo_file_id 
        ? `<img class="report-image" src="/api/dashboard/reports?photo=1&file_id=${r.evidence_photo_file_id}&token=${sessionStorage.getItem('dashToken')}" alt="Evidence" onclick="window.open(this.src)">` 
        : '';
      
      const time = new Date(r.created_at || r.createdAt).toLocaleString('id-ID');
      
      let actionHtml = '';
      if (r.status === 'submitted') {
        actionHtml = `<button class="action-btn" style="border-color:var(--accent-blue);color:var(--accent-blue)" onclick="reportAction('claim', '${r.report_id}')">Claim Laporan</button>
                      <button class="action-btn" style="border-color:var(--accent-rose);color:var(--accent-rose)" onclick="reportAction('reject', '${r.report_id}')">Tolak</button>
                      <button class="action-btn" style="background:var(--accent-rose);color:white" onclick="reportAction('delete', '${r.report_id}')">Hapus</button>`;
      } else if (r.status === 'under_review') {
        actionHtml = `
          <button class="action-btn" style="border-color:var(--accent-green);color:var(--accent-green)" onclick="reportAction('resolve', '${r.report_id}')">Tandai Selesai</button>
          <button class="action-btn" style="border-color:var(--accent-rose);color:var(--accent-rose)" onclick="reportAction('ban', '${r.report_id}')">Ban Terlapor</button>
          <button class="action-btn" style="border-color:var(--accent-rose);color:var(--accent-rose)" onclick="reportAction('reject', '${r.report_id}')">Tolak</button>
          <button class="action-btn" style="background:var(--accent-rose);color:white" onclick="reportAction('delete', '${r.report_id}')">Hapus</button>
        `;
      } else {
        actionHtml = `<button class="action-btn" style="background:var(--accent-rose);color:white" onclick="reportAction('delete', '${r.report_id}')">Hapus Permanen</button>`;
      }

      return `
        <div class="report-item" style="animation-delay: ${index * 0.05}s; animation: fadeSlideUp 0.4s ease-out forwards; opacity: 0; transform: translateY(10px);">
          <div class="report-header">
            <div class="report-header-title">
              <span class="report-id">#${(r.report_id||'').substring(0,6)}</span>
              ${statusBadge}
            </div>
            <div class="report-time">${time}</div>
          </div>
          <div class="report-users">
            <div>Pelapor: <strong>${r.reporter_id}</strong></div>
            <div>Terlapor: <strong>${r.reported_user_id}</strong></div>
          </div>
          <div class="report-desc">
            <strong>Pelanggaran:</strong> ${r.violation_type || '-'}<br><br>
            ${r.description || 'Tidak ada deskripsi'}
          </div>
          ${imgHtml}
          ${actionHtml ? `<div class="report-actions">${actionHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('loadReports error:', err);
  }
}

async function reportAction(action, reportId) {
  let confirmMsg = '';
  if (action === 'ban') confirmMsg = 'Yakin ingin mem-ban terlapor dari laporan ini?';
  else if (action === 'resolve') confirmMsg = 'Yakin menandai laporan ini sudah selesai?';
  else if (action === 'reject') confirmMsg = 'Yakin menolak laporan ini?';
  else if (action === 'delete') confirmMsg = 'PERINGATAN: Hapus laporan secara permanen dari database?';
  else confirmMsg = 'Klaim laporan ini untuk ditinjau?';
  
  if (!confirm(confirmMsg)) return;

  try {
    const data = await apiPost('reports', { action, reportId });
    if (data.success) {
      showToast(data.message, 'success');
      const activeFilter = $('.filter-btn[id^="filter-report-"].active');
      loadReports(activeFilter ? activeFilter.dataset.reportFilter : 'pending');
      loadStats();
    } else {
      showToast(data.error || 'Gagal memproses laporan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan.', 'error');
  }
}
window.reportAction = reportAction;

async function loadSettings() {
  try {
    const data = await apiGet('settings');
    if (!data.success) return;
    const settings = data.settings;

    $('#setting-main-token').value = settings.MAIN_BOT_TOKEN || '';
    $('#setting-report-token').value = settings.REPORT_BOT_TOKEN || '';
    $('#setting-dashboard-password').value = settings.DASHBOARD_PASSWORD || '';
    $('#setting-main-bot').value = settings.MAIN_BOT_USERNAME || '';
    $('#setting-report-bot').value = settings.REPORT_BOT_USERNAME || '';
    $('#setting-webhook').value = settings.WEBHOOK_URL || '';
    $('#setting-bot-name').value = settings.BOT_NAME || '';
    $('#setting-admin-ids').value = (settings.ADMIN_IDS || []).join(', ');
    $('#setting-superadmin-ids').value = (settings.SUPER_ADMIN_IDS || []).join(', ');
    $('#setting-report-length').value = settings.MAX_REPORT_DESCRIPTION_LENGTH || '';
    $('#setting-report-limit').value = settings.REPORT_LIMIT_PER_DAY || '';
    $('#setting-active-window').value = settings.ACTIVE_USER_WINDOW_MS || '';
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

async function saveSettings() {
  const btn = $('#save-settings-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Menyimpan...';
  btn.disabled = true;

  try {
    const updates = {
      MAIN_BOT_TOKEN: $('#setting-main-token').value.trim(),
      REPORT_BOT_TOKEN: $('#setting-report-token').value.trim(),
      DASHBOARD_PASSWORD: $('#setting-dashboard-password').value.trim(),
      WEBHOOK_URL: $('#setting-webhook').value.trim(),
      BOT_NAME: $('#setting-bot-name').value.trim(),
      ADMIN_IDS: $('#setting-admin-ids').value.split(',').map(s => Number(s.trim())).filter(n => n > 0),
      MAX_REPORT_DESCRIPTION_LENGTH: Number($('#setting-report-length').value),
      REPORT_LIMIT_PER_DAY: Number($('#setting-report-limit').value),
      ACTIVE_USER_WINDOW_MS: Number($('#setting-active-window').value)
    };

    const data = await apiPost('settings', updates);
    if (data.success) {
      showToast('Pengaturan berhasil disimpan!', 'success');
    } else {
      showToast(data.error || 'Gagal menyimpan pengaturan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan.', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
window.saveSettings = saveSettings;


// ===================== USER ACTIONS =====================

async function userAction(action, userId) {
  let confirmMsg = '';
  if (action === 'ban') confirmMsg = `Apakah Anda yakin ingin mem-ban user ${userId}?`;
  else if (action === 'unban') confirmMsg = `Apakah Anda yakin ingin meng-unban user ${userId}?`;
  else if (action === 'delete') confirmMsg = `PERINGATAN: Hapus permanen user ${userId} beserta histori chat/antreannya?`;

  if (!confirm(confirmMsg)) return;

  try {
    const data = await apiPost('users', { action, userId });
    if (data.success) {
      showToast(data.message, 'success');
      // Reload users with current filter
      const activeFilter = $('.filter-btn.active');
      loadUsers(activeFilter ? activeFilter.dataset.filter : 'all');
      loadStats();
    } else {
      showToast(data.error || 'Gagal melakukan aksi.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan.', 'error');
  }
}

// Make userAction globally accessible
window.userAction = userAction;

// ===================== NAVIGATION =====================

function switchPage(pageName) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-link').forEach(l => l.classList.remove('active'));

  const page = $(`#page-${pageName}`);
  const link = $(`[data-page="${pageName}"]`);

  if (page) page.classList.add('active');
  if (link) link.classList.add('active');

  if (pageName === 'users') loadUsers();
  if (pageName === 'server') loadStats();
  if (pageName === 'settings') loadSettings();
  
  if (pageName === 'reports') {
    const activeFilter = $('.filter-btn[id^="filter-report-"].active');
    loadReports(activeFilter ? activeFilter.dataset.reportFilter : 'pending');
  }
  
  if (pageName === 'sessions') {
    const activeFilter = $('.filter-btn[id^="filter-session-"].active');
    loadSessions(activeFilter ? activeFilter.dataset.sessionFilter : 'active');
  }

  // Close mobile sidebar
  closeMobileSidebar();
}

function closeMobileSidebar() {
  $('.sidebar').classList.remove('open');
  const overlay = $('.sidebar-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ===================== DASHBOARD INIT =====================

function loadDashboard() {
  loadStats();
  loadSettings();
}

// ===================== EVENT LISTENERS =====================

document.addEventListener('DOMContentLoaded', () => {

  // Login form
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#login-password').value.trim();
    const errEl = $('#login-error');
    const btnText = $('.btn-text');
    const btnLoader = $('.btn-loader');

    if (!password) {
      errEl.textContent = 'Masukkan password.';
      return;
    }

    btnText.style.display = 'none';
    btnLoader.style.display = 'inline';
    errEl.textContent = '';

    try {
      await login(password);
    } catch (err) {
      errEl.textContent = err.message || 'Password salah.';
    } finally {
      btnText.style.display = 'inline';
      btnLoader.style.display = 'none';
    }
  });

  // Navigation links
  $$('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      switchPage(page);
    });
  });

  // Logout
  $('#logout-btn').addEventListener('click', logout);
  $('#mobile-logout').addEventListener('click', logout);

  // Mobile menu toggle
  $('#menu-toggle').addEventListener('click', () => {
    const sidebar = $('.sidebar');
    sidebar.classList.toggle('open');

    let overlay = $('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', closeMobileSidebar);
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('active', sidebar.classList.contains('open'));
  });

  // Refresh button
  $('#refresh-btn').addEventListener('click', () => {
    const btn = $('#refresh-btn');
    btn.classList.add('spinning');
    loadStats();
    setTimeout(() => btn.classList.remove('spinning'), 800);
  });

  // User filter buttons
  $$('.filter-btn[id^="filter-all"], .filter-btn[id^="filter-active"], .filter-btn[id^="filter-banned"]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn[id^="filter-all"], .filter-btn[id^="filter-active"], .filter-btn[id^="filter-banned"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadUsers(btn.dataset.filter);
    });
  });

  // Report filter buttons
  $$('.filter-btn[id^="filter-report-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn[id^="filter-report-"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadReports(btn.dataset.reportFilter);
    });
  });

  // Session filter buttons
  $$('.filter-btn[id^="filter-session-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn[id^="filter-session-"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSessions(btn.dataset.sessionFilter);
    });
  });

  // User search
  let searchTimeout;
  $('#user-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = e.target.value.trim();
      if (query) {
        // Filter table rows client-side
        const rows = $$('#users-table-body tr');
        rows.forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query.toLowerCase()) ? '' : 'none';
        });
      } else {
        const rows = $$('#users-table-body tr');
        rows.forEach(row => row.style.display = '');
      }
    }, 300);
  });

  // Report search
  let reportSearchTimeout;
  $('#report-search')?.addEventListener('input', (e) => {
    clearTimeout(reportSearchTimeout);
    reportSearchTimeout = setTimeout(() => {
      const query = e.target.value.trim().toLowerCase();
      const items = $$('.report-item');
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      });
    }, 300);
  });

  // Auto-login from session
  const savedToken = sessionStorage.getItem('dashToken');
  if (savedToken) {
    authToken = savedToken;
    showLoginScreen(false);
    loadDashboard();
  }

  // Auto-refresh Logic
  let refreshIntervalId = null;
  const savedRefreshInterval = localStorage.getItem('autoRefreshInterval');

  function updateAutoRefresh(saveToStorage = true) {
    if (refreshIntervalId) clearInterval(refreshIntervalId);

    const overviewSelect = $('#auto-refresh-overview');
    const interval = Number(overviewSelect ? overviewSelect.value : 30000);
    
    if (saveToStorage) {
      localStorage.setItem('autoRefreshInterval', interval.toString());
    }

    if (interval > 0) {
      refreshIntervalId = setInterval(() => {
        if (authToken && ($('#page-overview').classList.contains('active') || $('#page-server').classList.contains('active'))) {
          loadStats();
        }
      }, interval);
    }
  }

  const overviewSelect = $('#auto-refresh-overview');
  const serverSelect = $('#auto-refresh-server');

  if (savedRefreshInterval) {
    if (overviewSelect) overviewSelect.value = savedRefreshInterval;
    if (serverSelect) serverSelect.value = savedRefreshInterval;
  }

  if (overviewSelect) {
    overviewSelect.addEventListener('change', (e) => {
      if (serverSelect) serverSelect.value = e.target.value;
      updateAutoRefresh(true);
    });
  }

  if (serverSelect) {
    serverSelect.addEventListener('change', (e) => {
      if (overviewSelect) overviewSelect.value = e.target.value;
      updateAutoRefresh(true);
    });
  }

  updateAutoRefresh(false);
});

// ===================== SESSIONS =====================

async function loadSessions(type = 'active') {
  try {
    const data = await apiGet(`sessions?type=${type}`);
    if (!data.success) return;

    const tbody = $('#sessions-table-body');
    const thead = $('#sessions-table-head');
    
    if (type === 'active') {
      thead.innerHTML = `
        <tr>
          <th>User A</th>
          <th>User B</th>
          <th>Waktu Mulai</th>
          <th>Aksi</th>
        </tr>
      `;
    } else {
      thead.innerHTML = `
        <tr>
          <th>User ID</th>
          <th>Profil</th>
          <th>Waktu Masuk Antrean</th>
          <th>Aksi</th>
        </tr>
      `;
    }

    if (!data.items || data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Tidak ada data.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.items.map((i, index) => {
      if (type === 'active') {
        const time = new Date(i.started_at || i.startedAt).toLocaleString('id-ID');
        return `<tr style="animation-delay: ${index * 0.05}s">
          <td>${i.user_id}</td>
          <td>${i.partner_id}</td>
          <td>${time}</td>
          <td><button class="action-btn" style="background:var(--accent-rose);color:white" onclick="sessionAction('stop_chat', ${i.user_id})">Putuskan Chat</button></td>
        </tr>`;
      } else {
        const time = new Date(i.queued_at || i.queuedAt).toLocaleString('id-ID');
        const fullName = [i.first_name || i.firstName, i.last_name || i.lastName].filter(Boolean).join(' ') || 'Tanpa Nama';
        const username = i.username ? `<br><small style="color:var(--accent-blue)">@${i.username}</small>` : '';
        const profileInfo = `<div>${fullName}${username}</div>`;
        return `<tr style="animation-delay: ${index * 0.05}s">
          <td><strong>${i.user_id}</strong></td>
          <td>${profileInfo}</td>
          <td>${time}</td>
          <td><button class="action-btn" style="background:var(--accent-rose);color:white" onclick="sessionAction('kick_queue', ${i.user_id})">Keluarkan</button></td>
        </tr>`;
      }
    }).join('');
  } catch (err) {
    console.error('loadSessions error:', err);
  }
}
window.loadSessions = loadSessions;

async function sessionAction(action, userId) {
  const confirmMsg = action === 'stop_chat' ? 'Yakin memaksa menghentikan chat mereka?' : 'Yakin mengeluarkan user ini dari antrean?';
  if (!confirm(confirmMsg)) return;

  try {
    const data = await apiPost('sessions', { action, userId });
    if (data.success) {
      showToast(data.message, 'success');
      const activeFilter = $('.filter-btn[id^="filter-session-"].active');
      loadSessions(activeFilter ? activeFilter.dataset.sessionFilter : 'active');
      loadStats();
    } else {
      showToast(data.error || 'Gagal memproses sesi.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan.', 'error');
  }
}
window.sessionAction = sessionAction;


// ===================== BROADCAST =====================

async function sendBroadcast() {
  const msgInput = $('#broadcast-message');
  const message = msgInput.value.trim();
  if (!message) {
    showToast('Pesan tidak boleh kosong!', 'error');
    return;
  }

  if (!confirm('Peringatan: Pesan ini akan dikirim ke seluruh pengguna yang aktif. Lanjutkan?')) return;

  const btn = $('#send-broadcast-btn');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Mempersiapkan Siaran...';
  btn.disabled = true;

  try {
    const data = await apiPost('broadcast', { message });
    if (data.success) {
      showToast(data.message, 'success');
      msgInput.value = '';
    } else {
      showToast(data.error || 'Gagal mengirim siaran.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan.', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
window.sendBroadcast = sendBroadcast;
