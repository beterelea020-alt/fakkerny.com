// One serverless function for /api/admin/{action,feedback,stats,users}
import action from '../_lib/handlers/admin-action.js';
import feedback from '../_lib/handlers/admin-feedback.js';
import stats from '../_lib/handlers/admin-stats.js';
import users from '../_lib/handlers/admin-users.js';

const ROUTES = { action, feedback, stats, users };

export default async function handler(req, res) {
  const route = String(req.query?.route || '');
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, route) ? ROUTES[route] : null;
  if (!fn) return res.status(404).json({ error: 'not_found' });
  return fn(req, res);
}
