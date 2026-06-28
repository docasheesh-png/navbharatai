// NavBharatAI Service Worker — v4 (chunk-safe + auto-update)
// Only caches true app-shell assets. JS/CSS chunks are NOT cached here —
// they have Vite content hashes and are handled by CDN Cache-Control headers.
// Bumped to v4: forces a fresh activate + clients.claim so deployed code is picked
// up immediately (paired with a controllerchange reload in main.tsx).
const CACHE = 'navbharat-v4';
const APP_SHELL = [
  '/logo.png',
  '/logo22.png',
  '/manifest.json',
];

// P3.2 — Offline-first read cache. ONLY these safe, read-only GET API endpoints are
// cached, using NETWORK-FIRST (online users always get fresh data; the cache is a
// fallback served only when the network fails / device is offline). Auth/realtime/write
// endpoints are never cached.
const API_READ_CACHE = 'navbharat-api-v1';
const API_CACHEABLE_GETS = [
  '/api/agentv3/conversations',
  '/api/agentv3/status',
];
function isCacheableApiGet(url) {
  return API_CACHEABLE_GETS.some((p) => url.pathname === p || url.pathname.startsWith(p));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Keep the app-shell cache AND the P3.2 offline API read-cache; purge stale ones.
  const KEEP = [CACHE, API_READ_CACHE];
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // P3.2 — allowlisted read-only API GETs: NETWORK-FIRST with offline cache fallback.
  // Online → always fresh from network (and we refresh the cache). Offline → last-known
  // cached response, so the app still shows data. Only the explicit allowlist is touched.
  if (request.method === 'GET' && isCacheableApiGet(url)) {
    e.respondWith(
      fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(API_READ_CACHE).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

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
