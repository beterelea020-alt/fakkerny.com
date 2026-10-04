// Push storage, backed by the same Turso database as the application.
import { execute, query } from './db.js';

export async function subIdFor(endpoint) {
  const enc = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function saveSubscription(subId, subscription) {
  await execute(
    'INSERT INTO push_subscriptions (sub_id, subscription_json, created_at) VALUES (?, ?, ?) ON CONFLICT(sub_id) DO UPDATE SET subscription_json = excluded.subscription_json',
    [subId, JSON.stringify(subscription), Date.now()]
  );
}

export async function deleteSubscription(subId) {
  await execute('DELETE FROM push_schedules WHERE sub_id = ?', [subId]);
  await execute('DELETE FROM push_subscriptions WHERE sub_id = ?', [subId]);
}

export async function getSubscription(subId) {
  const rows = await query('SELECT subscription_json FROM push_subscriptions WHERE sub_id = ?', [subId]);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].subscription_json); } catch { return null; }
}

export async function saveSchedule(subId, items) {
  await execute(
    'INSERT INTO push_schedules (sub_id, schedule_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(sub_id) DO UPDATE SET schedule_json = excluded.schedule_json, updated_at = excluded.updated_at',
    [subId, JSON.stringify(items), Date.now()]
  );
}

export async function getSchedule(subId) {
  const rows = await query('SELECT schedule_json FROM push_schedules WHERE sub_id = ?', [subId]);
  if (!rows[0]) return [];
  try { return JSON.parse(rows[0].schedule_json) || []; } catch { return []; }
}

export async function allSubIds() {
  const rows = await query('SELECT sub_id FROM push_subscriptions');
  return rows.map((r) => String(r.sub_id));
}
