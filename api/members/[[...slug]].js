// api/members/[[...slug]].js
// GET    /api/members      → list all members (from users collection, excluding admin)
// DELETE /api/members/:id  → remove a member by ID (admin only)

import { connectToDatabase, setCors, verifyToken } from '../_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // slug is undefined for /api/members, or ['id'] for /api/members/:id
  const id = req.query.slug?.[0] ?? null;

  try {
    const { db } = await connectToDatabase();

    // ── No ID: collection routes ─────────────────────────────────────────
    if (!id) {
      // GET: list all members
      // Accounts are members — retrieve from the 'users' collection.
      if (req.method === 'GET') {
        // Exclude 'admin' so they act purely as a watcher
        const users = await db.collection('users')
          .find({ username: { $ne: 'admin' } })
          .sort({ username: 1 })
          .toArray();

        // Convert database schema to frontend member schema
        const out = users.map(u => ({
          id:        u._id.toString(),
          name:      u.username,
          color:     u.color || '#3b82f6',
          createdAt: u.createdAt,
        }));

        return res.status(200).json(out);
      }

      // POST: creating members directly is disabled
      if (req.method === 'POST') {
        return res.status(403).json({ error: 'Creating members directly is disabled. Create user accounts instead.' });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── With ID: item routes ─────────────────────────────────────────────
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid member ID' });
    }

    // DELETE: remove member (admin only)
    if (req.method === 'DELETE') {
      const payload = verifyToken(req);
      if (!payload || payload.username !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const result = await db.collection('users').deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Member not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/members]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
