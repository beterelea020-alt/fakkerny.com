// api/sync-schedule.js — POST { subId, items } -> replaces the server's copy
// of "what's due and when" for this device. The client calls this whenever a
// reminder/medicine item is added, edited, deleted, or completed, so the
// server's view never drifts far from the truth for long.
//
// `items` is intentionally minimal: only what's needed to word a
// notification, never the full record. Shape:
//   [{ id, kind, title, body, dueAt }]   // dueAt = epoch ms
//
// A hard cap keeps one misbehaving client from writing an unbounded payload.

import { saveSchedule } from './lib/store.js';

const MAX_ITEMS = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { subId, items } = req.body || {};
  if (!subId || !Array.isArray(items)) return res.status(400).json({ error: 'invalid payload' });

  const clean = items
    .filter((it) => it && typeof it.dueAt === 'number' && it.title)
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      id: String(it.id || ''),
      kind: String(it.kind || 'reminder'),
      title: String(it.title).slice(0, 120),
      body: String(it.body || '').slice(0, 200),
      dueAt: it.dueAt
    }));

  try {
    await saveSchedule(subId, clean);
    return res.status(200).json({ ok: true, count: clean.length });
  } catch (err) {
    console.error('[sync-schedule] failed', err);
    return res.status(500).json({ error: 'internal error' });
  }
}
