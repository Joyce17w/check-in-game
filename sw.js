// Offline support. Everything the app needs is cached on first visit and
// served from the cache afterwards, refreshing quietly in the background when
// there is a connection. Only this app's own files are ever requested.
// Bump CACHE when the list of files changes.
const CACHE = 'check-in-v3';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'cards.json',
  'manifest.webmanifest',
  'js/cards.default.js',
  'js/engine.js',
  'js/app.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (cached) {
        fresh.catch(() => {});
        return cached;
      }
      return fresh.catch(() => cache.match('index.html'));
    })
  );
});
