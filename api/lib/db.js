// api/lib/db.js — tiny Turso/libSQL HTTP client for Vercel Functions.
// It intentionally uses fetch() directly so the backend has no native DB
// dependency and runs cleanly on Vercel's serverless runtime.

const rawUrl = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

if (!rawUrl || !authToken) {
  console.warn('[turso] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not configured');
}

function baseUrl() {
  return rawUrl.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');
}

function arg(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value: String(value) };
  }
  return { type: 'text', value: String(value) };
}

function decodeCell(cell) {
  if (!cell) return null;
  if (cell.type === 'null') return null;
  if (cell.type === 'integer') return Number(cell.value);
  if (cell.type === 'float') return Number(cell.value);
  if (cell.type === 'blob') return cell.value;
  return cell.value;
}

function resultRows(result) {
  const columns = result?.response?.result?.cols?.map((c) => c.name) || [];
  const rows = result?.response?.result?.rows || [];
  return rows.map((row) => {
    const out = {};
    row.forEach((cell, index) => { out[columns[index]] = decodeCell(cell); });
    return out;
  });
}

export async function pipeline(statements) {
  if (!rawUrl || !authToken) throw new Error('Turso is not configured');
  const requests = [
    ...statements.map((s) => ({
      type: 'execute',
      stmt: {
        sql: s.sql,
        args: (s.args || []).map(arg)
      }
    })),
    { type: 'close' }
  ];
  const response = await fetch(`${baseUrl()}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ baton: null, requests })
  });

  if (!response.ok) {
    throw new Error(`Turso HTTP ${response.status}`);
  }

  const payload = await response.json();
  for (const item of payload.results || []) {
    if (item.type === 'error') {
      const msg = item.error?.message || 'Turso query failed';
      throw new Error(msg);
    }
  }
  return (payload.results || []).map((item) => item.type === 'ok' ? item : null);
}

export async function query(sql, args = []) {
  const results = await pipeline([{ sql, args }]);
  return resultRows(results[0]);
}

export async function execute(sql, args = []) {
  const results = await pipeline([{ sql, args }]);
  return results[0]?.response?.result || null;
}

export async function scalar(sql, args = [], fallback = null) {
  const rows = await query(sql, args);
  if (!rows.length) return fallback;
  const values = Object.values(rows[0]);
  return values.length ? values[0] : fallback;
}

export async function batch(statements) {
  return pipeline(statements);
}
