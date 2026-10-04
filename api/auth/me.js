import { getUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await getUser(req);
    return res.status(200).json({ user });
  } catch (e) {
    if (e.message === 'ACCOUNT_SUSPENDED') return res.status(403).json({ error: 'account_suspended' });
    console.error('[auth/me]', e);
    return res.status(500).json({ error: 'تعذر التحقق من الجلسة' });
  }
}
