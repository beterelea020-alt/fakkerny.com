import { authenticate, issueSession, normalizeEmail } from '../auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'اكتب البريد وكلمة المرور' });
    const user = await authenticate(email, password);
    await issueSession(user.id, res);
    return res.status(200).json({ ok: true, user });
  } catch (e) {
    if (e.message === 'INVALID_LOGIN') return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة' });
    if (e.message === 'ACCOUNT_SUSPENDED') return res.status(403).json({ error: 'الحساب موقوف حاليًا. تواصل مع الإدارة.' });
    console.error('[auth/login]', e);
    return res.status(500).json({ error: 'تعذر تسجيل الدخول حاليًا' });
  }
}
