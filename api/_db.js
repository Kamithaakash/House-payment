// api/_db.js
// Shared MongoDB connection helper.
// Caches the MongoClient across warm lambda invocations.

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const DB_NAME = 'boardmates';
const SECRET  = process.env.TOKEN_SECRET || process.env.MONGODB_URI || 'house-bills-secret-2026';

let cachedClient = null;
let cachedDb     = null;

export async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing in Vercel settings.');
  }

  try {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    const db = client.db(DB_NAME);

    cachedClient = client;
    cachedDb     = db;

    return { client, db };
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    throw err;
  }
}

// CORS headers for all API responses
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Shared token verification — returns the decoded payload or null
export function verifyToken(req) {
  const auth  = req.headers['authorization'] || '';
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

