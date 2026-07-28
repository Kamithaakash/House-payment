// api/partial-settlements.js
// GET  /api/partial-settlements?month=YYYY-MM  → list individual payments for a month
// POST /api/partial-settlements                → record one person paying another

import { connectToDatabase, setCors, verifyToken } from './_db.js';

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
      if (!verifyToken(req)) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
      }
      const { month, from, to, amount, paidAt } = req.body;
      if (!month || !from || !to || !amount) {
        return res.status(400).json({ error: 'month, from, to, amount are required' });
      }
      const doc = {
        month,
        from,
        to,
        amount,
        paidAt: paidAt || new Date().toISOString(),
        createdAt: new Date(),
      };
      const result = await col.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/partial-settlements]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
