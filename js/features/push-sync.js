// features/push-sync.js — the ONLY file in the whole client that talks to a
// server. Everything else in the app is still 100% local-first; this module
// is strictly opt-in (off by default, user must flip it on in Settings) and
// syncs the absolute minimum needed to fire a notification: a subscription
// endpoint + a short list of { title, body, dueAt }. No medicine dosage
// history, no money totals, no notes — nothing else ever leaves the device.
//
// Why this exists at all: the in-app checker in notify.js can only fire
// while the app is open (a foreground tab or a backgrounded-but-alive one).
// A real "wake the phone up while the app is fully closed" notification
// requires a server to hold the schedule and a push service to deliver it —
// that's what api/cron/check-due.js + this module together provide.

import { Reminders, Medicine, Settings } from '../storage/db.js';

const SUBID_KEY = 'fk:push_subid';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isEnabled() {
  return !!Settings.get().pushSyncEnabled;
}

/**
 * Turns the feature on: asks for notification permission, subscribes this
 * browser to push, registers the subscription with our backend, then does
 * an initial schedule sync. Returns true on success.
 */
export async function enable(vapidPublicKey) {
  if (!isSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  });

  const res = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() })
  });
  if (!res.ok) return false;

  const { subId } = await res.json();
  localStorage.setItem(SUBID_KEY, subId);
  Settings.set({ pushSyncEnabled: true });
  await syncSchedule();
  return true;
}

/** Turns the feature off and tells the backend to forget this device. */
export async function disable() {
  const subId = localStorage.getItem(SUBID_KEY);
  Settings.set({ pushSyncEnabled: false });
  localStorage.removeItem(SUBID_KEY);

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* best-effort */ }

  if (subId) {
    fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subId })
    }).catch(() => {});
  }
}

// Builds { id, kind, title, body, dueAt } for every future reminder/medicine
// item and pushes the whole list to the server in one call. Cheap enough to
// call after every add/edit/delete — see the call sites in app.js.
export async function syncSchedule() {
  if (!isEnabled()) return;
  const subId = localStorage.getItem(SUBID_KEY);
  if (!subId) return;

  const items = [];
  const now = Date.now();

  Reminders.all().forEach((r) => {
    const dueAt = toEpoch(r.date, r.time);
    if (dueAt && dueAt > now) {
      items.push({ id: r.id, kind: 'reminder', title: r.title, body: r.notes || '', dueAt });
    }
  });

  Medicine.all().forEach((m) => {
    if (m.completed) return;
    const dueAt = toEpoch(todayDateStr(), m.time);
    if (dueAt && dueAt > now) {
      items.push({ id: m.id, kind: 'medicine', title: m.name, body: m.dosage || '', dueAt });
    }
  });

  await fetch('/api/sync-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subId, items })
  }).catch(() => {});
}

function toEpoch(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
