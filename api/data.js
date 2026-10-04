import { execute, query } from './lib/db.js';
import { requireUser } from './lib/auth.js';
import { assertCanStoreState, LIMITS } from './lib/limits.js';

function isValidState(state) {
  return state && typeof state === 'object' && state.data && typeof state.data === 'object';
}

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const rows = await query('SELECT state_json, updated_at, version FROM app_data WHERE user_id = ?', [user.id]);
      if (!rows[0]) return res.status(200).json({ exists: false, state: null });
      return res.status(200).json({
        exists: true,
        state: JSON.parse(rows[0].state_json),
        updatedAt: Number(rows[0].updated_at),
        version: Number(rows[0].version || 1)
      });
    }

    if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
    const state = req.body?.state;
    if (!isValidState(state)) return res.status(400).json({ error: 'invalid_state' });

    const now = Date.now();
    const current = await query('SELECT last_sync_at FROM users WHERE id = ?', [user.id]);
    const lastSync = Number(current[0]?.last_sync_at || 0);
    if (now - lastSync < LIMITS.minSyncIntervalMs && user.role !== 'admin') {
      return res.status(429).json({ error: 'sync_rate_limited', retryAfterMs: LIMITS.minSyncIntervalMs - (now - lastSync) });
    }

    const bytes = await assertCanStoreState(user.id, state);
    const stateJson = JSON.stringify(state);
    await execute(`
      INSERT INTO app_data (user_id, state_json, updated_at, version)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        version = app_data.version + 1
    `, [user.id, stateJson, now]);
    await execute('UPDATE users SET last_sync_at = ?, last_seen_at = ? WHERE id = ?', [now, now, user.id]);

    return res.status(200).json({ ok: true, updatedAt: now, bytes, maxUserDataBytes: LIMITS.maxUserStateBytes });
  } catch (e) {
    if (e.message === 'USER_DATA_LIMIT') return res.status(413).json({ error: 'حجم بيانات الحساب تجاوز الحد المجاني المسموح به', maxBytes: LIMITS.maxUserStateBytes });
    if (e.message === 'TOTAL_DATA_LIMIT') return res.status(507).json({ error: 'مساحة التخزين المجانية للتطبيق قاربت الامتلاء. امسح بيانات قديمة أو ارفع الخطة.' });
    console.error('[data]', e);
    return res.status(500).json({ error: 'تعذر حفظ بياناتك حاليًا' });
  }
}
