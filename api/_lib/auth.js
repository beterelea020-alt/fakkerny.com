import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { execute, query } from './db.js';

const SESSION_COOKIE = 'fk_session';
const SESSION_DAYS = 30;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function makePasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const [scheme, salt, stored] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !salt || !stored) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookieHeader(token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${secure ? 'Secure; ' : ''}`.trim();
}

function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${process.env.VERCEL === '1' ? 'Secure; ' : ''}`.trim();
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role || 'user',
    status: row.status || 'active',
    createdAt: Number(row.created_at || 0),
    lastSeenAt: Number(row.last_seen_at || 0)
  };
}

export async function createUser(email, password) {
  const id = randomBytes(12).toString('hex');
  const passwordHash = makePasswordHash(password);
  try {
    await execute(
      'INSERT INTO users (id, email, password_hash, role, status, created_at, last_seen_at, last_sync_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, email, passwordHash, 'user', 'active', Date.now(), Date.now(), 0]
    );
  } catch (e) {
    if (/UNIQUE|unique/i.test(e.message)) throw new Error('EMAIL_EXISTS');
    throw e;
  }
  const rows = await query('SELECT id, email, role, status, created_at, last_seen_at FROM users WHERE id = ?', [id]);
  return sanitizeUser(rows[0]);
}

export async function authenticate(email, password) {
  const rows = await query('SELECT id, email, password_hash, role, status, created_at, last_seen_at FROM users WHERE email = ?', [email]);
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) throw new Error('INVALID_LOGIN');
  if (row.status !== 'active') throw new Error('ACCOUNT_SUSPENDED');
  await execute('UPDATE users SET last_seen_at = ? WHERE id = ?', [Date.now(), row.id]);
  return sanitizeUser({ ...row, last_seen_at: Date.now() });
}

export async function issueSession(userId, res) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const id = randomBytes(12).toString('hex');
  await execute('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [id, userId, tokenHash, now, expiresAt]);
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 24 * 60 * 60));
}

export async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  res.setHeader('Set-Cookie', clearCookieHeader());
}

export async function getUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await query(
    'SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  if (row.status !== 'active') throw new Error('ACCOUNT_SUSPENDED');
  const now = Date.now();
  if (now - Number(row.last_seen_at || 0) > 5 * 60 * 1000) {
    await execute('UPDATE users SET last_seen_at = ? WHERE id = ?', [now, row.id]);
    row.last_seen_at = now;
  }
  return sanitizeUser(row);
}

export async function requireUser(req, res) {
  try {
    const user = await getUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return user;
  } catch (e) {
    if (e.message === 'ACCOUNT_SUSPENDED') {
      res.status(403).json({ error: 'account_suspended' });
      return null;
    }
    throw e;
  }
}

export async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'admin_required' });
    return null;
  }
  return user;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateCredentials(email, password) {
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'اكتب بريد إلكتروني صحيح';
  if (String(password || '').length < 8) return 'كلمة المرور لازم تكون 8 أحرف على الأقل';
  return null;
}
