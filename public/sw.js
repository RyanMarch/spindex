const CACHE_NAME = 'spindex-cache-v49';
// Covers and photos live in their own cache: it outlives app updates, so browsing offline (and reopening the app) doesn't
// fetch every sleeve again. Bounded, so it can't grow without limit.
const IMAGE_CACHE = 'spindex-images-v1';
const MAX_IMAGES = 600;
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/js/sync.js',
  '/js/crate.js',
  '/js/browse.js',
  '/js/search.js',
  '/js/updates.js',
  '/js/filters.js',
  '/js/emptystate.js',
  '/js/welcome.js',
  '/js/share.js',
  '/js/wall.js',
  '/js/jobs.js',
  '/js/notes.js',
  '/js/wiki.js',
  '/js/discogs.js',
  '/js/vinyl.js',
  '/js/values.js',
  '/js/limiter.js',
  '/js/imagematch.js',
  '/js/artwork.js',
  '/js/external.js',
  '/js/years.js',
  '/js/syncplan.js',
  '/js/stats.js',
  '/js/statsview.js',
  '/js/lyrics.js',
  '/js/lyrics-drawer.js',
  '/js/health.js',
  '/js/sourcestats.js',
  '/js/mock-data.js',
  '/js/barcode.js',
  '/js/scanner-drawer.js',
  '/terms.html',
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
        keys.filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Server functions (Discogs sign-in, the Discogs proxy) carry per-user data: never cache them
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;

  // Pictures: show what we have at once and refresh it in the background. Images from other sites arrive as "opaque"
  // responses (status 0), which are fine to keep and show.
  if (event.request.destination === 'image') {
    event.respondWith(imageResponse(event.request));
    return;
  }

  // Network-first for application core assets to prevent stale dev / update caching
  // Scripts and styles are always checked with the server (a cheap "has it changed?"), so a browser's own guess about how
  // long to keep a file can't serve part of an old version next to part of a new one.
  const fresh = event.request.mode === 'navigate' ? event.request : new Request(event.request, { cache: 'no-cache' });
  event.respondWith(
    fetch(fresh)
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

async function imageResponse(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && (response.status === 200 || response.type === 'opaque')) {
        await cache.put(request, response.clone());
        trimImages(cache);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    refresh.catch(() => undefined); // keeps running in the background
    return cached;
  }
  return (await refresh) || Response.error();
}

// Oldest first: the cache lists its entries in the order they were added
async function trimImages(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]);
}
