# CDN / Edge Caching (P3.4)

How NavBharatAI's static assets are made CDN-ready, and how to actually front them with a
real CDN. The app code/config here is complete; **provisioning a CDN is an infra/DNS step
an admin performs** (it cannot be done from the app repo) — this doc gives the exact steps.

---

## What's done in code/config (CDN-ready)

Static assets are content-hashed by Vite (e.g. `index-<hash>.js`), so they can be cached
forever and busted by filename. The cache policy is defined **once** in
`src/server/lib/staticCache.ts` (`cacheControlFor`) and applied by:

- **Cloud Run (live):** the Express static handler in `server.ts` sets `Cache-Control`:
  - hashed JS/CSS/fonts/wasm → `public, max-age=31536000, immutable`
  - images → `public, max-age=604800` (1 week)
  - `index.html` → `no-cache, no-store, must-revalidate`
  - **`sw.js` + `manifest.json` → `no-cache, no-store, must-revalidate`** (they are NOT
    hashed — caching them long, or pinning them on a CDN, would stop service-worker / PWA
    updates from shipping). This fixed a real bug where `sw.js` matched the `.js` rule and
    was served `immutable, max-age=1y`.
- **Firebase Hosting CDN:** `firebase.json` → `hosting.headers` mirrors the same policy, so
  Firebase's global edge serves assets identically.

`public` + `immutable` is exactly what any CDN needs to cache at the edge — so once a CDN is
in front, hashed assets are served from the edge with no origin hit, and HTML / sw.js always
revalidate so deploys go live immediately.

---

## Option A — Firebase Hosting CDN (fastest; config already complete)
Firebase Hosting is a real global CDN. `firebase.json` already points `hosting.public` at
`dist` with the SPA rewrite and the cache headers above. To serve static assets from it:

```bash
npm run build
firebase deploy --only hosting --project navbharatai-3395f
```
Then point the static-asset paths (or the apex/CDN subdomain) at Firebase Hosting via DNS.
API/SSR traffic continues to hit Cloud Run; static assets are served from Firebase's edge.

## Option B — Cloud CDN in front of Cloud Run (single origin)
Keep one origin (Cloud Run) and enable Google Cloud CDN on an external HTTPS load balancer:
1. Create a Serverless NEG pointing at the `navbharat-ai-prod` Cloud Run service.
2. Create a backend service with **Cloud CDN enabled**, cache mode "use origin headers"
   (it will honor the `Cache-Control` we already send).
3. Front it with an external HTTPS load balancer + your domain's cert; point DNS at the LB IP.
Hashed assets get edge-cached; HTML / sw.js revalidate (origin headers say so).

## Option C — Cloudflare proxy (DNS-only)
Put the domain behind Cloudflare (orange-cloud proxy). Cloudflare honors origin
`Cache-Control`; set a cache rule to cache `*.js|css|woff2|png|…` and bypass `index.html` /
`sw.js` (or rely on the `no-cache` headers we already send). Zero app changes.

---

## Verification
- `src/server/lib/staticCache.test.ts` asserts the policy (incl. the `sw.js`-must-not-be-immutable
  regression guard) and that `firebase.json` mirrors it.
- After provisioning, confirm with `curl -I https://<domain>/assets/<hashed>.js` →
  `Cache-Control: public, max-age=31536000, immutable` and a CDN cache-hit header
  (`cf-cache-status: HIT` / `x-cache: HIT` / `age: …`); and `curl -I https://<domain>/sw.js`
  → `Cache-Control: no-cache, …`.
