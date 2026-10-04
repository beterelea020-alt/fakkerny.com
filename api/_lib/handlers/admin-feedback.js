import { requireAdmin } from '../auth.js';
import { execute, query } from '../db.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const rows = await query(`
        SELECT f.id, f.kind, f.message, f.created_at, f.status, u.email
        FROM feedback f LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC LIMIT 50
      `);
      return res.status(200).json({ feedback: rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, createdAt: Number(r.created_at), status: r.status, email: r.email || 'زائر' })) });
    }
    if (req.method === 'POST') {
      const id = String(req.body?.id || '');
      const status = String(req.body?.status || 'open');
      if (!id || !['open','closed'].includes(status)) return res.status(400).json({ error: 'invalid_feedback_action' });
      await execute('UPDATE feedback SET status = ? WHERE id = ?', [status, id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[admin/feedback]', e);
    return res.status(500).json({ error: 'تعذر إدارة البلاغات' });
  }
}
