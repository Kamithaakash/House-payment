/* ============================================================
   BOARDMATES — app.js (Vercel + MongoDB Edition)
   All data operations go through /api/* serverless functions.
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const MEMBER_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#f43f5e', '#06b6d4', '#ec4899', '#84cc16',
  '#ff7849', '#a78bfa'
];

const CATEGORY_ICONS = {
  Groceries:     '🛒',
  Rent:          '🏠',
  Utilities:     '⚡',
  Food:          '🍜',
  Transport:     '🚗',
  Entertainment: '🎮',
  Other:         '📦',
};

const CURRENCY = 'LKR';

// ============================================================
// IN-MEMORY STATE (populated from API on load)
// ============================================================

let state = {
  members:            [],
  expenses:           [],
  settlements:        [],
  partialSettlements: [],  // individual payments recorded this month
  users:              [],  // individual user accounts (admin only)
};

let isLoading = false;

// ============================================================
// API HELPERS
// ============================================================

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('hb_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const bodyContent = typeof options.body === 'string'
    ? options.body
    : (options.body ? JSON.stringify(options.body) : undefined);

  const res = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body: bodyContent,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

const api = {
  // Members
  getMembers:    ()       => apiFetch('/api/members'),
  createMember:  (body)   => apiFetch('/api/members', { method: 'POST', body }),
  deleteMember:  (id)     => apiFetch(`/api/members?id=${id}`, { method: 'DELETE' }),

  // Expenses
  getExpenses:   (month)  => apiFetch(month ? `/api/expenses?month=${month}` : '/api/expenses'),
  createExpense: (body)   => apiFetch('/api/expenses', { method: 'POST', body }),
  updateExpense: (id, body) => apiFetch(`/api/expenses?id=${id}`, { method: 'PUT', body }),
  deleteExpense: (id)     => apiFetch(`/api/expenses?id=${id}`, { method: 'DELETE' }),

  // Full-month settlements (archive)
  getSettlements:   ()     => apiFetch('/api/settlements'),
  createSettlement: (body) => apiFetch('/api/settlements', { method: 'POST', body }),
  deleteSettlement: (id)   => apiFetch(`/api/settlements?id=${id}`, { method: 'DELETE' }),
  clearAllHistory:  ()     => apiFetch('/api/settlements?all=true', { method: 'DELETE' }),

  // Individual partial payments
  getPartialSettlements:    (month) => apiFetch(month ? `/api/partial-settlements?month=${month}` : '/api/partial-settlements'),
  createPartialSettlement:  (body)  => apiFetch('/api/partial-settlements', { method: 'POST', body }),

  // Users (Accounts)
  getUsers:                 ()      => apiFetch('/api/users'),
  createUser:               (body)  => apiFetch('/api/users', { method: 'POST', body }),
  deleteUser:               (id)    => apiFetch(`/api/users?id=${id}`, { method: 'DELETE' }),

  // Admin: Full reset
  resetDatabase: () => apiFetch('/api/settlements?reset=true', { method: 'DELETE', body: { confirmToken: 'RESET_EVERYTHING' } }),
};

// ============================================================
// LOAD ALL DATA
// ============================================================

async function loadAll() {
  setGlobalLoading(true);
  try {
    const [members, expenses, settlements, partialSettlements] = await Promise.all([
      api.getMembers(),
      api.getExpenses(),
      api.getSettlements(),
      api.getPartialSettlements(),
    ]);
    state.members             = members;
    state.expenses            = expenses;
    state.settlements         = settlements;
    state.partialSettlements  = partialSettlements;

    // Load users if admin
    if (localStorage.getItem('hb_user') === 'admin') {
      try {
        state.users = await api.getUsers();
      } catch (err) {
        console.warn('Could not load users:', err);
      }
    }
  } catch (err) {
    console.error('Failed to load data:', err);
    toast('Could not connect to database. Check your connection.', 'error');
  } finally {
    setGlobalLoading(false);
  }
}

function setGlobalLoading(on) {
  isLoading = on;
  document.body.style.cursor = on ? 'wait' : '';
}

// ============================================================
// HELPERS
// ============================================================

function fmt(n) {
  return CURRENCY + ' ' + Math.abs(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Returns ms remaining within the 2-hour edit window (negative = expired)
const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
function editTimeLeft(exp) {
  if (!exp.createdAt) return -1; // no timestamp = treat as expired
  return EDIT_WINDOW_MS - (Date.now() - new Date(exp.createdAt).getTime());
}

function formatTimeLeft(ms) {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function memberById(id) {
  return state.members.find(m => m.id === id);
}

function getAuthUser() {
  const username = localStorage.getItem('hb_user') || '';
  const isAdmin = username.toLowerCase() === 'admin';
  const currentMember = state.members.find(m => m.name.toLowerCase() === username.toLowerCase());
  return { username, isAdmin, currentMemberId: currentMember ? currentMember.id : null };
}

function isExpenseOwner(exp) {
  if (!exp) return false;
  const { isAdmin, currentMemberId, username } = getAuthUser();
  if (isAdmin) return true;
  if (!username) return false;

  const cleanUser = username.toLowerCase();
  if (exp.createdBy) {
    return exp.createdBy.toLowerCase() === cleanUser || (currentMemberId && exp.createdBy === currentMemberId);
  }
  return Boolean(currentMemberId && exp.paidBy === currentMemberId);
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function avatarEl(member, size = 36) {
  const d = document.createElement('div');
  d.className = 'balance-avatar';
  d.style.background = member.color;
  d.style.width = d.style.height = size + 'px';
  d.style.fontSize = (size * 0.35) + 'px';
  d.textContent = initials(member.name);
  return d;
}

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

// ============================================================
// CONFIRM DIALOG
// ============================================================

function showConfirm(title, message) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const overlay = document.getElementById('confirm-modal-overlay');
    overlay.classList.add('open');

    const ok     = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');

    function cleanup(result) {
      overlay.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); }, { once: true });
  });
}

// ============================================================
// LOADING SKELETON
// ============================================================

function skeletonRows(n = 3) {
  return Array.from({ length: n }, () => `
    <div style="height:64px;border-radius:12px;background:linear-gradient(90deg,var(--surface) 25%,var(--surface-hover) 50%,var(--surface) 75%);
    background-size:200% 100%;animation:shimmer 1.4s infinite;margin-bottom:12px;"></div>
  `).join('');
}

// Add shimmer keyframes once
const shimmerStyle = document.createElement('style');
shimmerStyle.textContent = `@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`;
document.head.appendChild(shimmerStyle);

// ============================================================
// BALANCE CALCULATION
// ============================================================

function computeBalances(month = null) {
  const bal = {};
  state.members.forEach(m => bal[m.id] = 0);

  // Factor in all shared expenses
  state.expenses.forEach(exp => {
    if (month && exp.month !== month) return;
    const split = exp.splitAmong;
    if (!split || split.length === 0) return;
    const share = exp.amount / split.length;
    if (bal[exp.paidBy] !== undefined) bal[exp.paidBy] += exp.amount;
    split.forEach(id => {
      if (bal[id] !== undefined) bal[id] -= share;
    });
  });

  // Factor in individual payments already made:
  // When "from" pays "to", from's debt decreases and to's credit decreases
  state.partialSettlements.forEach(ps => {
    if (month && ps.month !== month) return;
    if (bal[ps.from] !== undefined) bal[ps.from] += ps.amount;  // payer's balance improves
    if (bal[ps.to]   !== undefined) bal[ps.to]   -= ps.amount;  // receiver's outstanding credit reduces
  });

  return bal;
}

function computeSettlement(month = null) {
  const debts = {};
  state.members.forEach(m => {
    debts[m.id] = {};
    state.members.forEach(m2 => {
      debts[m.id][m2.id] = 0;
    });
  });

  // Calculate debts from shared expenses
  state.expenses.forEach(exp => {
    if (month && exp.month !== month) return;
    const payer = exp.paidBy;
    const split = exp.splitAmong;
    if (!split || split.length === 0) return;
    const share = exp.amount / split.length;
    split.forEach(id => {
      if (id !== payer && debts[id] !== undefined && debts[id][payer] !== undefined) {
        debts[id][payer] += share;
      }
    });
  });

  // Subtract paid settlements — clamp to 0 to prevent negative debts from overpayments
  state.partialSettlements.forEach(ps => {
    if (month && ps.month !== month) return;
    if (debts[ps.from] !== undefined && debts[ps.from][ps.to] !== undefined) {
      debts[ps.from][ps.to] = Math.max(0, debts[ps.from][ps.to] - ps.amount);
    }
  });

  const txs = [];
  const memberIds = state.members.map(m => m.id);

  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const u1 = memberIds[i];
      const u2 = memberIds[j];

      const u1_owes_u2 = debts[u1]?.[u2] || 0;
      const u2_owes_u1 = debts[u2]?.[u1] || 0;

      const net = u1_owes_u2 - u2_owes_u1;
      if (net > 0.01) {
        txs.push({ from: u1, to: u2, amount: Math.round(net * 100) / 100 });
      } else if (net < -0.01) {
        txs.push({ from: u2, to: u1, amount: Math.round(Math.abs(net) * 100) / 100 });
      }
    }
  }

  return txs;
}

// ============================================================
// PAYMENT DETAIL BREAKDOWN
// ============================================================

/**
 * Compute the full transparent debt breakdown between `fromId` and `toId`.
 * Shows total expenses paid by toId, offsets/payments made by fromId,
 * and the exact net remaining to pay.
 */
