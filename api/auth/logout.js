import { destroySession } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await destroySession(req, res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[auth/logout]', e);
    res.setHeader('Set-Cookie', 'fk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.status(200).json({ ok: true });
  }
}
