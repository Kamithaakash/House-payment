/**
 * local-server.js
 * ─────────────────────────────────────────────────────────────
 * Local dev server for BoardMates.
 * Serves static files + mocks all /api/* endpoints in memory.
 * No MongoDB needed — swap in the real Vercel deployment later.
 *
 * Run:  node local-server.js
 * Open: http://localhost:3000
 * ─────────────────────────────────────────────────────────────
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = 3000;

// ── Auth config — change these credentials as needed ──────────
const USERS = [
  { username: 'admin',  password: 'house123' },
  { username: 'saniru', password: 'pass1234' },
];
// Active session tokens (in-memory; cleared on server restart)
const activeSessions = new Map(); // token → { username, createdAt }

function generateToken() {
  return Buffer.from(
    Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
}

function validateToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return activeSessions.get(token) || null;
}

// ── In-memory "database" ─────────────────────────────────────
const db = {
  members:            [],
  expenses:           [],
  settlements:        [],
  partialSettlements: [],
};

// ── Tiny ID generator ─────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


// ── MIME types for static files ───────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── JSON helpers ──────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end',  ()    => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

// ── API router ────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const method   = req.method;
  const pathname = url.pathname;

  // Preflight
  if (method === 'OPTIONS') return send(res, 200, {});

  /* ── /api/auth/login ───────────────────────────────────────── */
  if (pathname === '/api/auth/login') {
    if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req);
    const user = USERS.find(
      u => u.username === (body.username || '').trim().toLowerCase() &&
           u.password === (body.password || '')
    );
    if (!user) return send(res, 401, { error: 'Invalid username or password' });
    const token = generateToken();
    activeSessions.set(token, { username: user.username, createdAt: Date.now() });
    return send(res, 200, { token, username: user.username });
  }

  /* ── /api/auth/me ─────────────────────────────────────────── */
  if (pathname === '/api/auth/me') {
    if (method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const session = validateToken(req);
    if (!session) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, { username: session.username });
  }

  /* ── /api/auth/logout ─────────────────────────────────────── */
  if (pathname === '/api/auth/logout') {
    if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) activeSessions.delete(token);
    return send(res, 200, { success: true });
  }

  /* ── /api/members ─────────────────────────────────────────── */

  if (pathname === '/api/members') {
    if (method === 'GET') {
      return send(res, 200, db.members);
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.color) return send(res, 400, { error: 'name and color required' });
      const dup = db.members.find(m => m.name.toLowerCase() === body.name.trim().toLowerCase());
      if (dup) return send(res, 409, { error: 'A member with that name already exists' });
      const member = { id: uid(), name: body.name.trim(), color: body.color, createdAt: new Date() };
      db.members.push(member);
      return send(res, 201, member);
    }
  }

  /* ── /api/members/:id ─────────────────────────────────────── */
  const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch) {
    const id = memberMatch[1];
    if (method === 'DELETE') {
      const idx = db.members.findIndex(m => m.id === id);
      if (idx === -1) return send(res, 404, { error: 'Member not found' });
      db.members.splice(idx, 1);
      return send(res, 200, { success: true });
    }
  }

  /* ── /api/expenses ────────────────────────────────────────── */
  if (pathname === '/api/expenses') {
    if (method === 'GET') {
      const month = url.searchParams.get('month');
      const out   = month ? db.expenses.filter(e => e.month === month) : db.expenses;
      return send(res, 200, [...out].sort((a, b) => new Date(b.date) - new Date(a.date)));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.description || !body.amount || !body.paidBy || !body.splitAmong?.length || !body.date) {
        return send(res, 400, { error: 'Missing required fields' });
      }
      const expense = {
        id:          uid(),
        description: body.description.trim(),
        amount:      body.amount,
        paidBy:      body.paidBy,
        splitAmong:  body.splitAmong,
        category:    body.category || 'Other',
        date:        body.date,
        month:       body.date.slice(0, 7),
        createdAt:   new Date(),
      };
      db.expenses.push(expense);
      return send(res, 201, expense);
    }
  }

  /* ── /api/expenses/:id ────────────────────────────────────── */
  const expenseMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
  if (expenseMatch) {
    const id  = expenseMatch[1];
    const idx = db.expenses.findIndex(e => e.id === id);

    if (method === 'PUT') {
      const body = await readBody(req);
      if (idx === -1) return send(res, 404, { error: 'Expense not found' });
      db.expenses[idx] = {
        ...db.expenses[idx],
        description: body.description.trim(),
        amount:      body.amount,
        paidBy:      body.paidBy,
        splitAmong:  body.splitAmong,
        category:    body.category || 'Other',
        date:        body.date,
        month:       body.date.slice(0, 7),
        updatedAt:   new Date(),
      };
      return send(res, 200, db.expenses[idx]);
    }
    if (method === 'DELETE') {
      if (idx === -1) return send(res, 404, { error: 'Expense not found' });
      db.expenses.splice(idx, 1);
      return send(res, 200, { success: true });
    }
  }

  /* ── /api/partial-settlements ───────────────────────────────── */
  if (pathname === '/api/partial-settlements') {
    if (method === 'GET') {
      const month = url.searchParams.get('month');
      const out   = month ? db.partialSettlements.filter(s => s.month === month) : db.partialSettlements;
      return send(res, 200, [...out].sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt)));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.month || !body.from || !body.to || !body.amount) {
        return send(res, 400, { error: 'month, from, to, amount required' });
      }
      const record = {
        id:        uid(),
        month:     body.month,
        from:      body.from,
        to:        body.to,
        amount:    body.amount,
        paidAt:    body.paidAt || new Date().toISOString(),
        createdAt: new Date(),
      };
      db.partialSettlements.push(record);
      return send(res, 201, record);
    }
  }

  /* ── /api/settlements ─────────────────────────────────────── */
  if (pathname === '/api/settlements') {
    if (method === 'GET') {
      return send(res, 200, [...db.settlements].sort((a, b) => b.month.localeCompare(a.month)));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.month) return send(res, 400, { error: 'month required' });
      const existing = db.settlements.findIndex(s => s.month === body.month);
      const record = {
        id:           uid(),
        month:        body.month,
        transactions: body.transactions || [],
        settledAt:    body.settledAt || new Date().toISOString(),
        createdAt:    new Date(),
      };
      if (existing >= 0) db.settlements[existing] = record;
      else               db.settlements.push(record);
      return send(res, 201, record);
    }
  }

  return send(res, 404, { error: `No API route: ${method} ${pathname}` });
}

// ── Static file server ────────────────────────────────────────
function serveStatic(req, res, pathname) {
  // Default to index.html for root
  const filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext      = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA routing
      fs.readFile(path.join(__dirname, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Main request handler ──────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error('API error:', err);
      send(res, 500, { error: 'Internal server error', detail: err.message });
    }
  } else {
    serveStatic(req, res, url.pathname);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🏠  ලකේ පමනෙ පකේ ගනුදෙනු — Local Dev Server');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  ✅  Running at: http://localhost:${PORT}`);
  console.log('  📦  Using in-memory database (no MongoDB needed)');
  console.log('  ℹ️   Data resets on server restart');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
