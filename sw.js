// Service worker: lets the app open without internet.
// Strategy "network first": always try the latest files, fall back to
// the saved copy when offline. Requests to Google (sync) are not touched.

const CACHE = 'household-budget-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Remove caches from older versions of this file.
  for (const key of await caches.keys()) {
    if (key !== CACHE && key !== SHARED) await caches.delete(key);
  }
  await self.clients.claim();
})()));

// Files shared to the app (Android share sheet → Household Budget) arrive
// here as a POST. We park their text in a separate cache and send the app
// to the Purchases screen, which picks them up and imports them.
// Nothing leaves the phone.
const SHARED = 'household-budget-shared';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('version.json')) return; // always ask the network

  e.respondWith((async () => {
    try {
      // cache: 'no-cache' = always ask GitHub whether the file changed.
      // Without it, the browser may reuse its own copy for ~10 minutes
      // and a "Reload" would bring back the old version.
      const fresh = await fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' }));
      if (!fresh.ok) return fresh;
      const cache = await caches.open(CACHE);
      cache.put(url.href, fresh.clone());
      return withNoCache(fresh);
    } catch {
      const cached = await caches.match(url.href, { ignoreSearch: true });
      return cached ? withNoCache(cached) : Response.error();
    }
  })());
});

// GitHub Pages marks files as fresh for 10 minutes, so Chrome keeps the
// app's code files in memory and reuses them on reload without asking us.
// Handing them over marked "no-cache" makes Chrome ask every time.
function withNoCache(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function receiveShare(request) {
  const base = new URL('./', self.location.href);
  try {
    const form = await request.formData();
    const texts = [];
    for (const file of form.getAll('statement')) {
      if (file && typeof file.text === 'function') texts.push(await file.text());
    }
    const cache = await caches.open(SHARED);
    await cache.put(new URL('shared-statements', base).href, new Response(JSON.stringify(texts), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    // Fall through: the app will say that nothing arrived.
  }
  // 303 = "now open this page with a normal GET".
  return Response.redirect(new URL('./?shared=1#buys', base).href, 303);
}
