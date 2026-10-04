import { requireAdmin } from '../lib/auth.js';
import { getUsage } from '../lib/limits.js';
import { query } from '../lib/db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const [usage, extra] = await Promise.all([
      getUsage(),
      query("SELECT (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins, (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS sessions", [Date.now()])
    ]);
    return res.status(200).json({ ...usage, admins: Number(extra[0]?.admins || 0), activeSessions: Number(extra[0]?.sessions || 0) });
  } catch (e) {
    console.error('[admin/stats]', e);
    return res.status(500).json({ error: 'تعذر تحميل إحصائيات الإدارة' });
  }
}