function computeDebtBreakdown(fromId, toId, month) {
  // Expenses where toId paid and fromId was in the split → fromId owes toId
  const owedToTarget = state.expenses
    .filter(e => e.month === month && e.paidBy === toId && e.splitAmong.includes(fromId))
    .map(e => ({ ...e, myShare: Math.round((e.amount / e.splitAmong.length) * 100) / 100 }));

  // Expenses where fromId paid and toId was in the split → offsets debt
  const owedByTarget = state.expenses
    .filter(e => e.month === month && e.paidBy === fromId && e.splitAmong.includes(toId))
    .map(e => ({ ...e, myShare: Math.round((e.amount / e.splitAmong.length) * 100) / 100 }));

  const totalOwed   = owedToTarget.reduce((s, e) => s + e.myShare, 0);
  const totalOffset = owedByTarget.reduce((s, e) => s + e.myShare, 0);

  // Partial cash payments made by fromId to toId
  const paymentsFrom = state.partialSettlements
    .filter(ps => ps.month === month && ps.from === fromId && ps.to === toId)
    .reduce((s, ps) => s + ps.amount, 0);

  // Partial cash payments made by toId to fromId
  const paymentsTo = state.partialSettlements
    .filter(ps => ps.month === month && ps.from === toId && ps.to === fromId)
    .reduce((s, ps) => s + ps.amount, 0);

  const totalDeductions = totalOffset + paymentsFrom - paymentsTo;
  const netRemaining    = Math.max(0, Math.round((totalOwed - totalDeductions) * 100) / 100);

  return {
    owedToTarget,
    owedByTarget,
    totalOwed: Math.round(totalOwed * 100) / 100,
    totalOffset: Math.round(totalOffset * 100) / 100,
    paymentsFrom: Math.round(paymentsFrom * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netRemaining
  };
}

/**
 * Open the Payment Detail bottom-sheet/modal showing the complete breakdown.
 */
function openPaymentDetailModal(fromId, toId, amount, month) {
  const from = memberById(fromId);
  const to   = memberById(toId);
  if (!from || !to) return;

  const bd = computeDebtBreakdown(fromId, toId, month);

  // Use the passed-in amount from Settle Up tab if available to ensure 100% exact sync
  const netToPay = amount > 0 ? amount : bd.netRemaining;
  const isSettled = netToPay < 0.01;

  // ── Header: avatars + names ───────────────────────────────
  document.getElementById('pd-avatars').innerHTML = `
    <div class="balance-avatar" style="background:${from.color}">${initials(from.name)}</div>
    <div class="balance-avatar" style="background:${to.color}">${initials(to.name)}</div>
  `;
  document.getElementById('pd-subtitle').textContent =
    `${from.name}  →  ${to.name}  ·  ${formatMonthLabel(month)}`;

  // ── Summary strip: 3 compact stat cards ─────────────────────
  document.getElementById('pd-summary-strip').innerHTML = `
    <div class="pd-stat">
      <div class="pd-stat-label">Total Spent</div>
      <div class="pd-stat-value gold">${fmt(bd.totalOwed)}</div>
    </div>
    <div class="pd-stat">
      <div class="pd-stat-label">Offsets / Paid</div>
      <div class="pd-stat-value positive">${bd.totalDeductions > 0 ? '−' + fmt(bd.totalDeductions) : '—'}</div>
    </div>
    <div class="pd-stat pd-stat-net ${isSettled ? 'settled' : ''}">
      <div class="pd-stat-label">${isSettled ? 'Status' : 'Net To Pay'}</div>
      <div class="pd-stat-value ${isSettled ? 'positive' : 'amber'}">${isSettled ? '✓ Settled' : fmt(netToPay)}</div>
    </div>
  `;

  // ── Body ──────────────────────────────────────────────────
  const body = document.getElementById('pay-detail-body');
  body.innerHTML = '';

  const makeExpenseRow = (e, dir) => {
    const row = document.createElement('div');
    row.className = 'pd-expense-row';
    const splitLabel = e.splitAmong.length === 1
      ? 'only you'
      : `split ${e.splitAmong.length} ways`;
    const dateStr = new Date(e.date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short'
    });

    row.innerHTML = `
      <div class="pd-exp-icon">${CATEGORY_ICONS[e.category] || '📦'}</div>
      <div class="pd-exp-info">
        <div class="pd-exp-desc">${e.description}</div>
        <div class="pd-exp-meta">${dateStr} · ${splitLabel} · total ${fmt(e.amount)}</div>
      </div>
      <div class="pd-exp-amount ${dir}">${dir === 'owe' ? '−' : '+'}${fmt(e.myShare)}</div>
    `;
    return row;
  };

  // Section 1 — Expenses paid by "to"
  if (bd.owedToTarget.length > 0) {
    const h1 = document.createElement('p');
    h1.className = 'pd-section-title';
    h1.textContent = `Expenses Paid by ${to.name} (${from.name}'s share)`;
    body.appendChild(h1);
    bd.owedToTarget
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach(e => body.appendChild(makeExpenseRow(e, 'owe')));
  }

  // Section 2 — Deductions: Offsets paid by "from" or cash payments
  if (bd.owedByTarget.length > 0 || bd.paymentsFrom > 0) {
    const h2 = document.createElement('p');
    h2.className = 'pd-section-title';
    h2.textContent = `Deductions & Offsets (Paid by ${from.name})`;
    body.appendChild(h2);

    // Offsets
    bd.owedByTarget
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach(e => body.appendChild(makeExpenseRow(e, 'offset')));

    // Cash payments
    if (bd.paymentsFrom > 0) {
      const paidRow = document.createElement('div');
      paidRow.className = 'pd-already-paid';
      paidRow.innerHTML = `
        <span class="label">✓ Partial cash payment made</span>
        <span class="value">+${fmt(bd.paymentsFrom)}</span>
      `;
      body.appendChild(paidRow);
    }
  }

  // ── Footer ────────────────────────────────────────────────
  const footer = document.getElementById('pay-detail-footer');
  footer.innerHTML = '';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost pd-close-btn';
  cancelBtn.textContent = 'Close';
  cancelBtn.addEventListener('click', closePaymentDetailModal);
  footer.appendChild(cancelBtn);

  if (!isSettled) {
    const markPaidBtn = document.createElement('button');
    markPaidBtn.className = 'btn btn-primary pd-mark-btn';
    markPaidBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;flex-shrink:0">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Mark Paid · ${fmt(netToPay)}
    `;
    markPaidBtn.addEventListener('click', () => {
      closePaymentDetailModal();
      markAsPaid(fromId, toId, netToPay, month);
    });
    footer.appendChild(markPaidBtn);
  }

  document.getElementById('pay-detail-overlay').classList.add('open');
}

function closePaymentDetailModal() {
  document.getElementById('pay-detail-overlay').classList.remove('open');
}




// ============================================================
// TAB ROUTING
// ============================================================


let activeTab = 'dashboard';

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
  document.querySelectorAll('.tab-panel').forEach(panel =>
    panel.classList.toggle('active', panel.id === `panel-${tab}`)
  );
  renderTab(tab);
}

function renderTab(tab) {
  switch (tab) {
    case 'dashboard': renderDashboard(); break;
    case 'expenses':  renderExpenses();  break;
    case 'members':   renderMembers();   break;
    case 'settle':    renderSettle();    break;
    case 'cleaning':  renderCleaning();  break;
    case 'accounts':  renderAccounts();  break;
  }
}

// ============================================================
// RENDER: DASHBOARD
// ============================================================

function renderDashboard() {
  const month        = currentMonth();
  const monthExpenses = state.expenses.filter(e => e.month === month);
  const balances     = computeBalances(month);
  const { isAdmin, currentMemberId } = getAuthUser();

  // Summary cards
  const cards = document.getElementById('summary-cards');
  cards.innerHTML = '';

  const mkCard = (label, value, sub, colorClass = '') => {
    const d = document.createElement('div');
    d.className = `summary-card ${colorClass}`;
    d.innerHTML = `
      <div class="sc-label">${label}</div>
      <div class="sc-value">${value}</div>
      ${sub ? `<div class="sc-sub">${sub}</div>` : ''}
    `;
    return d;
  };

  if (isAdmin) {
    const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
    const totalOwed = Object.values(balances).filter(v => v > 0.01).reduce((s, v) => s + v, 0);
    const totalOwes = Object.values(balances).filter(v => v < -0.01).reduce((s, v) => s + Math.abs(v), 0);

    cards.appendChild(mkCard('Total Spent',       fmt(totalSpent), `${monthExpenses.length} expenses this month`, ''));
    cards.appendChild(mkCard('Members',           state.members.length, 'active housemates', 'blue'));
    cards.appendChild(mkCard('To Be Collected',   fmt(totalOwed),  'across all members', ''));
    cards.appendChild(mkCard('To Be Paid Out',    fmt(totalOwes),  'across all members', 'amber'));
  } else {
    const myPaidTotal = monthExpenses.filter(e => e.paidBy === currentMemberId).reduce((s, e) => s + e.amount, 0);
    const myShareTotal = monthExpenses.filter(e => e.splitAmong.includes(currentMemberId)).reduce((s, e) => s + e.amount / e.splitAmong.length, 0);
    const myBalance = balances[currentMemberId] ?? 0;
    const myOwed = myBalance > 0.01 ? myBalance : 0;
    const myOwes = myBalance < -0.01 ? Math.abs(myBalance) : 0;

    cards.appendChild(mkCard('My Total Spent',       fmt(myPaidTotal), `paid by you this month`, ''));
    cards.appendChild(mkCard('My Calculated Share',  fmt(myShareTotal), `your share of expenses`, 'blue'));
    cards.appendChild(mkCard('My Net Receivables',   fmt(myOwed),  `owed to you`, ''));
    cards.appendChild(mkCard('My Net Payables',      fmt(myOwes),  `you owe to others`, 'amber'));
  }

  // Balance overview
  const balList = document.getElementById('balance-overview-list');
  balList.innerHTML = '';

  if (state.members.length === 0) {
    balList.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h3>No members yet</h3><p>Go to Members tab to add friends</p></div>';
  } else {
    state.members.forEach(m => {
      // Non-admins only see their own balance
      if (!isAdmin && m.id !== currentMemberId) return;

      const b    = balances[m.id] ?? 0;
      const cls  = b > 0.01 ? 'positive' : b < -0.01 ? 'negative' : 'zero';
      const item = document.createElement('div');
      item.className = 'balance-item';
      item.appendChild(avatarEl(m, 36));
      item.insertAdjacentHTML('beforeend', `
        <span class="balance-name">${m.name}${m.id === currentMemberId ? ' (You)' : ''}</span>
        <span class="balance-amount ${cls}">${b > 0.01 ? '+' : ''}${fmt(b)}</span>
      `);
      balList.appendChild(item);
    });
  }

  // Recent expenses (last 5)
  const recentList = document.getElementById('recent-expenses-list');
  recentList.innerHTML = '';

  let recentExpenses = [...state.expenses];
  if (!isAdmin) {
    recentExpenses = recentExpenses.filter(e => e.paidBy === currentMemberId || e.splitAmong.includes(currentMemberId));
  }
  const recent = recentExpenses
    .sort((a, b) => {
      const diff = new Date(b.date) - new Date(a.date);
      if (diff !== 0) return diff;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })
    .slice(0, 5);

  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No expenses yet</h3><p>Tap + to add your first expense</p></div>';
  } else {
    recent.forEach(e => recentList.appendChild(buildExpenseEl(e, true)));
  }

  document.getElementById('month-badge').textContent = formatMonthLabel(month);
}

// ============================================================
// RENDER: EXPENSES
// ============================================================

let expenseFilters = { member: '', category: '', month: currentMonth() };

function renderExpenses() {
  // Populate member filter
  const mf = document.getElementById('filter-member');
  const prevMember = mf.value;
  mf.innerHTML = '<option value="">All Members</option>';
  state.members.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.name;
    if (m.id === expenseFilters.member) o.selected = true;
    mf.appendChild(o);
  });

  document.getElementById('filter-category').value = expenseFilters.category;
  document.getElementById('filter-month').value    = expenseFilters.month;

  const list = document.getElementById('expenses-list');
  list.innerHTML = '';

  const { isAdmin, currentMemberId } = getAuthUser();
  let filtered = [...state.expenses];
  if (!isAdmin) {
    filtered = filtered.filter(e => e.paidBy === currentMemberId || e.splitAmong.includes(currentMemberId));
  }
  if (expenseFilters.member)   filtered = filtered.filter(e => e.paidBy === expenseFilters.member || e.splitAmong.includes(expenseFilters.member));
  if (expenseFilters.category) filtered = filtered.filter(e => e.category === expenseFilters.category);
  if (expenseFilters.month)    filtered = filtered.filter(e => e.month === expenseFilters.month);
  filtered.sort((a, b) => {
    const diff = new Date(b.date) - new Date(a.date);
    if (diff !== 0) return diff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>No expenses found</h3><p>Adjust filters or add a new expense</p></div>';
    return;
  }
  filtered.forEach(e => list.appendChild(buildExpenseEl(e, false)));
}

function buildExpenseEl(exp, compact = false) {
  const payer      = memberById(exp.paidBy);
  const item       = document.createElement('div');
  item.dataset.expId = exp.id;

  if (compact) {
    item.className = 'expense-item expense-item-compact';
    item.innerHTML = `
      <div class="expense-cat-icon" style="width:30px;height:30px;font-size:0.82rem;border-radius:8px;flex-shrink:0">${CATEGORY_ICONS[exp.category] || '📦'}</div>
      <div class="expense-main" style="flex:1;min-width:0">
        <div class="expense-desc" style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${exp.description}</div>
        <div class="expense-meta" style="font-size:0.68rem;color:var(--text-muted);margin-top:1px">
          <span style="color:${payer?.color || '#aaa'};font-weight:600;">${payer?.name || 'Unknown'}</span> · ${new Date(exp.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </div>
      </div>
      <div class="expense-amount" style="font-size:0.85rem;font-weight:700;flex-shrink:0">${fmt(exp.amount)}</div>
    `;
    return item;
  }

  item.className = 'expense-item';

  let splitDisplay = '';
  if (exp.splitAmong.length === state.members.length && state.members.length > 1) {
    splitDisplay = 'everyone';
  } else if (exp.splitAmong.length > 2) {
    const firstTwo = exp.splitAmong.slice(0, 2).map(id => memberById(id)?.name || '?').join(', ');
    splitDisplay = `${firstTwo} +${exp.splitAmong.length - 2}`;
  } else {
    splitDisplay = exp.splitAmong.map(id => memberById(id)?.name || '?').join(', ');
  }

  const isOwner   = isExpenseOwner(exp);
  const msLeft    = editTimeLeft(exp);
  const canEdit   = isOwner && msLeft > 0;
  const timeLabel = formatTimeLeft(msLeft);

  // Time badge shown in the meta line
  let timeBadgeHtml = '';
  if (!compact && isOwner) {
    if (canEdit && timeLabel) {
      timeBadgeHtml = `<span class="edit-timer-badge" title="Edit available for ${timeLabel}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg>
        ${timeLabel}
      </span>`;
    } else if (!canEdit && msLeft <= 0) {
      timeBadgeHtml = `<span class="edit-locked-badge" title="Edit window expired after 2 hours">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Locked
      </span>`;
    }
  }

  item.innerHTML = `
    <div class="expense-cat-icon">${CATEGORY_ICONS[exp.category] || '📦'}</div>
    <div class="expense-main">
      <div class="expense-desc">${exp.description}</div>
      <div class="expense-meta">
        <span style="color:${payer?.color || '#aaa'};font-weight:600;">${payer?.name || 'Unknown'}</span>
        paid · split with ${splitDisplay}
        · <span class="cat-badge">${exp.category}</span>
        · ${new Date(exp.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        ${timeBadgeHtml}
      </div>
    </div>
    <div class="expense-right">
      <div class="expense-amount">${fmt(exp.amount)}</div>
      ${!compact && isOwner ? `
      <div class="expense-actions">
        ${canEdit ? `
          <button class="btn-icon" data-edit="${exp.id}" title="Edit expense (${timeLabel})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon" data-delete="${exp.id}" title="Delete expense" style="color:var(--red);border-color:rgba(248,113,113,0.3)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
          </button>
        ` : `
          <span class="expense-locked-msg" title="Edit & delete locked after 2 hours">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </span>
        `}
      </div>` : ''}
    </div>
  `;

  if (!compact && canEdit) {
    item.querySelector(`[data-edit="${exp.id}"]`)?.addEventListener('click', () => openExpenseModal(exp.id));
    item.querySelector(`[data-delete="${exp.id}"]`)?.addEventListener('click', () => deleteExpense(exp.id));
  }
  return item;
}


// ============================================================
// RENDER: MEMBERS
// ============================================================

function renderMembers() {
  const grid = document.getElementById('members-grid');
  grid.innerHTML = '';

  if (state.members.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h3>No members yet</h3><p>Add your first housemate!</p></div>';
    return;
  }

  const month        = currentMonth();
  const monthExpenses = state.expenses.filter(e => e.month === month);
  const totalPaidAll = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const { isAdmin, currentMemberId } = getAuthUser();
  const balances     = computeBalances(month);

  // Calculate paid amounts for all members to find the top contributor
  let maxPaid = 0;
  state.members.forEach(m => {
    const paid = monthExpenses.filter(e => e.paidBy === m.id).reduce((s, e) => s + e.amount, 0);
    if (paid > maxPaid) maxPaid = paid;
  });

  state.members.forEach(m => {
    const paid     = monthExpenses.filter(e => e.paidBy === m.id).reduce((s, e) => s + e.amount, 0);
    // ownShare = this member's personal portion of all expenses they are split into
    const ownShare = monthExpenses
      .filter(e => e.splitAmong.includes(m.id))
      .reduce((s, e) => s + e.amount / e.splitAmong.length, 0);
    const pct   = totalPaidAll > 0 ? (paid / totalPaidAll * 100) : 0;
    const isTop = maxPaid > 0 && paid === maxPaid;
    const isMe  = m.id === currentMemberId;
    const net   = balances[m.id] ?? 0; // positive = others owe this member; negative = this member owes others

    // Shared colour/label helpers for net balance
    const netLabel = net > 0.01 ? '🟢 To Collect' : net < -0.01 ? '🔴 To Pay' : 'Status';
    const netColor = net > 0.01 ? 'var(--emerald)' : net < -0.01 ? 'var(--gold-light)' : 'var(--text-dim)';
    const netVal   = net > 0.01 ? `+${fmt(net)}` : net < -0.01 ? `-${fmt(Math.abs(net))}` : '✅ Settled';

    // Shared 2-box stat layout for all members (keeping cards compact and consistent)
    const statsHtml = `
      <div class="stat-box">
        <div class="stat-box-label">Paid Out</div>
        <div class="stat-box-value stat-paid">${fmt(paid)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-label">${netLabel}</div>
        <div class="stat-box-value" style="color:${netColor}">${netVal}</div>
      </div>
    `;

    const card = document.createElement('div');
    card.className = 'member-card';
    card.style.borderTop = `3px solid ${m.color}`;

    card.innerHTML = `
      <div class="member-header">
        <div class="member-avatar" style="background:${m.color}">${initials(m.name)}</div>
        <div>
          <div class="member-name">${m.name}${isMe ? ' <span style="font-size:0.75rem;color:var(--text-muted);font-weight:400">(You)</span>' : ''}</div>
          <div class="member-role" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            Housemate
            ${isMe ? `· <span style="color:var(--text-muted)">Share: ${fmt(ownShare)}</span>` : ''}
            ${isTop ? `<span class="top-contributor-badge">👑 Top Contributor</span>` : ''}
          </div>
        </div>
      </div>
      <div class="member-stats" style="grid-template-columns: 1fr 1fr;">
        ${statsHtml}
      </div>
      <div class="member-progress">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-dim);margin-bottom:5px">
          <span>Contribution Share</span><span>${pct.toFixed(1)}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    `;

    if (isAdmin) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon member-del-btn';
      delBtn.title = 'Remove member';
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
      delBtn.style.cssText = 'border-color:rgba(244,63,94,0.3);position:absolute;top:12px;right:12px;';
      delBtn.addEventListener('click', () => deleteMember(m.id));
      card.appendChild(delBtn);
    }

    grid.appendChild(card);
  });
}

// ============================================================
// RENDER: SETTLE UP
// ============================================================

function renderSettle() {
  const month    = currentMonth();
  const balances = computeBalances(month);
  const txs      = computeSettlement(month);
  const { isAdmin, currentMemberId } = getAuthUser();

  // Paid transactions this month — newest first
  let paidThisMonth = state.partialSettlements.filter(ps => ps.month === month);
  if (!isAdmin) {
    paidThisMonth = paidThisMonth.filter(ps => ps.from === currentMemberId || ps.to === currentMemberId);
  }
  paidThisMonth.sort((a, b) => new Date(b.paidAt || b.createdAt || 0) - new Date(a.paidAt || a.createdAt || 0));

  const list    = document.getElementById('settle-transactions');
  const actions = document.getElementById('settle-actions');
  list.innerHTML = actions.innerHTML = '';

  // Filter pending for non-admins
  const displayTxs = isAdmin ? txs : txs.filter(tx => tx.from === currentMemberId || tx.to === currentMemberId);

  // ── Nothing at all ─────────────────────────────────────────────
  if (displayTxs.length === 0 && paidThisMonth.length === 0) {
    const settled = document.createElement('div');
    settled.className = 'all-settled-msg';
    settled.innerHTML = `
      <div class="settled-icon">🎉</div>
      <h3>All Settled!</h3>
      <p>No outstanding balances for ${formatMonthLabel(month)}.</p>
    `;
    list.appendChild(settled);
    if (isAdmin) {
      const monthExp = state.expenses.filter(e => e.month === month);
      if (monthExp.length > 0) {
        const archBtn = document.createElement('button');
        archBtn.className = 'btn btn-primary';
        archBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg> Archive This Month`;
        archBtn.addEventListener('click', archiveMonth);
        actions.appendChild(archBtn);
      }
    }
    return;
  }

  // ── SECTION 1: Pending (TOP — most actionable) ─────────────────
  if (displayTxs.length > 0) {
    const pendingHeader = document.createElement('div');
    pendingHeader.className = 'paid-section-header';
    pendingHeader.innerHTML = `<span>⏳ Pending Payments</span>`;
    list.appendChild(pendingHeader);

    displayTxs.forEach(tx => {
      const from = memberById(tx.from);
      const to   = memberById(tx.to);
      if (!from || !to) return;

      const item = document.createElement('div');
      item.className = 'settle-item';
      item.innerHTML = `
        <div class="settle-avatars">
          <div class="balance-avatar si-av" style="background:${from.color}">${initials(from.name)}</div>
          <div class="balance-avatar si-av si-av-2" style="background:${to.color}">${initials(to.name)}</div>
        </div>
        <div class="settle-arrow">
          <span class="si-from">${from.name}</span>
          <svg class="si-arrow-svg" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          <span class="si-to">${to.name}</span>
        </div>
        <div class="settle-amount">${fmt(tx.amount)}</div>
        <button class="settle-info-btn" data-from="${tx.from}" data-to="${tx.to}" data-amount="${tx.amount}" title="View breakdown">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </button>
        <button class="mark-paid-btn" data-from="${tx.from}" data-to="${tx.to}" data-amount="${tx.amount}" title="Mark as Paid">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="mpb-label">Mark Paid</span>
        </button>
      `;

      item.querySelector('.settle-info-btn').addEventListener('click', e => {
        const btn = e.currentTarget;
        openPaymentDetailModal(btn.dataset.from, btn.dataset.to, parseFloat(btn.dataset.amount), month);
      });

      item.querySelector('.mark-paid-btn').addEventListener('click', e => {
        const btn = e.currentTarget;
        markAsPaid(btn.dataset.from, btn.dataset.to, parseFloat(btn.dataset.amount), month);
      });

      list.appendChild(item);
    });

  } else {
    // No pending — show settled banner above the paid list
    const settled = document.createElement('div');
    settled.className = 'all-settled-msg';
    settled.innerHTML = `
      <div class="settled-icon">🎉</div>
      <h3>All Settled!</h3>
      <p>No outstanding balances for ${formatMonthLabel(month)}.</p>
    `;
    list.appendChild(settled);
    if (isAdmin) {
      const monthExp = state.expenses.filter(e => e.month === month);
      if (monthExp.length > 0) {
        const archBtn = document.createElement('button');
        archBtn.className = 'btn btn-primary';
        archBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg> Archive This Month`;
        archBtn.addEventListener('click', archiveMonth);
        actions.appendChild(archBtn);
      }
    }
  }

  // ── SECTION 2: Already Paid (BELOW — dimmed, newest first) ─────
  if (paidThisMonth.length > 0) {
    const paidHeader = document.createElement('div');
    paidHeader.className = 'paid-section-header paid-section-header--below';
    paidHeader.innerHTML = `<span>✅ Already Paid (Undo within 30m)</span>`;
    list.appendChild(paidHeader);

    paidThisMonth.forEach(ps => {
      const from = memberById(ps.from);
      const to   = memberById(ps.to);
      if (!from || !to) return;

      const createdTime = new Date(ps.createdAt || ps.paidAt).getTime();
      const nowTime = new Date().getTime();
      const elapsedMins = (nowTime - createdTime) / (1000 * 60);
      const canUndo = elapsedMins <= 30;
      const minsLeft = Math.max(1, Math.ceil(30 - elapsedMins));

      const item = document.createElement('div');
      item.className = 'settle-item settle-item-paid';
      item.innerHTML = `
        <div class="settle-avatars">
          <div class="balance-avatar si-av" style="background:${from.color};opacity:0.6">${initials(from.name)}</div>
          <div class="balance-avatar si-av si-av-2" style="background:${to.color};opacity:0.6">${initials(to.name)}</div>
        </div>
        <div class="settle-arrow">
          <span class="si-from">${from.name}</span>
          <svg class="si-arrow-svg" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          <span class="si-to">${to.name}</span>
        </div>
        <div class="settle-amount" style="color:var(--emerald)">${fmt(ps.amount)}</div>
        ${canUndo ? `<button class="btn-undo-settlement" data-id="${ps.id}">↩️ Undo (${minsLeft}m left)</button>` : '<span class="paid-badge">✓ Paid</span>'}
        <div class="si-date">${new Date(ps.paidAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
      `;

      if (canUndo) {
        const undoBtn = item.querySelector('.btn-undo-settlement');
        if (undoBtn) {
          undoBtn.addEventListener('click', () => undoPartialSettlement(ps.id));
        }
      }

      list.appendChild(item);
    });
  }

  // Archive button only when admin and pending txs remain
  if (isAdmin && displayTxs.length > 0) {
    const archBtn = document.createElement('button');
    archBtn.className = 'btn btn-ghost';
    archBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg> Archive Whole Month`;
    archBtn.addEventListener('click', archiveMonth);
    actions.appendChild(archBtn);
  }
}

async function undoPartialSettlement(id) {
  const ok = await showConfirm(
    'Undo Settlement',
    'Are you sure you want to undo this payment settlement?'
  );
  if (!ok) return;

  try {
    const res = await fetch(`/api/partial-settlements?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('house_tracker_auth_token')}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to undo settlement');

    toast('↩️ Settlement undone!');
    await loadAll();
    renderSettle();
    if (activeTab === 'dashboard') renderDashboard();
  } catch (err) {
    toast(err.message || 'Undo failed', 'error');
  }
}



// ============================================================
// MARK AS PAID (individual settlement)
// ============================================================

async function markAsPaid(fromId, toId, amount, month) {
  const from = memberById(fromId);
  const to   = memberById(toId);
  if (!from || !to) return;

  const ok = await showConfirm(
    'Confirm Payment',
    `Confirm that ${from.name} has paid ${fmt(amount)} to ${to.name}?`
  );
  if (!ok) return;

  try {
    await api.createPartialSettlement({
      month,
      from:   fromId,
      to:     toId,
      amount,
      paidAt: new Date().toISOString(),
    });
    await loadAll();
    toast(`✅ ${from.name} → ${to.name} payment recorded!`);
    // Re-render both settle tab (balances updated) and dashboard
    renderSettle();
    if (activeTab === 'dashboard') renderDashboard();
  } catch (err) {
    toast(err.message || 'Failed to record payment', 'error');
  }
}

// ============================================================
// RENDER: HISTORY
// ============================================================

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';

  const { isAdmin, currentMemberId } = getAuthUser();

  if (state.settlements.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><h3>No settlement history yet</h3><p>Archive a month from the Settle Up tab</p></div>';
    return;
  }

  // Sort most recent first
  const sorted = [...state.settlements].sort((a, b) => {
    const diff = new Date(b.settledAt || b.createdAt || 0) - new Date(a.settledAt || a.createdAt || 0);
    if (diff !== 0) return diff;
    return b.month.localeCompare(a.month);
  });
  let renderedCards = 0;

  sorted.forEach(s => {
    const displayTxs = isAdmin ? s.transactions : s.transactions.filter(tx => tx.from === currentMemberId || tx.to === currentMemberId);

    // Hide month card for non-admin if there were transactions but they were not involved in any
    if (!isAdmin && s.transactions.length > 0 && displayTxs.length === 0) {
      return;
    }

    renderedCards++;
    const card = document.createElement('div');
    card.className = 'history-card glass';

    const txHtml = displayTxs.length === 0
      ? '<div class="history-tx" style="color:var(--emerald-light)">✅ Everyone was already settled</div>'
      : displayTxs.map(tx => {
          const from      = memberById(tx.from);
          const to        = memberById(tx.to);
          const fromName  = from?.name  || tx.fromName || tx.from;
          const toName    = to?.name    || tx.toName   || tx.to;
          const fromColor = from?.color || '#888';
          const toColor   = to?.color   || '#888';
          return `<div class="history-tx">
            <div class="balance-avatar" style="background:${fromColor};width:22px;height:22px;font-size:0.55rem;">${initials(fromName)}</div>
            <strong>${fromName}</strong>
            <span style="color:var(--emerald)">→</span>
            <div class="balance-avatar" style="background:${toColor};width:22px;height:22px;font-size:0.55rem;">${initials(toName)}</div>
            <strong>${toName}</strong>
            <span style="margin-left:auto;color:var(--emerald-light);font-weight:700">${fmt(tx.amount)}</span>
          </div>`;
        }).join('');

    // Admin gets a delete button per card
    const deleteBtn = isAdmin ? `
      <button class="history-delete-btn" data-settlement-id="${s.id}" title="Delete this history record">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
        Delete
      </button>` : '';

    card.innerHTML = `
      <div class="history-card-header">
        <div class="history-month">📅 ${formatMonthLabel(s.month)}</div>
        ${deleteBtn}
      </div>
      <div class="history-tx-list">${txHtml}</div>
      <div class="history-settled-at">Settled on ${new Date(s.settledAt).toLocaleString()}</div>
    `;

    if (isAdmin) {
      card.querySelector('.history-delete-btn')?.addEventListener('click', () => deleteSettlementRecord(s.id, s.month));
    }

    list.appendChild(card);
  });

  if (renderedCards === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><h3>No settlement history yet</h3><p>Settlements involving you will appear here once archived</p></div>';
  }

  // Admin: show Clear All History button below the list
  if (isAdmin && renderedCards > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-danger-outline history-clear-all-btn';
    clearBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
      </svg>
      Clear All History
    `;
    clearBtn.addEventListener('click', clearAllHistory);
    list.appendChild(clearBtn);
  }
}

// ============================================================
// DELETE HISTORY RECORD (admin only)
// ============================================================

async function deleteSettlementRecord(id, month) {
  const ok = await showConfirm(
    'Delete History Record',
    `Remove the archived settlement for ${formatMonthLabel(month)}? This cannot be undone.`
  );
  if (!ok) return;
  try {
    await api.deleteSettlement(id);
    state.settlements = state.settlements.filter(s => s.id !== id);
    toast(`History for ${formatMonthLabel(month)} deleted.`);
    renderHistory();
  } catch (err) {
    toast(err.message || 'Failed to delete history record', 'error');
  }
}

async function clearAllHistory() {
  const ok = await showConfirm(
    '🗑️ Clear All History',
    'This will permanently delete ALL archived settlement records. The data cannot be recovered. Continue?'
  );
  if (!ok) return;
  try {
    await api.clearAllHistory();
    state.settlements = [];
    toast('All settlement history cleared.');
    renderHistory();
  } catch (err) {
    toast(err.message || 'Failed to clear history', 'error');
  }
}

// ============================================================
// ARCHIVE MONTH (API)
// ============================================================

async function archiveMonth() {
  const month    = currentMonth();
  const balances = computeBalances(month);
  const txs      = computeSettlement(month);
  const monthExp = state.expenses.filter(e => e.month === month);

  if (monthExp.length === 0) { toast('No expenses to archive', 'error'); return; }

  const ok = await showConfirm(
    'Archive Month',
    `This will archive ${formatMonthLabel(month)} and record ${txs.length} settlement transaction(s). Continue?`
  );
  if (!ok) return;

  try {
    // Embed member names so history survives future member deletions
    const txsWithNames = txs.map(tx => ({
      ...tx,
      fromName: memberById(tx.from)?.name || tx.from,
      toName:   memberById(tx.to)?.name   || tx.to,
    }));
    const record = await api.createSettlement({
      month,
      transactions: txsWithNames,
      settledAt: new Date().toISOString(),
    });

    // Update local state
    const idx = state.settlements.findIndex(s => s.month === month);
    if (idx >= 0) state.settlements[idx] = record;
    else          state.settlements.push(record);

    toast('Month archived successfully! 🎉');
    renderSettle();
  } catch (err) {
    toast(err.message || 'Failed to archive', 'error');
  }
}

// ============================================================
// EXPENSE MODAL
// ============================================================

function openExpenseModal(editId = null) {
  const overlay = document.getElementById('expense-modal-overlay');
  const title   = document.getElementById('expense-modal-title');
  const idInput = document.getElementById('expense-id');

  // Populate payer dropdown
  const payer = document.getElementById('exp-payer');
  payer.innerHTML = state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

  // Populate split checkboxes
  const splitBox = document.getElementById('split-checkboxes');
  splitBox.innerHTML = '';
  state.members.forEach(m => {
    if (m.name.toLowerCase() === 'admin') return; // Admin has nothing to pay
    const chip = document.createElement('label');
    chip.className = 'check-chip selected';
    chip.innerHTML = `
      <input type="checkbox" value="${m.id}" checked />
      <span class="chip-dot" style="background:${m.color}"></span>
      ${m.name}
    `;
    const cb = chip.querySelector('input');
    cb.addEventListener('change', () => chip.classList.toggle('selected', cb.checked));
    splitBox.appendChild(chip);
  });

  if (editId) {
    const exp = state.expenses.find(e => e.id === editId);
    if (!exp) return;
    if (!isExpenseOwner(exp)) {
      toast('Only the person who added this expense can edit it', 'error');
      return;
    }
    title.textContent = 'Edit Expense';
    idInput.value = exp.id;
    document.getElementById('exp-desc').value     = exp.description;
    document.getElementById('exp-amount').value   = exp.amount;
    document.getElementById('exp-date').value     = exp.date;
    document.getElementById('exp-payer').value    = exp.paidBy;
    document.getElementById('exp-category').value = exp.category;
    splitBox.querySelectorAll('.check-chip').forEach(chip => {
      const cb = chip.querySelector('input');
      const sel = exp.splitAmong.includes(cb.value);
      cb.checked = sel;
      chip.classList.toggle('selected', sel);
    });
  } else {
    title.textContent = 'Add Expense';
    idInput.value = '';
    document.getElementById('exp-desc').value     = '';
    document.getElementById('exp-amount').value   = '';
    document.getElementById('exp-category').value = 'Groceries';
    document.getElementById('exp-date').value     = localDateString();
    // Default payer to the logged-in user; fall back to first member
    const { currentMemberId: defaultPayerId } = getAuthUser();
    const payerDefault = defaultPayerId || (state.members.length > 0 ? state.members[0].id : '');
    if (payerDefault) document.getElementById('exp-payer').value = payerDefault;
    // All chips checked for a new expense
    splitBox.querySelectorAll('.check-chip').forEach(chip => {
      const cb = chip.querySelector('input');
      cb.checked = true;
      chip.classList.add('selected');
    });
  }

  overlay.classList.add('open');
}

function closeExpenseModal() {
  document.getElementById('expense-modal-overlay').classList.remove('open');
}

// ============================================================
// MEMBER MODAL
// ============================================================

let selectedColor = MEMBER_COLORS[0];

function openMemberModal() {
  selectedColor = MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
  document.getElementById('member-name').value = '';
  buildColorPicker();
  document.getElementById('member-modal-overlay').classList.add('open');
}

function closeMemberModal() {
  document.getElementById('member-modal-overlay').classList.remove('open');
}

function buildColorPicker() {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  MEMBER_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = `color-swatch ${c === selectedColor ? 'selected' : ''}`;
    sw.style.background = c;
    sw.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    sw.addEventListener('click', () => {
      selectedColor = c;
      picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
    picker.appendChild(sw);
  });
}

// ============================================================
// CRUD: EXPENSES (via API)
// ============================================================

async function saveExpense(e) {
  e.preventDefault();
  if (state.members.length === 0) { toast('Add members first!', 'error'); return; }

  const id       = document.getElementById('expense-id').value;
  const desc     = document.getElementById('exp-desc').value.trim();
  const amount   = parseFloat(document.getElementById('exp-amount').value);
  const date     = document.getElementById('exp-date').value;
  const paidBy   = document.getElementById('exp-payer').value;
  const category = document.getElementById('exp-category').value;
  const splitAmong = [...document.querySelectorAll('#split-checkboxes .check-chip input:checked')].map(i => i.value);

  if (splitAmong.length === 0) { toast('Select at least one person to split with', 'error'); return; }
  if (!desc || isNaN(amount) || amount <= 0) { toast('Please fill all required fields', 'error'); return; }

  const submitBtn = document.getElementById('expense-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    const body = { description: desc, amount, paidBy, splitAmong, category, date };

    if (id) {
      await api.updateExpense(id, body);
      toast('Expense updated!');
    } else {
      await api.createExpense(body);
      toast('Expense added!');
    }

    await loadAll();
    closeExpenseModal();
    renderTab(activeTab);
  } catch (err) {
    toast(err.message || 'Failed to save expense', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Expense';
  }
}

async function deleteExpense(id) {
  const exp = state.expenses.find(e => e.id === id);
  if (!exp) return;
  if (!isExpenseOwner(exp)) {
    toast('Only the person who added this expense can delete it', 'error');
    return;
  }
  const ok = await showConfirm('Delete Expense', `Delete "${exp.description}" (${fmt(exp.amount)})?`);
  if (!ok) return;
  try {
    await api.deleteExpense(id);
    await loadAll();
    toast('Expense deleted');
    renderTab(activeTab);
  } catch (err) {
    toast(err.message || 'Failed to delete', 'error');
  }
}

// ============================================================
// CRUD: MEMBERS (via API)
// ============================================================

async function saveMember(e) {
  e.preventDefault();
  const name = document.getElementById('member-name').value.trim();
  if (!name) return;

  const submitBtn = e.submitter;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Adding…';

  try {
    // Members are user accounts — create via /api/users (with chosen color)
    const defaultPassword = name.toLowerCase().replace(/\s+/g, '') + '1234';
    await api.createUser({ username: name, password: defaultPassword, color: selectedColor });
    await loadAll();   // refresh both state.members and state.users
    closeMemberModal();
    toast(`${name} added! 🎉  Default password: ${defaultPassword}`);
    renderTab(activeTab);
  } catch (err) {
    toast(err.message || 'Failed to add member', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add Member';
  }
}

async function deleteMember(id) {
  const m = memberById(id);
  if (!m) return;

  const hasExpenses = state.expenses.some(e => e.paidBy === id || e.splitAmong.includes(id));
  const msg = hasExpenses
    ? `${m.name} has expenses linked to them. Removing them will affect balance calculations. Are you sure?`
    : `Remove ${m.name} from the house?`;

  const ok = await showConfirm('Remove Member', msg);
  if (!ok) return;

  try {
    await api.deleteMember(id);
    await loadAll();   // refresh state.members and state.users in sync
    toast(`${m.name} removed`);
    renderTab(activeTab);
  } catch (err) {
    toast(err.message || 'Failed to remove member', 'error');
  }
}

// ============================================================
// IMPORT / EXPORT
// ============================================================

function exportData() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `boardmates-${currentMonth()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported!');
}

function importData(file) {
  if (!file) return;
  toast('Import not available in cloud mode. Use the app directly to add data.', 'error');
}

// ============================================================
// RENDER: ACCOUNTS
// ============================================================

function renderAccounts() {
  const list = document.getElementById('accounts-list');
  list.innerHTML = '';

  const displayUsers = state.users.filter(u => u.username !== 'admin');

  if (displayUsers.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><h3>No user accounts yet</h3><p>Create accounts for individuals to access the tracker.</p></div>';
  } else {
    // Exclude the static 'admin' account from the list (admin manages others, not itself)
    displayUsers.forEach(u => {
      const item = document.createElement('div');
      item.className = 'expense-item';
      item.style.padding = '14px 18px';
      item.innerHTML = `
        <div class="expense-cat-icon">👤</div>
        <div class="expense-main">
          <div class="expense-desc" style="font-size:0.95rem; font-weight:600">${u.username}</div>
          <div class="expense-meta">
            Password: <span style="font-family:monospace; font-weight:600; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px">••••••</span>
            · Created: ${new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <div class="expense-actions" style="opacity: 1">
          <button class="btn-icon" data-delete-user="${u.id}" title="Delete account" style="color:var(--red);border-color:rgba(248,113,113,0.3)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
          </button>
        </div>
      `;
      item.querySelector(`[data-delete-user="${u.id}"]`).addEventListener('click', () => deleteUserAccount(u.id, u.username));
      list.appendChild(item);
    });
  }
}


// ============================================================
// ACCOUNT MODAL & ACTIONS
// ============================================================

function openAccountModal() {
  document.getElementById('acc-username').value = '';
  document.getElementById('acc-password').value = '';
  document.getElementById('account-modal-overlay').classList.add('open');
}

function closeAccountModal() {
  document.getElementById('account-modal-overlay').classList.remove('open');
}

async function saveAccount(e) {
  e.preventDefault();
  const username = document.getElementById('acc-username').value.trim();
  const password = document.getElementById('acc-password').value.trim();
  if (!username || !password) return;

  const submitBtn = document.getElementById('account-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    await api.createUser({ username, password });
    await loadAll();   // refresh state.members and state.users
    closeAccountModal();
    toast(`Account for ${username} created!`);
    renderAccounts();
  } catch (err) {
    toast(err.message || 'Failed to create account', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
}

async function deleteUserAccount(id, username) {
  const ok = await showConfirm('Delete Account', `Are you sure you want to delete the account for ${username}? They will immediately lose access.`);
  if (!ok) return;

  try {
    await api.deleteUser(id);
    await loadAll();   // refresh state.members and state.users
    toast(`Account for ${username} deleted`);
    renderAccounts();
  } catch (err) {
    toast(err.message || 'Failed to delete account', 'error');
  }
}

// ============================================================
// ADMIN: RESET ENTIRE DATABASE
// ============================================================

async function resetEverything() {
  // Step 1 — first warning
  const step1 = await showConfirm(
    '⚠️ Reset Entire Database',
    'This will permanently delete ALL expenses, payments, settlement history, and member accounts. Only the admin login will survive. Are you sure you want to continue?'
  );
  if (!step1) return;

  // Step 2 — second hard confirmation
  const step2 = await showConfirm(
    '🔴 Final Warning — No Undo',
    'THIS CANNOT BE UNDONE. Every expense, every member, every settlement record will be gone forever. Confirm to wipe the database and start fresh.'
  );
  if (!step2) return;

  try {
    setGlobalLoading(true);
    await api.resetDatabase();

    // Clear in-memory state immediately
    state.members            = [];
    state.expenses           = [];
    state.settlements        = [];
    state.partialSettlements = [];
    state.users              = [];

    toast('✅ Database reset successfully! Everything has been cleared.', 'success');

    // Re-render whichever tab is currently visible
    renderTab(activeTab);

    // Also refresh from the server to confirm clean state
    await loadAll();
    renderTab(activeTab);
  } catch (err) {
    toast(err.message || 'Failed to reset database', 'error');
  } finally {
    setGlobalLoading(false);
  }
}


// ============================================================
// CLEANING SCHEDULE
// ============================================================

const CL_DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const CL_DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let cleaningState = {
  teams:    [],
  schedule: [],
  config:   { cleaningDays: [1, 4], startDate: '' },
  loaded:   false,
};

const cleaningApi = {
  getSchedule: ()             => apiFetch('/api/cleaning/schedule'),
  createTeam:  (body)         => apiFetch('/api/cleaning/teams',    { method: 'POST',   body }),
  deleteTeam:  (id)           => apiFetch(`/api/cleaning/teams?id=${id}`, { method: 'DELETE' }),
  markDone:    (body)         => apiFetch('/api/cleaning/complete', { method: 'POST',   body }),
  undoDone:    (sessionKey)   => apiFetch('/api/cleaning/complete', { method: 'DELETE', body: { sessionKey } }),
};

async function loadCleaning() {
  const data = await cleaningApi.getSchedule();
  cleaningState.teams    = data.teams    || [];
  cleaningState.schedule = data.schedule || [];
  cleaningState.config   = data.config   || { cleaningDays: [1, 4], startDate: '' };
  cleaningState.loaded   = true;
}

async function renderCleaning() {
  const content = document.getElementById('cleaning-content');
  if (!content) return;
  content.innerHTML = skeletonRows(5);
  try {
    await loadCleaning();
  } catch (err) {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Failed to load schedule</h3><p>Check your connection and try again</p></div>';
    return;
  }
  _clDraw();
}

function _clDraw() {
  const content = document.getElementById('cleaning-content');
  if (!content) return;

  const { isAdmin, currentMemberId } = getAuthUser();
  const { teams, schedule }          = cleaningState;
  const today                        = new Date().toISOString().slice(0, 10);

  content.innerHTML = '';

  // ── Empty state ───────────────────────────────────────────
  if (teams.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">🧹</div>
        <h3>No Cleaning Teams Yet</h3>
        <p>Create teams below to start the rotating schedule!</p>
      </div>`;
    const mgr = document.createElement('div');
    mgr.innerHTML = _clTeamManagerHtml(teams);
    content.appendChild(mgr);
    _clWireManager(content);
    return;
  }

  // ── Banner: Next Cleaning ─────────────────────────────────
  const nextPending = schedule.find(s => s.date >= today && !s.completed);
  content.appendChild(_clBanner(nextPending, currentMemberId));

  // ── Schedule Roster ────────────────────────────────────────
  const section = document.createElement('div');
  section.className = 'cleaning-section';

  // Filter visible sessions (past 2 + next 12 sessions)
  const todayIdx   = schedule.findIndex(s => s.date >= today);
  const startIdx   = Math.max(0, (todayIdx === -1 ? 0 : todayIdx) - 2);
  const visible    = schedule.slice(startIdx, startIdx + 14);

  let rosterHtml = '<div class="cl-timeline">';
  visible.forEach(s => { rosterHtml += _clSessionHtml(s, today, currentMemberId, isAdmin); });
  rosterHtml += '</div>';

  section.innerHTML = `
    <h2 class="card-title" style="margin-bottom:20px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <polyline points="9 14 11 16 15 12"/>
      </svg>
      Cleaning Roster
      <span class="cl-rotation-info">(${teams.length} team${teams.length !== 1 ? 's' : ''} · same team returns every ${teams.length} week${teams.length !== 1 ? 's' : ''})</span>
    </h2>
    ${rosterHtml}`;
  content.appendChild(section);

  // ── Team Manager (Accessible to all members) ─────────────
  const mgr = document.createElement('div');
  mgr.innerHTML = _clTeamManagerHtml(teams);
  content.appendChild(mgr);

  // ── Wire events ───────────────────────────────────────────
  content.querySelectorAll('[data-cl-done]').forEach(btn =>
    btn.addEventListener('click', () => _clMarkDone(btn.dataset.clDone, btn.dataset.clTeam))
  );
  content.querySelectorAll('[data-cl-undo]').forEach(btn =>
    btn.addEventListener('click', () => _clUndoDone(btn.dataset.clUndo))
  );
  _clWireManager(content);
}

function _clBanner(session, currentMemberId) {
  const el = document.createElement('div');
  el.className = 'cl-banner';
  if (!session) {
    el.innerHTML = `
      <div class="cl-banner-inner cl-banner-settled">
        <span style="font-size:2.2rem">🎉</span>
        <div>
          <div class="cl-banner-team">All Caught Up!</div>
          <div class="cl-banner-meta">No upcoming cleaning sessions pending.</div>
        </div>
      </div>`;
    return el;
  }
  const team        = session.team;
  const members     = (team?.memberIds || []).map(id => state.members.find(m => m.id === id)?.name || id).join(' · ');
  const sessionDate = new Date(session.date);
  const today       = new Date().toISOString().slice(0, 10);
  const dateLabel   = session.date === today
    ? 'Today'
    : sessionDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const isMyTeam    = team?.memberIds?.includes(currentMemberId);

  el.innerHTML = `
    <div class="cl-banner-inner" style="border-left:4px solid ${team?.color || '#10b981'}">
      <div class="cl-banner-left">
        <div class="cl-banner-icon">🧹</div>
        <div>
          <div class="cl-banner-label">Next Cleaning Day</div>
          <div class="cl-banner-team" style="color:${team?.color || '#10b981'}">${team?.name || '—'}</div>
          <div class="cl-banner-meta">All Team Members: <strong>${members}</strong></div>
          <div class="cl-banner-date">📅 ${dateLabel}</div>
        </div>
      </div>
      <button class="btn btn-primary cl-banner-btn"
        data-cl-done="${session.sessionKey}" data-cl-team="${team?.id || ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:15px;height:15px">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Mark Done
      </button>
    </div>`;
  return el;
}

function _clSessionHtml(session, today, currentMemberId, isAdmin) {
  const team = session.team;
  if (!team) return '';

  const d         = new Date(session.date);
  const dayName   = CL_DAY_FULL[d.getDay()];
  const dateStr   = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const isToday   = session.date === today;
  const isOverdue = session.date < today && !session.completed;

  const memberNames = (team.memberIds || [])
    .map(id => state.members.find(m => m.id === id)?.name || id)
    .join(' · ');

  const isMyTeam = (team.memberIds || []).includes(currentMemberId);

  let statusHtml = '';
  let actionHtml = '';

  if (session.completed) {
    statusHtml = `<span class="cl-done-check">✓</span><span class="cl-done-by">Done by <strong>${session.doneBy}</strong></span>`;
    actionHtml = `<button class="cl-undo-btn" data-cl-undo="${session.sessionKey}">↩ Undo</button>`;
  } else if (isOverdue) {
    statusHtml = '<span class="cl-tag cl-tag-overdue">⚠️ Overdue</span>';
    actionHtml = `<button class="cl-check-btn" data-cl-done="${session.sessionKey}" data-cl-team="${team.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg> Mark Done</button>`;
  } else if (isToday) {
    statusHtml = '<span class="cl-badge cl-badge-now">Today</span>';
    actionHtml = `<button class="cl-check-btn" data-cl-done="${session.sessionKey}" data-cl-team="${team.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg> Mark Done</button>`;
  } else {
    statusHtml = '<span class="cl-tag cl-tag-pending">Pending</span>';
    actionHtml = `<button class="cl-check-btn" data-cl-done="${session.sessionKey}" data-cl-team="${team.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg> Mark Done</button>`;
  }

  return `
    <div class="cl-block ${session.completed ? 'cl-block-done' : ''} ${isOverdue ? 'cl-block-overdue' : ''} ${isToday ? 'cl-block-current' : ''}">
      <div class="cl-session" style="border-left:4px solid ${team.color}; padding:14px 18px;">
        <div class="cl-session-date" style="min-width:110px">
          <div class="cl-session-day" style="font-size:0.9rem; font-weight:700">${dayName}</div>
          <div class="cl-session-dstr">${dateStr}</div>
        </div>
        <div style="flex:1; margin:0 12px">
          <div style="display:flex; align-items:center; gap:8px">
            <span class="cl-block-dot" style="background:${team.color}"></span>
            <span style="font-weight:700; font-size:0.9rem; color:${team.color}">${team.name}</span>
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-top:3px">
            👥 All Team Members: <strong style="color:var(--text)">${memberNames}</strong>
          </div>
        </div>
        <div class="cl-session-status">${statusHtml}</div>
        <div class="cl-session-action">${actionHtml}</div>
      </div>
    </div>`;
}

function _clTeamManagerHtml(teams) {
  const cards = teams.map(t => {
    const members = (t.memberIds || [])
      .map(id => state.members.find(m => m.id === id)?.name || id)
      .join(', ') || '<em>No members</em>';
    return `
      <div class="cl-team-card" style="border-top:3px solid ${t.color}">
        <div class="cl-team-card-name" style="color:${t.color}">${t.name}</div>
        <div class="cl-team-members">${members}</div>
        <button class="cl-team-del-btn" data-cl-del="${t.id}" title="Delete team">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
          Delete
        </button>
      </div>`;
  }).join('');

  return `
    <div class="cleaning-section" style="margin-top:20px">
      <div class="cl-mgr-header">
        <h2 class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          Manage Cleaning Teams
        </h2>
        <button class="btn btn-primary" id="cl-add-team-btn" style="padding:8px 16px;font-size:0.82rem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Create Team
        </button>
      </div>
      <div class="cl-teams-grid">
        ${teams.length ? cards : '<div style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:20px 0">No teams created yet. Click "Create Team" to set up your first cleaning team!</div>'}
      </div>
    </div>`;
}

function _clWireManager(container) {
  const addBtn = container.querySelector('#cl-add-team-btn');
  if (addBtn) addBtn.addEventListener('click', _clOpenTeamModal);
  container.querySelectorAll('[data-cl-del]').forEach(btn =>
    btn.addEventListener('click', () => _clDeleteTeam(btn.dataset.clDel))
  );
}

async function _clMarkDone(sessionKey, teamId) {
  const session = cleaningState.schedule.find(s => s.sessionKey === sessionKey);
  const teamName = session?.team?.name || 'this team';
  const { username } = getAuthUser();

  const ok = await showConfirm(
    'Confirm Cleaning Completed',
    `Are you sure you want to mark the cleaning for ${teamName} as DONE by ${username}?`
  );
  if (!ok) return;

  try {
    await cleaningApi.markDone({ sessionKey, teamId });
    toast('✅ Cleaning session marked as done!');
    await loadCleaning();
    _clDraw();
  } catch (err) { toast(err.message || 'Failed to mark done', 'error'); }
}

async function _clUndoDone(sessionKey) {
  const ok = await showConfirm('Undo Cleaning', 'Mark this session as not done?');
  if (!ok) return;
  try {
    await cleaningApi.undoDone(sessionKey);
    toast('↩️ Session undone');
    await loadCleaning();
    _clDraw();
  } catch (err) { toast(err.message || 'Failed to undo', 'error'); }
}

async function _clDeleteTeam(id) {
  const team = cleaningState.teams.find(t => t.id === id);
  if (!team) return;
  const ok = await showConfirm('Delete Team', `Remove "${team.name}" from the cleaning schedule? This cannot be undone.`);
  if (!ok) return;
  try {
    await cleaningApi.deleteTeam(id);
    toast(`Team "${team.name}" deleted`);
    await loadCleaning();
    _clDraw();
  } catch (err) { toast(err.message || 'Failed to delete team', 'error'); }
}

// ── Cleaning Team Modal ───────────────────────────────────────
let _clSelectedColor = MEMBER_COLORS[0];

function _clOpenTeamModal() {
  // Populate member checkboxes
  const cbBox = document.getElementById('cl-team-member-checkboxes');
  if (cbBox) {
    cbBox.innerHTML = '';
    state.members.forEach(m => {
      const chip = document.createElement('label');
      chip.className = 'check-chip';
      chip.innerHTML = `
        <input type="checkbox" value="${m.id}" />
        <span class="chip-dot" style="background:${m.color}"></span>
        ${m.name}`;
      const cb = chip.querySelector('input');
      cb.addEventListener('change', () => chip.classList.toggle('selected', cb.checked));
      cbBox.appendChild(chip);
    });
  }
  // Color picker
  _clSelectedColor = MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
  const pickerEl = document.getElementById('cl-team-color-picker');
  if (pickerEl) {
    pickerEl.innerHTML = '';
    MEMBER_COLORS.forEach(c => {
      const sw = document.createElement('div');
      sw.className = `color-swatch ${c === _clSelectedColor ? 'selected' : ''}`;
      sw.style.background = c;
      sw.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
      sw.addEventListener('click', () => {
        _clSelectedColor = c;
        pickerEl.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
      pickerEl.appendChild(sw);
    });
  }
  const nameInput = document.getElementById('cl-team-name');
  if (nameInput) nameInput.value = '';
  document.getElementById('cl-team-modal-overlay')?.classList.add('open');
}

function _clCloseTeamModal() {
  document.getElementById('cl-team-modal-overlay')?.classList.remove('open');
}

async function _clSaveTeam(e) {
  e.preventDefault();
  const name = document.getElementById('cl-team-name')?.value.trim();
  if (!name) return;
  const memberIds = [...document.querySelectorAll('#cl-team-member-checkboxes .check-chip input:checked')]
    .map(i => i.value);
  if (!memberIds.length) { toast('Select at least one member for the team', 'error'); return; }

  const submitBtn = document.getElementById('cl-team-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }
  try {
    await cleaningApi.createTeam({ name, memberIds, color: _clSelectedColor });
    _clCloseTeamModal();
    toast(`Team "${name}" created! 🎉`);
    await loadCleaning();
    _clDraw();
  } catch (err) {
    toast(err.message || 'Failed to create team', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Team'; }
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // FAB
  document.getElementById('fab-add').addEventListener('click', () => {
    if (state.members.length === 0) { toast('Add a member first!', 'error'); switchTab('members'); return; }
    openExpenseModal();
  });

  // Add expense button
  document.getElementById('add-expense-btn').addEventListener('click', () => {
    if (state.members.length === 0) { toast('Add a member first!', 'error'); switchTab('members'); return; }
    openExpenseModal();
  });

  // Add member button (if present)
  const addMemberBtn = document.getElementById('add-member-btn');
  if (addMemberBtn) addMemberBtn.addEventListener('click', openMemberModal);

  // Expense modal
  document.getElementById('expense-form').addEventListener('submit', saveExpense);
  document.getElementById('expense-modal-close').addEventListener('click', closeExpenseModal);
  document.getElementById('expense-cancel-btn').addEventListener('click', closeExpenseModal);
  document.getElementById('expense-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('expense-modal-overlay')) closeExpenseModal();
  });

  // Member modal
  document.getElementById('member-form').addEventListener('submit', saveMember);
  document.getElementById('member-modal-close').addEventListener('click', closeMemberModal);
  document.getElementById('member-cancel-btn').addEventListener('click', closeMemberModal);
  document.getElementById('member-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('member-modal-overlay')) closeMemberModal();
  });

  // Payment detail modal
  document.getElementById('pay-detail-close').addEventListener('click', closePaymentDetailModal);
  document.getElementById('pay-detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('pay-detail-overlay')) closePaymentDetailModal();
  });

  // Expense filters
  document.getElementById('filter-member').addEventListener('change', e => {
    expenseFilters.member = e.target.value; renderExpenses();
  });
  document.getElementById('filter-category').addEventListener('change', e => {
    expenseFilters.category = e.target.value; renderExpenses();
  });
  document.getElementById('filter-month').addEventListener('change', e => {
    expenseFilters.month = e.target.value; renderExpenses();
  });

  // Export
  document.getElementById('export-btn').addEventListener('click', exportData);

  // Import — not available in cloud mode; intercept label click before file picker opens
  const importLabel = document.querySelector('label[for="import-file"]');
  if (importLabel) {
    importLabel.addEventListener('click', e => {
      e.preventDefault();
      toast('Import is not available in cloud mode. Add data directly through the app.', 'error');
    });
  }

  // Accounts (Admin only)
  const addAccountBtn = document.getElementById('add-account-btn');
  if (addAccountBtn) addAccountBtn.addEventListener('click', openAccountModal);

  // Danger Zone — Reset entire database (admin only, static button in HTML)
  const resetDbBtn = document.getElementById('reset-db-btn');
  if (resetDbBtn) resetDbBtn.addEventListener('click', resetEverything);

  const accountForm = document.getElementById('account-form');
  if (accountForm) accountForm.addEventListener('submit', saveAccount);

  const accountClose = document.getElementById('account-modal-close');
  if (accountClose) accountClose.addEventListener('click', closeAccountModal);

  const accountCancel = document.getElementById('account-cancel-btn');
  if (accountCancel) accountCancel.addEventListener('click', closeAccountModal);

  const accountOverlay = document.getElementById('account-modal-overlay');
  if (accountOverlay) {
    accountOverlay.addEventListener('click', e => {
      if (e.target === accountOverlay) closeAccountModal();
    });
  }

  // Change password events
  const openChangePw = () => {
    document.getElementById('new-password').value = '';
    document.getElementById('changepw-modal-overlay').classList.add('open');
  };
  const closeChangePw = () => {
    document.getElementById('changepw-modal-overlay').classList.remove('open');
  };
  const submitChangePw = async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value.trim();
    if (!newPassword) return;
    const submitBtn = document.getElementById('changepw-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating…';
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: { password: newPassword }
      });
      closeChangePw();
      toast('Password updated successfully!');
    } catch (err) {
      toast(err.message || 'Failed to update password', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Password';
    }
  };

  const changePwBtn = document.getElementById('change-pw-btn');
  if (changePwBtn) changePwBtn.addEventListener('click', openChangePw);

  const topbarChangePwBtn = document.getElementById('topbar-change-pw-btn');
  if (topbarChangePwBtn) topbarChangePwBtn.addEventListener('click', openChangePw);

  const changepwForm = document.getElementById('changepw-form');
  if (changepwForm) changepwForm.addEventListener('submit', submitChangePw);

  const changepwClose = document.getElementById('changepw-modal-close');
  if (changepwClose) changepwClose.addEventListener('click', closeChangePw);

  const changepwCancel = document.getElementById('changepw-cancel-btn');
  if (changepwCancel) changepwCancel.addEventListener('click', closeChangePw);

// ============================================================
// PAYMENT REMINDERS & NOTIFICATIONS (7-day + 5-day cycle)
// ============================================================

let currentReminders = [];

async function fetchReminders() {
  try {
    const data = await apiFetch('/api/reminders');
    currentReminders = data.reminders || [];

    // Update Bell Badge
    const badge = document.getElementById('notif-badge');
    if (badge) {
      if (currentReminders.length > 0) {
        badge.textContent = currentReminders.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // Trigger Browser Push Notification if permission granted
    if ('Notification' in window && Notification.permission === 'granted' && currentReminders.length > 0) {
      const first = currentReminders[0];
      new Notification('House Payment Reminder ⏰', {
        body: `You have ${currentReminders.length} overdue expense(s) > 7 days old! (e.g. ${first.description} - LKR ${first.share} to ${first.payerName})`,
        icon: 'logo.png'
      });
    }
  } catch (err) {
    console.warn('Reminders check skipped:', err.message);
  }
}

function openNotifModal() {
  const overlay = document.getElementById('notif-modal-overlay');
  const list = document.getElementById('notif-list');
  const permBanner = document.getElementById('notif-perm-banner');
  const adminBox = document.getElementById('admin-announcement-box');

  const { isAdmin } = getAuthUser();
  if (isAdmin && adminBox) {
    adminBox.classList.remove('hidden');
  } else if (adminBox) {
    adminBox.classList.add('hidden');
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    permBanner.classList.add('hidden');
  } else {
    permBanner.classList.remove('hidden');
  }

  list.innerHTML = '';
  if (currentReminders.length === 0) {
    list.innerHTML = `
      <div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 0.82rem;">
        🎉 No notifications or overdue payment reminders!
      </div>
    `;
  } else {
    currentReminders.forEach(r => {
      const item = document.createElement('div');
      item.className = 'notif-item';

      let badgeClass = '';
      let badgeText = '';

      if (r.type === 'announcement') {
        badgeClass = 'announcement';
        badgeText = '📢 Announcement';
      } else if (r.type === 'settlement_received') {
        badgeClass = 'received';
        badgeText = '💰 Payment';
      } else {
        badgeClass = '';
        badgeText = `${r.daysOverdue} days ago`;
      }

      item.innerHTML = `
        <div style="flex:1">
          <div class="notif-item-title">${r.title || r.description}</div>
          <div class="notif-item-sub">${r.message || `Owed to ${r.payerName}`}</div>
        </div>
        <span class="notif-item-badge ${badgeClass}">${badgeText}</span>
      `;
      list.appendChild(item);
    });
  }

  overlay.classList.add('open');
}

function closeNotifModal() {
  document.getElementById('notif-modal-overlay').classList.remove('open');
}

async function sendAdminAnnouncement() {
  const titleInput = document.getElementById('admin-ann-title-input');
  const msgInput = document.getElementById('admin-ann-msg-input');

  const title = titleInput ? titleInput.value.trim() : '';
  const message = msgInput ? msgInput.value.trim() : '';

  if (!message) {
    toast('Please write an announcement message', 'error');
    return;
  }

  try {
    await apiFetch('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ title, message })
    });
    toast('📢 Announcement broadcasted to all housemates!');
    if (titleInput) titleInput.value = '';
    if (msgInput) msgInput.value = '';
    fetchReminders();
  } catch (err) {
    toast(err.message || 'Failed to post announcement', 'error');
  }
}

async function requestPushPermission() {
  if (!('Notification' in window)) {
    toast('Browser push notifications are not supported on this device', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    toast('Notifications enabled! 🔔 You will receive overdue alerts.');
    document.getElementById('notif-perm-banner').classList.add('hidden');
    fetchReminders();
  } else {
    toast('Notification permission denied', 'error');
  }
}

  // Reminders / Notification Modal Wiring
  const notifBtn = document.getElementById('notif-btn');
  if (notifBtn) notifBtn.addEventListener('click', openNotifModal);

  const notifClose = document.getElementById('notif-modal-close');
  if (notifClose) notifClose.addEventListener('click', closeNotifModal);

  const notifCloseBtn = document.getElementById('notif-close-btn');
  if (notifCloseBtn) notifCloseBtn.addEventListener('click', closeNotifModal);

  const enablePushBtn = document.getElementById('enable-push-btn');
  if (enablePushBtn) enablePushBtn.addEventListener('click', requestPushPermission);

  const sendAnnBtn = document.getElementById('send-announcement-btn');
  if (sendAnnBtn) sendAnnBtn.addEventListener('click', sendAdminAnnouncement);

  const notifOverlay = document.getElementById('notif-modal-overlay');
  if (notifOverlay) {
    notifOverlay.addEventListener('click', e => {
      if (e.target === notifOverlay) closeNotifModal();
    });
  }


  // Cleaning team modal wiring
  const clForm = document.getElementById('cl-team-form');
  if (clForm) clForm.addEventListener('submit', _clSaveTeam);
  const clClose = document.getElementById('cl-team-modal-close');
  if (clClose) clClose.addEventListener('click', _clCloseTeamModal);
  const clCancel = document.getElementById('cl-team-cancel-btn');
  if (clCancel) clCancel.addEventListener('click', _clCloseTeamModal);
  const clOverlay = document.getElementById('cl-team-modal-overlay');
  if (clOverlay) clOverlay.addEventListener('click', e => { if (e.target === clOverlay) _clCloseTeamModal(); });

  // Load data from MongoDB, then render
  await loadAll();
  renderDashboard();
  fetchReminders();
});

