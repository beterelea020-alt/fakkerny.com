// api/subscribe.js — POST { subscription } -> registers a device for push.
// Called once when the user turns on "reminders even when the app is closed"
// in Settings. Returns the subId so the client can reference it later when
// syncing its schedule or unsubscribing.

import { subIdFor, saveSubscription } from './_lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'invalid subscription' });
  }

  try {
    const subId = await subIdFor(subscription.endpoint);
    await saveSubscription(subId, subscription);
    return res.status(200).json({ ok: true, subId });
  } catch (err) {
    console.error('[subscribe] failed', err);
    return res.status(500).json({ error: 'internal error' });
  }
}
