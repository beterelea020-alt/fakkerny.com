// features/notify.js — local, on-device reminders. No push server exists (there is no
// backend), so this works by periodically checking due items while the app is open or
// installed and running. That's an intentional, honest limitation of an offline-only app:
// nothing can wake the app up once it is fully closed — only a real push server could do
// that, and this project deliberately has none. What we CAN make rock-solid is the part
// that's actually reachable: while the app is open (foreground or a background tab), a
// due reminder gets both an OS notification and a real, hard-to-miss audio alert.

import { Reminders, Medicine, Money, Habits, HabitLogs, Settings } from '../storage/db.js';
import { todayStr, friendlyTime } from '../utils/date.js';

const CHECK_INTERVAL_MS = 20000;
let timer = null;
let onNotifyItem = null; // callback(item, kind) for in-app toast fallback

/* ---- alert sound -----------------------------------------------------------
   Synthesized with the Web Audio API rather than an embedded audio file: no
   copyrighted ringtone to license, no extra asset to download or precache,
   and it still works fully offline. Two alternating tones repeated three
   times reads as a deliberate "you're being alerted" ring rather than a
   quiet notification blip. */

let audioCtx = null;

function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

// Browsers keep a fresh AudioContext "suspended" until a user gesture unlocks
// it. A reminder can fire minutes or hours after the user last touched the
// screen, with no gesture at that moment — so we unlock it once, early, on
// the first tap/click anywhere in the app, and it stays usable for the rest
// of the session.
export function unlockAudioOnFirstInteraction() {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function tone(ctx, freq, startTime, duration, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

function playAlertSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const ring = (t) => {
      tone(ctx, 880, t, 0.15, 0.22);
      tone(ctx, 660, t + 0.17, 0.18, 0.22);
    };
    ring(now);
    ring(now + 0.55);
    ring(now + 1.1);
  } catch (e) {
    console.warn('notify: alert sound failed', e);
  }
}

function soundEnabled() {
  const s = Settings.get();
  return s.notificationsEnabled && s.notificationSound !== false;
}

export function initNotifications(callback) {
  onNotifyItem = callback;
  unlockAudioOnFirstInteraction();
  if (timer) clearInterval(timer);
  timer = setInterval(checkDue, CHECK_INTERVAL_MS);
  checkDue();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDue();
  });
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    const res = await Notification.requestPermission();
    return res;
  } catch (e) {
    return 'denied';
  }
}

function canNotify() {
  return Settings.get().notificationsEnabled && 'Notification' in window && Notification.permission === 'granted';
}

async function fire(title, body, tag, data) {
  if (soundEnabled()) playAlertSound();
  if (canNotify()) {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, {
            body,
            tag,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            dir: 'rtl',
            lang: 'ar',
            requireInteraction: true,
            silent: false,
            data,
            actions: data && data.kind === 'medicine'
              ? [{ action: 'done', title: 'تم' }, { action: 'snooze10', title: 'تأجيل 10 دقائق' }]
              : []
          });
          return;
        }
      }
      new Notification(title, { body, tag, icon: 'icons/icon-192.png', dir: 'rtl', lang: 'ar', silent: false });
    } catch (e) {
      console.warn('notify failed', e);
    }
  }
  if (onNotifyItem) onNotifyItem({ title, body, tag, data });
}

function minutesUntil(dateStr, timeStr) {
  const now = new Date();
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const target = new Date(dateStr + 'T00:00:00');
  target.setHours(h, m, 0, 0);
  return Math.round((target - now) / 60000);
}

function markNotified(collection, item, field) {
  collection.update(item.id, { [field]: Date.now() });
}

function checkDue() {
  const today = todayStr();

  Reminders.all().forEach((r) => {
    if (r.completed || r.date !== today) return;
    const mins = minutesUntil(r.date, r.time);
    if (mins <= 30 && mins >= 0 && !r._notified30) {
      fire('موعد مهم', `لديك «${r.title}» بعد ${mins <= 1 ? 'لحظات' : mins + ' دقيقة'}`, 'reminder-' + r.id, { kind: 'reminder', id: r.id });
      markNotified(Reminders, r, '_notified30');
    }
  });

  Medicine.all().forEach((med) => {
    if (med.completed) return;
    const mins = minutesUntil(today, med.time);
    if (mins <= 0 && mins >= -2 && !med._notifiedToday) {
      fire('وقت الدواء 💊', `حان الآن موعد ${med.name} — ${med.dosage || ''}`.trim(), 'med-' + med.id, { kind: 'medicine', id: med.id });
      markNotified(Medicine, med, '_notifiedToday');
    }
    // reset the daily flag after midnight passes (compare stored date)
    if (med._notifiedDate !== today) {
      Medicine.update(med.id, { _notifiedToday: false, _notifiedDate: today });
    }
  });

  Money.all().forEach((m) => {
    if (m.status === 'paid' || !m.dueDate) return;
    if (m.dueDate === today && !m._notifiedDue) {
      const label = m.type === 'owe' ? `متبقي اليوم لدفع ${m.amount} ج.م لـ ${m.title}` : `اليوم موعد استلام ${m.amount} ج.م من ${m.title}`;
      fire('تذكير مالي 💰', label, 'money-' + m.id, { kind: 'money', id: m.id });
      markNotified(Money, m, '_notifiedDue');
    }
  });

  Habits.all().forEach((h) => {
    if (!h.reminder || !h.time) return;
    const mins = minutesUntil(today, h.time);
    const doneToday = HabitLogs.isDone(h.id, today);
    if (mins <= 0 && mins >= -5 && !doneToday && h._notifiedDate !== today) {
      fire('عادة اليوم 🔁', `لسه ما سجلتش «${h.title}» النهارده 💪`, 'habit-' + h.id, { kind: 'habit', id: h.id });
      Habits.update(h.id, { _notifiedDate: today });
    }
  });
}

export { fire as sendNotification };
