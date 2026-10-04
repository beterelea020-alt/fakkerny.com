// api/lib/push.js — thin wrapper around web-push, shared by every serverless
// function that needs to send a notification. VAPID keys identify our server
// to the browser's push service (they are NOT secrets shared with the client
// beyond the public key, which is safe to expose).
//
// Required environment variables (set in Vercel → Settings → Environment Variables):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT        e.g. "mailto:you@example.com" (contact for push services to reach you)

import webpush from 'web-push';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  // Fails loudly at cold-start instead of silently sending nothing — much
  // easier to debug than a 500 with no explanation three files away.
  console.warn('[push] VAPID keys are not set. Run "npx web-push generate-vapid-keys" and add them as env vars.');
} else {
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

/**
 * Sends one push notification to one subscription.
 * Returns { ok: true } on success, or { ok: false, expired: true } when the
 * push service reports the subscription is gone (410/404) — the caller
 * should delete it from storage so we stop retrying a dead endpoint forever.
 */
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const expired = err.statusCode === 404 || err.statusCode === 410;
    if (!expired) console.error('[push] send failed', err.statusCode, err.body);
    return { ok: false, expired };
  }
}

export { VAPID_PUBLIC_KEY };
