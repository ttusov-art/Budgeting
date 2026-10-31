// Service worker: lets the app open without internet.
// Strategy "network first": always try the latest files, fall back to
// the saved copy when offline. Requests to Google (sync) are not touched.

const CACHE = 'household-budget-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('version.json')) return; // always ask the network

  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, fresh.clone());
      return fresh;
    } catch {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
