// api/expenses.js
// GET    /api/expenses           → list all expenses (optional ?month=YYYY-MM)
// POST   /api/expenses           → create a new expense
// PUT    /api/expenses?id=<id>   → update an expense
// DELETE /api/expenses?id=<id>   → delete an expense

import { connectToDatabase, setCors, verifyToken } from './_db.js';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();
    const col    = db.collection('expenses');

    // ── GET: list expenses ─────────────────────────────────────────────
    if (req.method === 'GET') {
      const query = {};
      if (req.query.month) query.month = req.query.month;
      const expenses = await col.find(query).sort({ date: -1 }).toArray();
      const out = expenses.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));
      return res.status(200).json(out);
    }

    // ── POST: create expense ───────────────────────────────────────────
    if (req.method === 'POST') {
      const payload = verifyToken(req);
      if (!payload) return res.status(401).json({ error: 'Unauthorized: Please log in' });
      const { description, amount, paidBy, splitAmong, category, date } = req.body;
      if (!description || !amount || !paidBy || !splitAmong?.length || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number' });
      }
      const month = date.slice(0, 7);
      const doc = { description: description.trim(), amount, paidBy, splitAmong, category: category || 'Other', date, month, createdBy: payload.username, createdAt: new Date() };
      const result = await col.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    }

    // Helper: check if caller can modify/delete expense
    async function canModify(payload, exp) {
      if (!payload || !payload.username) return false;
      if (payload.username.toLowerCase() === 'admin') return true;
      if (exp.createdBy && exp.createdBy.toLowerCase() === payload.username.toLowerCase()) return true;
      const user = await db.collection('users').findOne({ username: { $regex: new RegExp(`^${payload.username}$`, 'i') } });
      if (user && user._id.toString() === exp.paidBy) return true;
      return false;
    }

    // ── PUT: update expense by ?id ─────────────────────────────────────
    if (req.method === 'PUT') {
      const payload = verifyToken(req);
      if (!payload) return res.status(401).json({ error: 'Unauthorized: Please log in' });
      const { id } = req.query;
      if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid expense ID' });

      const existing = await col.findOne({ _id: new ObjectId(id) });
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (!(await canModify(payload, existing))) {
        return res.status(403).json({ error: 'Forbidden: Only the person who added this expense can edit it' });
      }

      const { description, amount, paidBy, splitAmong, category, date } = req.body;
      if (!description || !amount || !paidBy || !splitAmong?.length || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const month = date.slice(0, 7);
      const result = await col.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { description: description.trim(), amount, paidBy, splitAmong, category: category || 'Other', date, month, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Expense not found' });
      const { _id, ...rest } = result;
      return res.status(200).json({ id: _id.toString(), ...rest });
    }

    // ── DELETE: delete expense by ?id ──────────────────────────────────
    if (req.method === 'DELETE') {
      const payload = verifyToken(req);
      if (!payload) return res.status(401).json({ error: 'Unauthorized: Please log in' });
      const { id } = req.query;
      if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid expense ID' });

      const existing = await col.findOne({ _id: new ObjectId(id) });
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (!(await canModify(payload, existing))) {
        return res.status(403).json({ error: 'Forbidden: Only the person who added this expense can delete it' });
      }

      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Expense not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[/api/expenses]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
