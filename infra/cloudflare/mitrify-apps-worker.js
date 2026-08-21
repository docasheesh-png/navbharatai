/**
 * NavBharatAI — branded published-app proxy for *.mitrify.in
 * ==========================================================
 *
 * WHY THIS EXISTS
 * A published app is served by Firebase Hosting at
 *   https://gen-lang-client-0866594388--<channelId>.web.app
 * We want users to see it at
 *   https://<channelId>.mitrify.in
 * Firebase Hosting cannot put a custom domain on a preview CHANNEL, so we proxy at the edge instead:
 * this Cloudflare Worker rewrites  <sub>.mitrify.in  ->  <PROJECT>--<sub>.web.app  and streams the
 * response back. The project prefix is CONSTANT, so no lookup/database is needed — the mapping is
 * deterministic. This is the same edge-proxy pattern the E2B branded preview used.
 *
 * SECURITY NOTE (read before going live):
 * Cookie isolation BETWEEN user apps only holds once mitrify.in is on the Public Suffix List (PSL).
 * localStorage / IndexedDB are already per-origin, so those are isolated from day one. Do not treat
 * mitrify.in as a security boundary for cookies until the PSL entry is live.
 *
 * EDGE CACHING (added 2026-08-21): repeat visits are served from Cloudflare, not Firebase. Firebase
 * bills egress past its free 10 GB while Cloudflare's bandwidth is free, so this is the cheapest
 * saving available — and the app loads faster, because the edge is nearer than Firebase. Fingerprinted
 * assets are held for a year (that URL can never mean anything else); index.html for 60s only, so a
 * republish is visible within a minute instead of people seeing an old app.
 *
 * DEPLOY (Cloudflare dashboard):
 *   1. Workers & Pages -> Create -> Worker. Paste this file. Deploy.
 *   2. The Worker -> Settings -> Triggers -> Add a Route:
 *        Route:  *.mitrify.in/*
 *        Zone:   mitrify.in
 *   3. DNS: add a proxied (orange-cloud) record so the subdomains resolve to Cloudflare's edge:
 *        Type A   Name  *     Content 192.0.2.1   Proxied: ON   (the IP is a placeholder — the Worker
 *        route intercepts before it is ever used; a wildcard record just makes the hostnames resolve.)
 *      (Alternatively a wildcard CNAME `*  ->  mitrify.in`, proxied ON.)
 *   4. Only AFTER the Worker + route + DNS are live and tested, set in Cloud Run:
 *        PUBLISHED_APP_DOMAIN = mitrify.in
 *      Then publish a fresh app and confirm https://<channelId>.mitrify.in loads. If it does not,
 *      UNSET the env immediately — the raw *.web.app URL is the safe fallback and never went away.
 */

const FIREBASE_PROJECT = 'gen-lang-client-0866594388';
const APEX = 'mitrify.in';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname; // e.g. v3-abc-123.mitrify.in

    // Only handle a real subdomain of the apex. The bare apex (mitrify.in / www) is NOT an app and
    // must not be proxied to Firebase — return 404 so it can host a landing page or nothing.
    const suffix = '.' + APEX;
    if (!host.endsWith(suffix) || host === APEX || host === 'www.' + APEX) {
      return new Response('Not found', { status: 404 });
    }
    const sub = host.slice(0, -suffix.length); // "v3-abc-123"
    // A channel id is [a-z0-9-]; reject anything else so this can only ever target a real channel host.
    if (!/^[a-z0-9-]+$/.test(sub)) {
      return new Response('Not found', { status: 404 });
    }

    const originHost = `${FIREBASE_PROJECT}--${sub}.web.app`;
    const originUrl = new URL(request.url);
    originUrl.hostname = originHost;
    originUrl.protocol = 'https:';
    originUrl.port = '';

    // ── EDGE CACHE ──────────────────────────────────────────────────────────────────────────────
    // Without this every single visit reached Firebase, and Firebase bills egress ($0.15/GB past the
    // free 10 GB) while Cloudflare's own bandwidth is free. Serving repeat hits from the edge is the
    // cheapest change available: same bytes to the visitor, a fraction of the origin traffic — and a
    // faster app, because the edge is nearer than Firebase.
    //
    // Only GET/HEAD are cacheable. Anything else (a form POST to an API the app talks to) goes
    // straight through — caching a mutation would be a correctness bug, not a saving.
    const cacheable = request.method === 'GET' || request.method === 'HEAD';
    const cache = caches.default;
    // Key by the ORIGIN url so two branded hosts can never read each other's entries.
    const cacheKey = new Request(originUrl.toString(), { method: 'GET' });

    if (cacheable) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Headers(hit.headers);
        h.set('x-nbai-cache', 'HIT');
        return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
      }
    }

    // Forward the request to Firebase with the ORIGIN host, so Firebase serves the right channel.
    // We do NOT forward the original Host header — Firebase routes by the .web.app hostname.
    const originReq = new Request(originUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
    originReq.headers.delete('host');

    const resp = await fetch(originReq);

    if (!cacheable || resp.status !== 200) {
      // Never cache an error: a 404 held at the edge would outlive the publish that fixes it.
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
    }

    // ── HOW LONG, AND WHY IT DIFFERS BY FILE ────────────────────────────────────────────────────
    // A Vite build fingerprints its assets (`/assets/index-a1b2c3.js`), so that exact URL can never
    // mean anything else — it is safe to hold for a year. index.html is the OPPOSITE: its URL stays
    // the same while its contents change on every republish, so holding it long would leave people
    // looking at an old app after the user pressed Publish. It gets a SHORT life, which still removes
    // the vast majority of origin hits (a busy page is served thousands of times a minute) while a
    // republish becomes visible within a minute.
    const path = originUrl.pathname;
    const fingerprinted = /\/assets\/|\.[0-9a-f]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp|avif|gif|ico)$/i.test(path);
    const headers = new Headers(resp.headers);
    headers.set('cache-control', fingerprinted ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
    headers.set('x-nbai-cache', 'MISS');

    const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    // Store a COPY: the response body can only be read once, and the visitor gets the original.
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  },
};
