// Offline-Cache für die App-Hülle. Bei Änderungen an den Dateien VERSION erhöhen.
const VERSION = 'v7';

importScripts('tree.js', 'idb.js', 'plan.js');
const CACHE = `gewohnheiten-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'tree.js',
  'idb.js',
  'plan.js',
  'app.js',
  'ablauf.js',
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
const dayKey = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayKey = () => dayKey(0);

/** Morgens den heutigen Ablauf anhängen, abends schon den von morgen. */
function withPlan(msg, plan, slot) {
  const extra = slot === 'morning' ? Plan.summary(plan, dayKey(0), 'Heute') : Plan.summary(plan, dayKey(1), 'Morgen');
  return extra ? { ...msg, body: `${msg.body}\n${extra}` } : msg;
}

// Der Push selbst enthält keine Daten: Der Text wird erst hier auf dem Gerät aus dem aktuellen Stand berechnet.
self.addEventListener('push', (e) => {
  let slot = 'evening';
  try { slot = e.data?.json()?.slot === 'morning' ? 'morning' : 'evening'; } catch { /* leerer Push */ }
  e.waitUntil((async () => {
    let msg;
    try {
      const s = await Mirror.get('state');
      const plan = Plan.normalize(s && s.plan);
      msg = s ? withPlan(Tree.reminder(s.habits || [], s.log || {}, todayKey(), slot, (k) => Plan.todoStatus(plan, k)), plan, slot) : null;
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
