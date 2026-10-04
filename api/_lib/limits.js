import { query } from './db.js';

export const LIMITS = {
  maxUsers: Number(process.env.FREE_MAX_USERS || 1000),
  maxUserStateBytes: Number(process.env.FREE_MAX_USER_DATA_BYTES || 5 * 1024 * 1024),
  maxTotalStateBytes: Number(process.env.FREE_MAX_TOTAL_DATA_BYTES || 4.5 * 1024 * 1024 * 1024),
  minSyncIntervalMs: Number(process.env.FREE_MIN_SYNC_INTERVAL_MS || 10000)
};

export async function getUsage() {
  const rows = await query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*) FROM app_data) AS synced_users,
      (SELECT COALESCE(SUM(LENGTH(CAST(state_json AS BLOB))), 0) FROM app_data) AS data_bytes,
      (SELECT COUNT(*) FROM feedback) AS feedback_count
  `);
  const row = rows[0] || {};
  return {
    users: Number(row.users || 0),
    activeUsers: Number(row.active_users || 0),
    syncedUsers: Number(row.synced_users || 0),
    dataBytes: Number(row.data_bytes || 0),
    feedbackCount: Number(row.feedback_count || 0),
    limits: LIMITS,
    dataPercent: Math.min(100, (Number(row.data_bytes || 0) / LIMITS.maxTotalStateBytes) * 100),
    userPercent: Math.min(100, (Number(row.users || 0) / LIMITS.maxUsers) * 100)
  };
}

export async function assertCanCreateUser() {
  const row = await query('SELECT COUNT(*) AS count FROM users');
  const count = Number(row[0]?.count || 0);
  if (count >= LIMITS.maxUsers) throw new Error('MAX_USERS_REACHED');
}

export function bytesOfJson(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export async function assertCanStoreState(userId, state) {
  const bytes = bytesOfJson(state);
  if (bytes > LIMITS.maxUserStateBytes) throw new Error('USER_DATA_LIMIT');

  const rows = await query(
    'SELECT COALESCE(SUM(LENGTH(CAST(state_json AS BLOB))), 0) AS total FROM app_data WHERE user_id <> ?',
    [userId]
  );
  const otherBytes = Number(rows[0]?.total || 0);
  if (otherBytes + bytes > LIMITS.maxTotalStateBytes) throw new Error('TOTAL_DATA_LIMIT');
  return bytes;
}
