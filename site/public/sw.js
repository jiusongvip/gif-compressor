// GIF Compress Service Worker
const CACHE = 'gif-compress-v2';
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
