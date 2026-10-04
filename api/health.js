import { query } from './lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const rows = await query('SELECT 1 AS ok');
    return res.status(200).json({ ok: Number(rows[0]?.ok || 0) === 1, database: 'turso' });
  } catch (e) {
    return res.status(503).json({ ok: false, database: 'turso', error: 'database_unavailable' });
  }
}
