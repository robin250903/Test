// Offline-Cache für die App-Hülle. Bei Änderungen an den Dateien VERSION erhöhen.
const VERSION = 'v4';

importScripts('tree.js', 'idb.js');
const CACHE = `gewohnheiten-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'tree.js',
  'idb.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (damit Updates sofort ankommen), offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

/* ---------- Erinnerungen ---------- */

const pad = (n) => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Der Push selbst enthält keine Daten: Der Text wird erst hier auf dem Gerät aus dem aktuellen Stand berechnet.
self.addEventListener('push', (e) => {
  let slot = 'evening';
  try { slot = e.data?.json()?.slot === 'morning' ? 'morning' : 'evening'; } catch { /* leerer Push */ }
  e.waitUntil((async () => {
    let msg;
    try {
      const s = await Mirror.get('state');
      msg = s ? Tree.reminder(s.habits || [], s.log || {}, todayKey(), slot) : null;
    } catch { msg = null; }
    msg = msg || { title: '🌳 Zeit für deine Gewohnheiten', body: 'Schau nach, wie es deinem Baum geht.' };
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'reminder',
      renotify: true,
      requireInteraction: !!msg.urgent,
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope));
    if (client) return client.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
