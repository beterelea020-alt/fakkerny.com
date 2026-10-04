// Usage after creating an account:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/make-admin.mjs you@example.com
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/make-admin.mjs you@example.com');
  process.exit(1);
}

const url = (process.env.TURSO_DATABASE_URL || '').replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');
const token = process.env.TURSO_AUTH_TOKEN || '';
if (!url || !token) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
  process.exit(1);
}

const response = await fetch(`${url}/v2/pipeline`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'UPDATE users SET role = ? WHERE email = ?', args: [{ type: 'text', value: 'admin' }, { type: 'text', value: email }] } }] })
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
console.log(`Admin role applied for ${email}`);
