// api/users/[[...slug]].js
// GET    /api/users      → List all users (admin only)
// POST   /api/users      → Create a new user (admin only)
// DELETE /api/users/:id  → Delete a user by ID (admin only)

import crypto from 'crypto';
import { connectToDatabase, setCors } from '../_db.js';
import { ObjectId } from 'mongodb';

const SECRET = process.env.TOKEN_SECRET || process.env.MONGODB_URI || 'house-bills-secret-2026';

const MEMBER_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#f43f5e', '#06b6d4', '#ec4899', '#84cc16',
  '#ff7849', '#a78bfa'
];

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

  // All /api/users routes are admin-only
  const payload = verifyToken(req);
  if (!payload || payload.username !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access only' });
  }

  // slug is undefined for /api/users, or ['id'] for /api/users/:id
  const id = req.query.slug?.[0] ?? null;

  try {
    const { db } = await connectToDatabase();
    const col = db.collection('users');

    // ── No ID: collection routes ─────────────────────────────────────────
    if (!id) {
      // GET: list all users
      if (req.method === 'GET') {
        const users = await col.find({}).sort({ username: 1 }).toArray();
        const out = users.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));
        return res.status(200).json(out);
      }

      // POST: create a new user
      if (req.method === 'POST') {
        const { username, password, color: inputColor } = req.body || {};
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' });
        }

        const cleanUsername = username.trim().toLowerCase();
        if (cleanUsername === 'admin') {
          return res.status(400).json({ error: 'Cannot create another admin user' });
        }

        const existing = await col.findOne({ username: cleanUsername });
        if (existing) {
          return res.status(409).json({ error: 'Username already exists' });
        }

        const color = inputColor || MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
        const doc = {
          username: cleanUsername,
          password: password.trim(),
          color,
          createdAt: new Date(),
        };

        const result = await col.insertOne(doc);
        return res.status(201).json({ id: result.insertedId.toString(), ...doc });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── With ID: item routes ─────────────────────────────────────────────
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // DELETE: remove user
    if (req.method === 'DELETE') {
      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/users]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
