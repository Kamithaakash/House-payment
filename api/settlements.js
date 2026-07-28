// api/settlements.js
// GET    /api/settlements              → list all archived settlements
// POST   /api/settlements              → archive a month's settlement
// DELETE /api/settlements?id=<id>      → delete one settlement record (admin only)
// DELETE /api/settlements?all=true     → delete ALL settlement history (admin only)
// DELETE /api/settlements?reset=true   → FULL database wipe — all collections (admin only)

import { connectToDatabase, setCors, verifyToken } from './_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();
    const col    = db.collection('settlements');

    // ── GET: list all settlements ──────────────────────────────────────
    if (req.method === 'GET') {
      const settlements = await col.find({}).sort({ month: -1 }).toArray();
      const out = settlements.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));
      return res.status(200).json(out);
    }

    // ── POST: archive a month ──────────────────────────────────────────
    if (req.method === 'POST') {
      if (!verifyToken(req)) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
      }
      const { month, transactions, settledAt } = req.body;

      if (!month) {
        return res.status(400).json({ error: 'month is required' });
      }

      const doc = {
        month,
        transactions: transactions || [],
        settledAt: settledAt || new Date().toISOString(),
        createdAt: new Date(),
      };

      await col.replaceOne({ month }, doc, { upsert: true });

      const saved = await col.findOne({ month });
      const { _id, ...rest } = saved;
      return res.status(201).json({ id: _id.toString(), ...rest });
    }

    // ── DELETE (admin only) ────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const payload = verifyToken(req);
      if (!payload || payload.username !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      // DELETE ?reset=true → FULL wipe of ALL collections
      if (req.query.reset === 'true') {
        const { confirmToken } = req.body || {};
        if (confirmToken !== 'RESET_EVERYTHING') {
          return res.status(400).json({ error: 'Missing or invalid confirmToken.' });
        }

        await db.collection('expenses').deleteMany({});
        await db.collection('partialSettlements').deleteMany({});
        await db.collection('settlements').deleteMany({});
        await db.collection('users').deleteMany({});

        console.log('[/api/settlements?reset] Full database reset at', new Date().toISOString());
        return res.status(200).json({
          success: true,
          message: 'All data has been wiped. The app is ready for a fresh start.',
          cleared: ['expenses', 'partialSettlements', 'settlements', 'users'],
        });
      }

      // DELETE ?all=true → wipe all settlement history only
      if (req.query.all === 'true') {
        const result = await col.deleteMany({});
        return res.status(200).json({ success: true, deleted: result.deletedCount });
      }

      // DELETE ?id=<mongoId> → remove one settlement record
      const { id } = req.query;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Provide ?id=<settlementId>, ?all=true, or ?reset=true' });
      }
      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Settlement record not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/settlements]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
