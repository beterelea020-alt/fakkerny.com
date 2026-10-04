import { requireUser } from './_lib/auth.js';
import { getUsage } from './_lib/limits.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    return res.status(200).json(await getUsage());
  } catch (e) {
    console.error('[usage]', e);
    return res.status(500).json({ error: 'تعذر قراءة الاستخدام' });
  }
}
