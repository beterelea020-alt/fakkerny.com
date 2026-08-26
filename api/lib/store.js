// api/lib/store.js — persistence layer for push data, backed by Vercel KV
// (Redis-compatible). This is the ONLY server-side data store in the whole
// project, and it deliberately holds the minimum needed to fire a
// notification: a push subscription + a list of {when, title, body}. It does
// NOT store medicine names, money amounts, notes, or anything else — that
// stays exactly where it always has, in the user's own localStorage.
//
// Requires the "Vercel KV" integration to be added to the project (Vercel
// dashboard → Storage → Create Database → KV). Vercel injects the KV_* env
// vars automatically once it's connected — nothing to configure by hand.

import { kv } from '@vercel/kv';

const SUB_PREFIX = 'sub:';       // sub:<subId>        -> { subscription, createdAt }
const SCHEDULE_PREFIX = 'sched:'; // sched:<subId>       -> [ { id, kind, title, body, dueAt, sentAt, recurring } ]
const INDEX_KEY = 'sub-index';    // Set of all known subIds, so the cron job doesn't have to KEYS-scan.

// Deterministic id from a subscription's endpoint URL — same device/browser
// always maps to the same key, so re-subscribing just overwrites cleanly
// instead of piling up duplicates.
export async function subIdFor(endpoint) {
  const enc = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function saveSubscription(subId, subscription) {
  await kv.set(SUB_PREFIX + subId, { subscription, createdAt: Date.now() });
  await kv.sadd(INDEX_KEY, subId);
}

export async function deleteSubscription(subId) {
  await kv.del(SUB_PREFIX + subId);
  await kv.del(SCHEDULE_PREFIX + subId);
  await kv.srem(INDEX_KEY, subId);
}

export async function getSubscription(subId) {
  const rec = await kv.get(SUB_PREFIX + subId);
  return rec ? rec.subscription : null;
}

export async function saveSchedule(subId, items) {
  // items is the full, replace-in-one-shot list the client currently has
  // due in the future — simplest possible sync model, no incremental diffs
  // to get out of sync with.
  await kv.set(SCHEDULE_PREFIX + subId, items);
}

export async function getSchedule(subId) {
  return (await kv.get(SCHEDULE_PREFIX + subId)) || [];
}

export async function allSubIds() {
  return (await kv.smembers(INDEX_KEY)) || [];
}
