// api/unsubscribe.js — POST { subId } -> deletes the subscription + its
// schedule from KV entirely. Called when the user turns the feature off, so
// nothing of theirs is left sitting on the server.

import { deleteSubscription } from './lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { subId } = req.body || {};
  if (!subId) return res.status(400).json({ error: 'missing subId' });

  try {
    await deleteSubscription(subId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[unsubscribe] failed', err);
    return res.status(500).json({ error: 'internal error' });
  }
}
