import { randomBytes } from 'node:crypto';
import { execute } from './_lib/db.js';
import { getUser } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await getUser(req);
    const kind = String(req.body?.kind || 'review');
    const message = String(req.body?.message || '').trim();
    if (!['bug', 'feature', 'review'].includes(kind)) return res.status(400).json({ error: 'invalid_feedback_type' });
    if (!message || message.length > 3000) return res.status(400).json({ error: 'invalid_message' });

    await execute(
      'INSERT INTO feedback (id, user_id, kind, message, created_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      [randomBytes(12).toString('hex'), user?.id || null, kind, message, Date.now(), 'open']
    );
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[feedback]', e);
    return res.status(500).json({ error: 'تعذر حفظ البلاغ' });
  }
}
