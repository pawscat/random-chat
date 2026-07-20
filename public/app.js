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

    tbody.innerHTML = data.users.map(u => {
      const isBanned = u.is_banned === 1 || u.banned === 1;
      const statusBadge = isBanned
        ? '<span class="badge badge-banned">Banned</span>'
        : '<span class="badge badge-active">Aktif</span>';
      const actionBtn = isBanned
        ? `<button class="action-btn unban-btn" onclick="userAction('unban', ${u.user_id || u.userId})">Unban</button>`
        : `<button class="action-btn ban-btn" onclick="userAction('ban', ${u.user_id || u.userId})">Ban</button>`;
      const lastActive = timeAgo(u.last_active || u.lastActive);
      const fullName = [u.first_name || u.firstName, u.last_name || u.lastName].filter(Boolean).join(' ') || 'Tanpa Nama';
      const username = u.username ? `<br><small style="color:var(--accent-blue)">@${u.username}</small>` : '';
      const profileInfo = `<div>${fullName}${username}</div>`;

      return `<tr>
        <td><strong>${u.user_id || u.userId || '—'}</strong></td>
        <td>${profileInfo}</td>
        <td>${statusBadge}</td>
        <td>${lastActive}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('loadUsers error:', err);
  }
}

async function loadSettings() {
  try {
    // Use cached settings from loadStats, or fetch fresh
    let settings = window._cachedSettings;
    if (!settings) {
      const data = await apiGet('stats');
      if (!data.success) return;
      settings = data.settings;
    }

    $('#setting-main-bot').textContent = settings.mainBot || '—';
    $('#setting-report-bot').textContent = settings.reportBot || '—';
    $('#setting-webhook').textContent = settings.webhookUrl || '—';
    $('#setting-admin-ids').textContent = (settings.adminIds || []).join(', ');
    $('#setting-superadmin-ids').textContent = (settings.superAdminIds || []).join(', ');
    $('#setting-rate-window').textContent = settings.rateLimitWindow || '—';
    $('#setting-rate-max').textContent = settings.rateLimitMax || '—';
    $('#setting-report-length').textContent = settings.maxReportDescLength || '—';
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

// ===================== USER ACTIONS =====================

async function userAction(action, userId) {
  const confirmMsg = action === 'ban'
    ? `Apakah Anda yakin ingin mem-ban user ${userId}?`
    : `Apakah Anda yakin ingin meng-unban user ${userId}?`;

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

  // Load data for specific pages
  if (pageName === 'users') loadUsers();
  if (pageName === 'server') loadStats();
  if (pageName === 'settings') loadSettings();

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
      switchPage(link.dataset.page);
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
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadUsers(btn.dataset.filter);
    });
  });

  // User search
  let searchTimeout;
  $('#user-search').addEventListener('input', (e) => {
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

  // Auto-login from session
  const savedToken = sessionStorage.getItem('dashToken');
  if (savedToken) {
    authToken = savedToken;
    showLoginScreen(false);
    loadDashboard();
  }

  // Auto-refresh every 30 seconds
  setInterval(() => {
    if (authToken && $('#page-overview').classList.contains('active')) {
      loadStats();
    }
  }, 30000);
});
