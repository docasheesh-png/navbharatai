// NavBharatAI Service Worker — v3 (chunk-safe)
// Only caches true app-shell assets. JS/CSS chunks are NOT cached here —
// they have Vite content hashes and are handled by CDN Cache-Control headers.
const CACHE = 'navbharat-v3';
const APP_SHELL = [
  '/logo.png',
  '/logo22.png',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls and non-GET: always bypass SW
  if (request.url.includes('/api/') || request.method !== 'GET') return;

  // JS/CSS/module chunks: ALWAYS network — never cache (content-hashed, CDN handles it)
  if (/\.(js|mjs|css|ts)(\?|$)/.test(url.pathname)) return;

  // HTML navigation: network-first, hard reload on failure (no stale HTML)
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-cache' }).catch(() => caches.match('/') ?? fetch(request))
    );
    return;
  }

  // Images / manifest / icons: cache-first (these don't change between deploys)
  if (/\.(png|jpg|jpeg|svg|ico|webp|json)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network-first, no caching
});
