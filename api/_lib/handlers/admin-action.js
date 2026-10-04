import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../auth.js';
import { execute, query } from '../db.js';

const ACTIONS = new Set(['suspend', 'activate', 'make-admin', 'remove-admin', 'delete-data']);

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const action = String(req.body?.action || '');
  const userId = String(req.body?.userId || '');
  if (!ACTIONS.has(action) || !userId) return res.status(400).json({ error: 'invalid_action' });
  if (userId === admin.id && ['suspend', 'remove-admin', 'delete-data'].includes(action)) {
    return res.status(400).json({ error: 'لا يمكنك تنفيذ الإجراء ده على حسابك' });
  }

  try {
    const targetRows = await query('SELECT id, role, status FROM users WHERE id = ?', [userId]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (action === 'suspend') {
      await execute('UPDATE users SET status = ? WHERE id = ?', ['suspended', userId]);
      await execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    } else if (action === 'activate') {
      await execute('UPDATE users SET status = ? WHERE id = ?', ['active', userId]);
    } else if (action === 'make-admin') {
      await execute('UPDATE users SET role = ? WHERE id = ?', ['admin', userId]);
    } else if (action === 'remove-admin') {
      const countRows = await query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'");
      if (Number(countRows[0]?.c || 0) <= 1) return res.status(400).json({ error: 'لا يمكن إزالة آخر مدير نشط' });
      await execute('UPDATE users SET role = ? WHERE id = ?', ['user', userId]);
    } else if (action === 'delete-data') {
      await execute('DELETE FROM app_data WHERE user_id = ?', [userId]);
    }

    await execute('INSERT INTO audit_logs (id, actor_user_id, action, target_user_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      randomBytes(12).toString('hex'), admin.id, action, userId, JSON.stringify({}), Date.now()
    ]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[admin/action]', e);
    return res.status(500).json({ error: 'فشل تنفيذ الإجراء الإداري' });
  }
}
