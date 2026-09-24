const CACHE_NAME = 'spindex-cache-v18';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/js/sync.js',
  '/js/crate.js',
  '/js/notes.js',
  '/js/wiki.js',
  '/js/discogs.js',
  '/js/vinyl.js',
  '/js/values.js',
  '/js/limiter.js',
  '/js/external.js',
  '/js/years.js',
  '/js/syncplan.js',
  '/js/stats.js',
  '/js/statsview.js',
  '/js/mock-data.js',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Server functions (Discogs sign-in, the Discogs proxy) carry per-user data: never cache them
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  // Network-first for application core assets to prevent stale dev / update caching
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('/index.html') : undefined)))
  );
});
