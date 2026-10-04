// One serverless function for /api/auth/{login,logout,me,register}
import login from '../_lib/handlers/auth-login.js';
import logout from '../_lib/handlers/auth-logout.js';
import me from '../_lib/handlers/auth-me.js';
import register from '../_lib/handlers/auth-register.js';

const ROUTES = { login, logout, me, register };

export default async function handler(req, res) {
  const route = String(req.query?.route || '');
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, route) ? ROUTES[route] : null;
  if (!fn) return res.status(404).json({ error: 'not_found' });
  return fn(req, res);
}
