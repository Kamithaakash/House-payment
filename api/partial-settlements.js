// api/partial-settlements.js
// GET    /api/partial-settlements?month=YYYY-MM  → list individual payments for a month
// POST   /api/partial-settlements                → record one person paying another + notify recipient
// DELETE /api/partial-settlements?id=XYZ          → undo a settlement if within 30 minutes

import { connectToDatabase, setCors, verifyToken } from './_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();
    const col    = db.collection('partialSettlements');

    if (req.method === 'GET') {
      const query = {};
      if (req.query.month) query.month = req.query.month;
      const docs = await col.find(query).sort({ paidAt: -1 }).toArray();
      return res.status(200).json(docs.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest })));
    }

    if (req.method === 'POST') {
      const user = verifyToken(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
      }
      const { month, from, to, amount, paidAt } = req.body;
      if (!month || !from || !to || !amount) {
        return res.status(400).json({ error: 'month, from, to, amount are required' });
      }

      const now = new Date();
      const doc = {
        month,
        from,
        to,
        amount,
        paidAt: paidAt || now.toISOString(),
        createdAt: now,
      };
      const result = await col.insertOne(doc);

      // Notify the recipient member
      try {
        const members = await db.collection('members').find({}).toArray();
        const payer = members.find(m => (m.id || m._id.toString()) === from);
        const payerName = payer ? payer.name : user.username;

        await db.collection('notifications').insertOne({
          targetMemberId: to,
          type: 'settlement_received',
          title: '💰 Payment Received',
          message: `${payerName} marked LKR ${amount.toFixed(2)} as paid to you.`,
          createdAt: now,
          read: false
        });
      } catch (nErr) {
        console.warn('Failed to insert notification:', nErr);
      }

      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    }

    if (req.method === 'DELETE') {
      const user = verifyToken(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
      }

      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'Settlement ID is required' });
      }

      let filter = { _id: id };
      if (ObjectId.isValid(id)) {
        filter = { _id: new ObjectId(id) };
      }

      const settlement = await col.findOne(filter);
      if (!settlement) {
        return res.status(404).json({ error: 'Settlement record not found' });
      }

      // Check 30-minute undo window (30 * 60 * 1000 ms)
      const createdTime = new Date(settlement.createdAt || settlement.paidAt).getTime();
      const nowTime = new Date().getTime();
      const elapsedMinutes = (nowTime - createdTime) / (1000 * 60);

      if (elapsedMinutes > 30) {
        return res.status(400).json({
          error: `Undo time limit (30 minutes) has expired. (${Math.floor(elapsedMinutes)} minutes elapsed)`
        });
      }

      await col.deleteOne(filter);
      return res.status(200).json({ success: true, message: 'Settlement undone successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/partial-settlements]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
