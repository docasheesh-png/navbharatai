/**
 * NavBharatAI preview proxy — a Cloudflare Worker that serves v5.0 app previews under OUR domain.
 *
 * WHAT IT REPLACES, and why this shape.
 *
 * A v5.0 preview runs inside an E2B sandbox, which publishes it at
 * `{port}-{sandboxId}.e2b.app`. That URL works, and it is what the user sees today — including in
 * "Open in new tab" and in any link they share. Two problems with that:
 *
 *   1. It names our infrastructure vendor in the address bar, which the platform's white-label law
 *      forbids on every user-facing surface. We anonymise the vendor everywhere else and then print
 *      it in the URL.
 *   2. It is not our brand, so a link a user proudly shares advertises somebody else.
 *
 * E2B's own documented answer is a GCP VM running Caddy — which is exactly the ₹1,350/month VM that
 * was deleted for cost on 2026-08-02. This Worker does the same job with **no server at all**: it
 * runs on Cloudflare's edge (free tier: 100k requests/day), so it is both cheaper than the VM and
 * more available than it — a single VM in one region is a single point of failure for every user's
 * preview, and an edge Worker is not.
 *
 * 🔒 THIS IS NOT AN OPEN PROXY, AND THAT IS THE MOST IMPORTANT LINE IN THE FILE.
 * It will only ever forward to `{port}-{sandboxId}.e2b.app`, with both parts strictly validated. If
 * an arbitrary hostname could be turned into an arbitrary upstream, anyone could serve their own
 * content from `*.mitrify.xyz` — a phishing page on our own domain, with our own valid certificate.
 * Every unrecognised host is refused, never guessed at.
 *
 * DEPLOY: see README.md next to this file. Nothing here auto-deploys.
 */

/** The upstream E2B host suffix. Not configurable at runtime — see the open-proxy note above. */
const UPSTREAM_SUFFIX = 'e2b.app';

/**
 * `5173-abc123xyz.mitrify.xyz` → `5173-abc123xyz.e2b.app`, or null when the host is not a preview.
 *
 * The shape is validated, not merely parsed: the port must be a real port number and the sandbox id
 * must be plain alphanumeric. `null` means "refuse", and every caller treats it that way.
 *
 * PURE — the source-contract test in the repo reads this function to check it still agrees with the
 * server's own `applyPreviewDomain()`, which performs the exact opposite swap. Those two are a pair,
 * and a pair that drifts is how a preview silently stops resolving.
 */
export function upstreamHostFor(hostname, previewDomain) {
  if (!hostname || !previewDomain) return null;
  const suffix = `.${previewDomain}`;
  if (!hostname.toLowerCase().endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  // Exactly one label, exactly `{port}-{sandboxId}`. No dots: a nested label would mean somebody is
  // trying to smuggle a different host through, and it would not have a valid certificate anyway.
  const m = /^(\d{1,5})-([a-z0-9]{6,64})$/i.exec(label);
  if (!m) return null;
  const port = Number(m[1]);
  if (!(port > 0 && port <= 65535)) return null;
  return `${m[1]}-${m[2]}.${UPSTREAM_SUFFIX}`;
}

/**
 * The page shown when the sandbox behind a preview is no longer running.
 *
 * A paused or reaped sandbox is the NORMAL end of a preview's life, not a crash — previews are
 * temporary by design and idle ones are stopped to control cost. So this explains that in the
 * user's terms and never leaks the vendor, the sandbox id, or a raw gateway error.
 */
function previewGonePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview has gone to sleep</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
  .card{max-width:30rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 .25rem;color:#9aa7b4}
</style>
<div class="card">
  <h1>This preview has gone to sleep</h1>
  <p>Previews stay live while you are working and stop on their own afterwards, so they never run up a bill.</p>
  <p>Open the app in NavBharatAI and it will start again.</p>
</div>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const previewDomain = env.PREVIEW_DOMAIN || 'mitrify.xyz';
    const upstreamHost = upstreamHostFor(url.hostname, previewDomain);

    // Not a preview host → refuse plainly. Do NOT fall back to "proxy it anyway".
    if (!upstreamHost) {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    }

    const upstream = new URL(request.url);
    upstream.hostname = upstreamHost;
    upstream.port = '';        // always 443 upstream; the port lives in the SUBDOMAIN, not the URL
    upstream.protocol = 'https:';

    // The dev server decides what to send; we forward the request as-is apart from the Host, which
    // must become the upstream's or E2B cannot route it. `redirect: 'manual'` keeps a 3xx as a 3xx,
    // so the browser resolves it against OUR domain rather than being walked to the vendor's.
    const headers = new Headers(request.headers);
    headers.set('Host', upstreamHost);

    const init = {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    };

    // WEBSOCKETS — this is what keeps Vite's hot reload alive through the proxy. A dev server's HMR
    // socket connects back to the SAME host the page came from, so without this every edit would
    // stop updating the preview and the app would look frozen. Cloudflare hands us the upgraded
    // socket on `response.webSocket`; we pass it straight back.
    if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      const res = await fetch(upstream.toString(), init);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers, webSocket: res.webSocket });
    }

    let res;
    try {
      res = await fetch(upstream.toString(), init);
    } catch {
      // The sandbox is gone or unreachable: an expected end of life, not an error page.
      return previewGonePage();
    }
    // E2B answers 502/504 for a sandbox that is no longer serving. Same honest page.
    if (res.status === 502 || res.status === 503 || res.status === 504) return previewGonePage();

    // A redirect the dev server issued to its OWN absolute URL would send the browser to the vendor
    // host and undo everything above, so rewrite the Location back onto our domain.
    const out = new Headers(res.headers);
    const loc = out.get('location');
    if (loc) {
      try {
        const l = new URL(loc, upstream);
        if (l.hostname.toLowerCase().endsWith(`.${UPSTREAM_SUFFIX}`)) {
          l.hostname = l.hostname.slice(0, -`.${UPSTREAM_SUFFIX}`.length) + `.${previewDomain}`;
          out.set('location', l.toString());
        }
      } catch { /* an unparseable Location is the app's own business — pass it through */ }
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
