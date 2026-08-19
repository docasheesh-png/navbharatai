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
  async fetch(request) {
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
    // Stream the response back unchanged. (No cookie rewriting here — see the PSL note above.)
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  },
};
