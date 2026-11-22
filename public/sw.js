const CACHE = 'hymn-stats-__BUILD_ID__';
const ASSETS = __ASSET_MANIFEST__;
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hymn-stats-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (/\/assets\//.test(url.pathname)) { const saved = await cache.match(event.request); if (saved) return saved; }
    try { const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }
    catch { return await cache.match(event.request) || (event.request.mode === 'navigate' ? await cache.match(new URL('./index.html', self.registration.scope).href) : null) || new Response('Unavailable offline', { status: 503 }); }
  })());
});
