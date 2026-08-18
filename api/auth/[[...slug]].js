// api/auth/[[...slug]].js
// POST /api/auth/login            → { token, username }
// POST /api/auth/logout           → { success: true }
// GET  /api/auth/me               → { username }
// POST /api/auth/change-password  → { success: true }

import crypto from 'crypto';
import { connectToDatabase, setCors } from '../_db.js';

const SECRET = process.env.TOKEN_SECRET || process.env.MONGODB_URI || 'house-bills-secret-2026';

// ── Fallback static users (if DB is unavailable) ──────────────────────────
const STATIC_USERS = [
  { username: 'admin',  password: 'house123' },
  { username: 'saniru', password: 'pass1234' },
];

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;

    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // slug[0] = 'login' | 'logout' | 'me' | 'change-password'
  const action = req.query.slug?.[0];

  // ── POST /api/auth/login ─────────────────────────────────────────────
  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    let user = null;

    // 1. Check MongoDB dynamic users collection
    try {
      const { db } = await connectToDatabase();
      const dbUser = await db.collection('users').findOne({
        username: cleanUsername,
        password: password,
      });
      if (dbUser) user = { username: dbUser.username };
    } catch (err) {
      console.error('DB error in login, falling back to static users:', err);
    }

    // 2. Fallback to static users list
    if (!user) {
      user = STATIC_USERS.find(u => u.username === cleanUsername && u.password === password);
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Create a signed token valid for 7 days
    const token = sign({
      username: user.username,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({ token, username: user.username });
  }

  // ── POST /api/auth/logout ────────────────────────────────────────────
  if (action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Stateless — client removes token from localStorage
    return res.status(200).json({ success: true });
  }

  // ── GET /api/auth/me ─────────────────────────────────────────────────
  if (action === 'me') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const auth  = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

    if (!token) return res.status(401).json({ error: 'No token provided' });

    const payload = verifyToken(req);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

    return res.status(200).json({ username: payload.username });
  }

  // ── POST /api/auth/change-password ───────────────────────────────────
  if (action === 'change-password') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const payload = verifyToken(req);
    if (!payload || !payload.username) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    const { password } = req.body || {};
    if (!password || password.trim().length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }

    try {
      const { db } = await connectToDatabase();
      const col = db.collection('users');
      const cleanUsername = payload.username.trim().toLowerCase();

      const existing = await col.findOne({ username: cleanUsername });

      if (existing) {
        // Update existing user's password
        await col.updateOne(
          { username: cleanUsername },
          { $set: { password: password.trim() } }
        );
      } else {
        // Static/fallback user: insert into DB with the new password
        await col.insertOne({
          username: cleanUsername,
          password: password.trim(),
          color: '#10b981', // default green for admin
          createdAt: new Date(),
        });
      }

      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('[/api/auth/change-password]', err);
      return res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  }

  // ── Unknown action ───────────────────────────────────────────────────
  return res.status(404).json({ error: `Unknown auth action: ${action}` });
}
