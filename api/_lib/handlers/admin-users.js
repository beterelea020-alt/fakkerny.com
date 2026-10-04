import { requireAdmin } from '../auth.js';
import { query } from '../db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const rows = q
      ? await query(`SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_seen_at, COALESCE(LENGTH(CAST(d.state_json AS BLOB)),0) AS data_bytes FROM users u LEFT JOIN app_data d ON d.user_id = u.id WHERE lower(u.email) LIKE ? ORDER BY u.created_at DESC LIMIT ${limit}`, [`%${q}%`])
      : await query(`SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_seen_at, COALESCE(LENGTH(CAST(d.state_json AS BLOB)),0) AS data_bytes FROM users u LEFT JOIN app_data d ON d.user_id = u.id ORDER BY u.created_at DESC LIMIT ${limit}`);
    return res.status(200).json({ users: rows.map((r) => ({
      id: String(r.id), email: r.email, role: r.role, status: r.status,
      createdAt: Number(r.created_at), lastSeenAt: Number(r.last_seen_at), dataBytes: Number(r.data_bytes || 0)
    })) });
  } catch (e) {
    console.error('[admin/users]', e);
    return res.status(500).json({ error: 'تعذر تحميل المستخدمين' });
  }
}
