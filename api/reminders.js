import { connectToDatabase, verifyToken, setCors } from './_db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();

    // ── GET: Fetch reminders, settlement notifications & admin announcements ────
    if (req.method === 'GET') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const members = await db.collection('members').find({}).toArray();
      const currentUserMember = members.find(m => m.name.toLowerCase() === user.username.toLowerCase());
      const currentMemberId = currentUserMember ? (currentUserMember.id || currentUserMember._id.toString()) : null;

      const currentMonth = new Date().toISOString().slice(0, 7);
      const expenses = await db.collection('expenses').find({ month: currentMonth }).toArray();

      const now = new Date();
      const reminders = [];

      // 1. Overdue payment reminders (7-day + 5-day cycle)
      if (currentMemberId) {
        expenses.forEach(exp => {
          const isSplit = exp.splitAmong && exp.splitAmong.includes(currentMemberId);
          const isPayer = exp.paidBy === currentMemberId;

          if (isSplit && !isPayer) {
            const expDate = new Date(exp.date);
            const daysDiff = Math.floor((now - expDate) / (1000 * 60 * 60 * 24));

            if (daysDiff >= 7 && (daysDiff - 7) % 5 === 0) {
              const payer = members.find(m => (m.id || m._id.toString()) === exp.paidBy);
              const payerName = payer ? payer.name : 'Housemate';
              const share = Math.round((exp.amount / exp.splitAmong.length) * 100) / 100;

              reminders.push({
                type: 'overdue_payment',
                id: exp.id || exp._id.toString(),
                title: '⏰ Payment Overdue',
                message: `You owe ${payerName} LKR ${share.toFixed(2)} for "${exp.description}" (${daysDiff} days ago)`,
                share,
                payerName,
                daysOverdue: daysDiff,
                date: exp.date
              });
            }
          }
        });
      }

      // 2. Personal Settlement Notifications
      let userNotifs = [];
      if (currentMemberId) {
        userNotifs = await db.collection('notifications')
          .find({ targetMemberId: currentMemberId })
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray();
      }

      // 3. Admin Announcements
      const announcements = await db.collection('announcements')
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // Combine all notifications
      const combined = [
        ...announcements.map(a => ({
          type: 'announcement',
          id: a._id ? a._id.toString() : a.id,
          title: a.title || '📢 Admin Announcement',
          message: a.message,
          createdAt: a.createdAt,
          by: a.createdByName || 'Admin'
        })),
        ...userNotifs.map(n => ({
          type: 'settlement_received',
          id: n._id ? n._id.toString() : n.id,
          title: n.title || '💰 Payment Received',
          message: n.message,
          createdAt: n.createdAt
        })),
        ...reminders
      ];

      return res.status(200).json({
        reminders: combined,
        overdueCount: reminders.length + userNotifs.filter(n => !n.read).length + announcements.length,
        isAdmin: user.username.toLowerCase() === 'admin'
      });
    }

    // ── POST: Admin Broadcast Announcement (Only Admin) ─────────────────────
    if (req.method === 'POST') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      if (user.username.toLowerCase() !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Only Admin can send announcements' });
      }

      const { title, message } = req.body;
      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Announcement message is required' });
      }

      const doc = {
        title: title || '📢 Special House Announcement',
        message: message.trim(),
        createdAt: new Date(),
        createdByName: 'Admin'
      };

      const result = await db.collection('announcements').insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Reminders API error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
