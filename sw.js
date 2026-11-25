// Offline support. Everything the app needs is cached on first visit. Online,
// files come fresh from the server; offline, they come from the cache.
// Only this app's own files are ever requested.
// Bump CACHE when the list of files changes.
const CACHE = 'check-in-v7';
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

// Network first, so a new version shows up straight away when online.
// The cache is the fallback that makes the app work offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(req, { ignoreSearch: true })) || cache.match('index.html');
      }
    })
  );
});
