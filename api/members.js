// api/members.js
// GET    /api/members          → list all members
// DELETE /api/members?id=<id>  → remove a member (admin only)

import { connectToDatabase, setCors, verifyToken } from './_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();

    // ── GET: list all members ──────────────────────────────────────────
    if (req.method === 'GET') {
      const users = await db.collection('users').find({ username: { $ne: 'admin' } }).sort({ username: 1 }).toArray();
      const out = users.map(u => ({
        id: u._id.toString(),
        name: u.username,
        color: u.color || '#3b82f6',
        createdAt: u.createdAt
      }));
      return res.status(200).json(out);
    }

    // ── DELETE: remove member by ?id ───────────────────────────────────
    if (req.method === 'DELETE') {
      const payload = verifyToken(req);
      if (!payload || payload.username !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const { id } = req.query;
      if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid member ID' });
      const result = await db.collection('users').deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Member not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/members]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
