// GIF Compress Service Worker
// Bump CACHE whenever an unhashed same-origin asset changes. The fetch handler below
// is stale-while-revalidate, so a returning visitor is served the cached copy once and
// only gets the new one on the following visit — and /js/gif-compressor.js is unhashed,
// so without a bump a shipped fix to the tool does not reach anyone who has been here
// before. This is the only lever: `_headers` gives /js/* a 24h max-age, and the Cache
// API ignores Cache-Control when storing anyway.
// v4: tool script URLs are now content-hashed (see GifTool.astro), and the cached
// HTML pages still name the old unhashed URLs — so the page cache must be dropped or a
// returning visitor gets markup pointing at a script the edge may serve stale.
const CACHE = 'gif-compress-v4';
const ASSETS = [
  '/',
  '/compress-gif/',
  '/resize-gif/',
  '/crop-gif/',
  '/gif-to-webp/',
  '/gif-to-mp4/',
  '/gif-optimizer/',
  '/reduce-gif-size/',
  '/faq/',
  '/manifest.json',
  '/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Skip non-GET requests (POST, etc.)
  if (e.request.method !== 'GET') return;

  // Skip CDN / external resources
  const url = new URL(e.request.url);
  if (url.hostname !== self.location.hostname && !url.hostname.endsWith('.online')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
