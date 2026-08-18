// api/cleaning.js
// Rotating Cleaning Schedule API
//
// Routes (all served through /api/cleaning/...):
//   GET    /api/cleaning/teams          → list all cleaning teams (ordered)
//   POST   /api/cleaning/teams          → create a team (admin only)
//   DELETE /api/cleaning/teams?id=<id>  → delete a team (admin only)
//   GET    /api/cleaning/schedule       → computed schedule + completions + config + teams
//   POST   /api/cleaning/complete       → mark a session done   { sessionKey, teamId }
//   DELETE /api/cleaning/complete       → undo a session done   { sessionKey }
//   GET    /api/cleaning/config         → get schedule config
//   POST   /api/cleaning/config         → save config (admin only) { cleaningDays, startDate }
//
// Rotation model:
//   Each team holds a 2-week BLOCK.
//   Cleaning happens on cleaningDays (default Mon=1, Thu=4) within each block.
//   A 2-week block has 4 sessions (2 days × 2 weeks).
//   Same team returns every (numTeams × 2) weeks.

import { connectToDatabase, setCors, verifyToken } from './_db.js';
import { ObjectId } from 'mongodb';

const DEFAULT_CLEANING_DAYS = [1]; // Monday only (1 cleaning day per week)

function getThisMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function generateSchedule(teams, config, completionMap) {
  if (!teams.length) return [];
  const cleaningDays = [1]; // Exactly 1 cleaning day per week (Monday)
  const startMs      = new Date(config.startDate || getThisMonday()).setHours(0, 0, 0, 0);
  const start        = new Date(startMs);
  const weeksWindow  = Math.max(16, teams.length * 4);
  const end          = new Date(startMs);
  end.setDate(end.getDate() + weeksWindow * 7);

  const sessions = [];
  let sessionGlobalIndex = 0;
  const d = new Date(start);

  while (d <= end) {
    if (cleaningDays.includes(d.getDay())) {
      const key           = d.toISOString().slice(0, 10);
      const daysFromStart = Math.floor((d - start) / (1000 * 60 * 60 * 24));
      const weekNum       = Math.floor(daysFromStart / 7);
      const team          = teams[weekNum % teams.length];
      const completion    = completionMap[key];
      sessions.push({
        sessionKey: key, date: key, team, weekNum,
        sessionIndex: sessionGlobalIndex,
        completed: !!completion,
        doneBy:  completion ? completion.doneBy  : null,
        doneAt:  completion ? completion.doneAt  : null,
      });
      sessionGlobalIndex++;
    }
    d.setDate(d.getDate() + 1);
  }
  return sessions;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlPath = (req.url || '').split('?')[0];
  const action  = urlPath.split('/').filter(Boolean).pop(); // 'teams' | 'schedule' | 'complete' | 'config'

  try {
    const { db } = await connectToDatabase();

    // ─── TEAMS ───────────────────────────────────────────────────
    if (action === 'teams') {
      if (req.method === 'GET') {
        const teams = await db.collection('cleaningTeams').find({}).sort({ order: 1 }).toArray();
        return res.status(200).json(teams.map(({ _id, ...r }) => ({ id: _id.toString(), ...r })));
      }
      if (req.method === 'POST') {
        const user = verifyToken(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized: Please log in' });
        const { name, memberIds, color } = req.body || {};
        if (!name || !Array.isArray(memberIds) || !memberIds.length) {
          return res.status(400).json({ error: 'name and at least one memberId are required' });
        }
        const count = await db.collection('cleaningTeams').countDocuments();
        const doc = { name: name.trim(), memberIds, color: color || '#10b981', order: count, createdAt: new Date() };
        const result = await db.collection('cleaningTeams').insertOne(doc);
        return res.status(201).json({ id: result.insertedId.toString(), ...doc });
      }
      if (req.method === 'DELETE') {
        const user = verifyToken(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized: Please log in' });
        const { id } = req.query;
        if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid team ID' });
        const result = await db.collection('cleaningTeams').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Team not found' });
        return res.status(200).json({ success: true });
      }
    }

    // ─── SCHEDULE ────────────────────────────────────────────────
    if (action === 'schedule' && req.method === 'GET') {
      const teams       = await db.collection('cleaningTeams').find({}).sort({ order: 1 }).toArray();
      const rawConfig   = await db.collection('cleaningConfig').findOne({});
      const config      = rawConfig || { cleaningDays: DEFAULT_CLEANING_DAYS, startDate: getThisMonday() };
      const completions = await db.collection('cleaningCompletions').find({}).toArray();
      const completionMap = {};
      completions.forEach(c => { completionMap[c.sessionKey] = c; });
      const mappedTeams = teams.map(({ _id, ...r }) => ({ id: _id.toString(), ...r }));
      return res.status(200).json({ schedule: generateSchedule(mappedTeams, config, completionMap), config, teams: mappedTeams });
    }

    // ─── COMPLETE ────────────────────────────────────────────────
    if (action === 'complete') {
      if (req.method === 'POST') {
        const user = verifyToken(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized: Please log in' });
        const { sessionKey, teamId } = req.body || {};
        if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
        await db.collection('cleaningCompletions').replaceOne(
          { sessionKey },
          { sessionKey, teamId: teamId || null, doneBy: user.username, doneAt: new Date() },
          { upsert: true }
        );
        return res.status(200).json({ success: true });
      }
      if (req.method === 'DELETE') {
        const user = verifyToken(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized: Please log in' });
        const sessionKey = ((req.body || {}).sessionKey) || ((req.query || {}).sessionKey);
        if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
        await db.collection('cleaningCompletions').deleteOne({ sessionKey });
        return res.status(200).json({ success: true });
      }
    }

    // ─── CONFIG ──────────────────────────────────────────────────
    if (action === 'config') {
      if (req.method === 'GET') {
        const config = await db.collection('cleaningConfig').findOne({});
        return res.status(200).json(config || { cleaningDays: DEFAULT_CLEANING_DAYS, startDate: getThisMonday() });
      }
      if (req.method === 'POST') {
        const user = verifyToken(req);
        if (!user || user.username !== 'admin') return res.status(403).json({ error: 'Admin access only' });
        const { cleaningDays, startDate } = req.body || {};
        if (!Array.isArray(cleaningDays) || !cleaningDays.length || !startDate) {
          return res.status(400).json({ error: 'cleaningDays (array) and startDate are required' });
        }
        await db.collection('cleaningConfig').replaceOne({}, { cleaningDays, startDate }, { upsert: true });
        return res.status(200).json({ success: true });
      }
    }

    return res.status(404).json({ error: `Unknown cleaning endpoint: /${action}` });
  } catch (err) {
    console.error('[/api/cleaning]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
