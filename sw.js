// sw.js — app-shell caching for offline use, plus notification action routing.
// No network calls to any backend happen here or anywhere in the app.

const CACHE_NAME = 'fakkerny-v5';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/core/theme-manager.js',
  'js/storage/db.js',
  'js/utils/date.js',
  'js/utils/parse.js',
  'js/features/notify.js',
  'js/features/render.js',
  'js/features/feedback.js',
  'js/features/cloud.js',
  'js/features/push-sync.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first (so new deployments show up right away), cache as the offline fallback.
// /api/* is never cached: accounts, sync and health must always hit the server.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const fromCache = () => caches.match(event.request).then((c) => c || caches.match('index.html'));
      const timer = setTimeout(() => {
        fromCache().then((c) => { if (c && !settled) { settled = true; resolve(c); } });
      }, 4000);
      fetch(event.request)
        .then((res) => {
          clearTimeout(timer);
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          if (!settled) { settled = true; resolve(res); }
        })
        .catch(() => {
          clearTimeout(timer);
          fromCache().then((c) => { if (!settled) { settled = true; resolve(c || Response.error()); } });
        });
    })
  );
});

// Fires when the backend's cron job sends a real push (see api/cron/check-due.js).
// This is the ONLY code path that can wake the app when it's fully closed —
// everything else in notify.js only works while a tab/instance is open.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* non-JSON payload, ignore */ }

  const title = data.title || 'فَكّرني';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    data: { kind: data.kind, id: data.id },
    actions: data.kind === 'medicine'
      ? [{ action: 'done', title: 'تم' }, { action: 'snooze10', title: 'أجّل 10 دقايق' }]
      : []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action; // '' | 'done' | 'snooze10'
  const data = notification.data || {};
  notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      if (action) {
        clientsArr.forEach((c) => c.postMessage({ type: 'notif-action', action, kind: data.kind, id: data.id }));
      }
      if (clientsArr.length > 0) {
        return clientsArr[0].focus();
      }
      return self.clients.openWindow('./index.html');
    })
  );
});
