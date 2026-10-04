import { assertCanCreateUser } from '../lib/limits.js';
import { createUser, issueSession, normalizeEmail, validateCredentials } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const validation = validateCredentials(email, password);
    if (validation) return res.status(400).json({ error: validation });

    await assertCanCreateUser();
    const user = await createUser(email, password);
    await issueSession(user.id, res);
    return res.status(201).json({ ok: true, user });
  } catch (e) {
    if (e.message === 'EMAIL_EXISTS') return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
    if (e.message === 'MAX_USERS_REACHED') return res.status(429).json({ error: 'وصلنا للحد المجاني لعدد الحسابات حاليًا' });
    console.error('[auth/register]', e);
    return res.status(500).json({ error: 'تعذر إنشاء الحساب حاليًا' });
  }
}
