// api/expenses/[[...slug]].js
// GET    /api/expenses            → list all expenses (optional ?month=YYYY-MM)
// POST   /api/expenses            → create a new expense
// PUT    /api/expenses/:id        → update an expense
// DELETE /api/expenses/:id        → delete an expense

import { connectToDatabase, setCors, verifyToken } from '../_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // slug is undefined for /api/expenses, or ['id'] for /api/expenses/:id
  const id = req.query.slug?.[0] ?? null;

  try {
    const { db } = await connectToDatabase();
    const col    = db.collection('expenses');

    // ── No ID: collection routes ─────────────────────────────────────────
    if (!id) {
      // GET: list expenses (optional ?month filter)
      if (req.method === 'GET') {
        const query = {};
        if (req.query.month) query.month = req.query.month; // e.g. "2026-07"
        const expenses = await col.find(query).sort({ date: -1 }).toArray();
        const out = expenses.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));
        return res.status(200).json(out);
      }

      // POST: create expense — requires a valid login token
      if (req.method === 'POST') {
        if (!verifyToken(req)) {
          return res.status(401).json({ error: 'Unauthorized: Please log in' });
        }
        const { description, amount, paidBy, splitAmong, category, date } = req.body;

        if (!description || !amount || !paidBy || !splitAmong?.length || !date) {
          return res.status(400).json({ error: 'Missing required fields' });
        }
        if (typeof amount !== 'number' || amount <= 0) {
          return res.status(400).json({ error: 'Amount must be a positive number' });
        }

        const month = date.slice(0, 7); // "YYYY-MM"
        const doc = {
          description: description.trim(),
          amount,
          paidBy,
          splitAmong,
          category: category || 'Other',
          date,
          month,
          createdAt: new Date(),
        };

        const result = await col.insertOne(doc);
        return res.status(201).json({ id: result.insertedId.toString(), ...doc });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── With ID: item routes ─────────────────────────────────────────────
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid expense ID' });
    }

    if (!verifyToken(req)) {
      return res.status(401).json({ error: 'Unauthorized: Please log in' });
    }

    const oid = new ObjectId(id);

    // PUT: update expense
    if (req.method === 'PUT') {
      const { description, amount, paidBy, splitAmong, category, date } = req.body;

      if (!description || !amount || !paidBy || !splitAmong?.length || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const month = date.slice(0, 7);
      const update = {
        $set: {
          description: description.trim(),
          amount,
          paidBy,
          splitAmong,
          category: category || 'Other',
          date,
          month,
          updatedAt: new Date(),
        }
      };

      const result = await col.findOneAndUpdate(
        { _id: oid },
        update,
        { returnDocument: 'after' }
      );

      if (!result) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      const { _id, ...rest } = result;
      return res.status(200).json({ id: _id.toString(), ...rest });
    }

    // DELETE: remove expense
    if (req.method === 'DELETE') {
      const result = await col.deleteOne({ _id: oid });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Expense not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/expenses]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
