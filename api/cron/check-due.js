// api/cron/check-due.js — the heartbeat of the whole push system.
// Vercel Cron hits this endpoint on a schedule (see vercel.json). Each run:
//   1. reads every known subscription id
//   2. loads its schedule
//   3. finds items whose dueAt has passed but weren't sent yet
//   4. sends a push for each, then removes it from the schedule (one-shot —
//      the client is the source of truth and will re-sync recurring items
//      with their next dueAt on its own)
//   5. if a push comes back "expired" (user uninstalled / blocked
//      notifications), the dead subscription is deleted so we stop wasting
//      cron time on it forever.
//
// Protected by CRON_SECRET so randoms on the internet can't trigger it and
// drain your push quota — Vercel Cron sends this automatically as a bearer
// token when CRON_SECRET is set as an env var.

import { allSubIds, getSubscription, getSchedule, saveSchedule, deleteSubscription } from '../_lib/store.js';
import { sendPush } from '../_lib/push.js';

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const now = Date.now();
  const subIds = await allSubIds();
  let sent = 0;
  let pruned = 0;

  for (const subId of subIds) {
    const [subscription, schedule] = await Promise.all([getSubscription(subId), getSchedule(subId)]);
    if (!subscription) { pruned++; continue; }

    const due = schedule.filter((it) => it.dueAt <= now);
    if (due.length === 0) continue;

    let subscriptionDead = false;
    for (const item of due) {
      const result = await sendPush(subscription, {
        title: item.title,
        body: item.body,
        kind: item.kind,
        id: item.id
      });
      if (result.ok) sent++;
      if (result.expired) { subscriptionDead = true; break; }
    }

    if (subscriptionDead) {
      await deleteSubscription(subId);
      pruned++;
    } else {
      const remaining = schedule.filter((it) => it.dueAt > now);
      await saveSchedule(subId, remaining);
    }
  }

  return res.status(200).json({ ok: true, checked: subIds.length, sent, pruned });
}
