// U-2 (roadmap Tier 2) — App-Scaffold-Defaults: give every app the quality basics BY DEFAULT (SEO/OG
// meta, a viewport, an html lang, a web manifest, robots.txt) instead of leaving them to chance. The
// existing SeoAnalysis/PwaAnalysis only DETECT what's missing; this GENERATES the fixes.
//
// PURE + idempotent: given the current index.html it returns a patched copy plus the new files to write,
// adding ONLY what is missing (running it twice changes nothing). The ToolDispatcher `generate_app_defaults`
// tool applies the result. Scoped to a standard index.html (Vite/CRA/static); if there is none (e.g.
// Next.js metadata API) the tool says so honestly rather than writing something wrong.

export interface AppDefaultsResult {
  /** Patched index.html, or null when there was no html to patch. */
  indexHtml: string | null;
  /** New files to create (manifest, robots) — keyed by workspace path. */
  files: Record<string, string>;
  /** Human-readable list of what was added (empty when everything was already present). */
  added: string[];
}

const MANIFEST_HREF = '/manifest.webmanifest';
const ICON_HREF = '/icon.svg';
const SW_HREF = '/sw.js';

function manifestJson(appName: string): string {
  return JSON.stringify(
    {
      name: appName,
      short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0f172a',
      // A real (SVG) icon so the manifest is genuinely installable — an empty icons[] fails PWA criteria.
      icons: [{ src: ICON_HREF, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    null,
    2,
  ) + '\n';
}

/** A minimal, self-contained maskable app icon: a monogram of the app's first letter. Pure. */
function iconSvg(appName: string): string {
  const letter = (appName.trim()[0] || 'A').toUpperCase().replace(/[<>&"']/g, 'A');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(appName)} icon">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="280" font-weight="700" fill="#ffffff">${letter}</text>
</svg>
`;
}

/**
 * THE SERVICE WORKER WE SHIPPED UNTIL 2026-09-25, kept VERBATIM for one job: recognising it on disk so
 * it can be replaced (`upgradeGeneratedServiceWorker`). Never written again.
 *
 * 🔴 WHY IT HAD TO GO. It served EVERY GET cache-first — `/` and `/index.html` included — under a cache
 * name that never changed. So once a visitor had loaded a published app, a republish reached them
 * NEVER: the browser kept answering from the old shell, which pointed at the old hashed bundle, which
 * was cached too. On the live preview the same worker cached the dev server's `/src/*.tsx` modules, so
 * a reload after an edit could show the code from before it. Nothing failed anywhere; the app simply
 * stopped changing.
 * ⚠️ It reached real apps only where Green Freeze did NOT stop the post-build defaults pass (builds
 * never proven in a browser) and through the `generate_app_defaults` tool — the freeze had been hiding
 * it on every green build, which is how it survived. It was found while moving that pass in front of
 * the freeze, which would otherwise have shipped it to every app.
 */
export const LEGACY_SERVICE_WORKER_V1 = `// Auto-generated offline-first service worker (NavBharatAI app defaults).
const CACHE = 'app-shell-v1';
const SHELL = ['/', '/index.html'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html')),
    ),
  );
});
`;

/**
 * The service worker for an app's offline use. NETWORK FIRST: while the device is online every
 * request goes to the network, so a republished app is what the next page load shows; the cache is
 * only the fallback for when the network is gone. Dev-server paths (`/@vite/…`, `/src/…`,
 * `/node_modules/…`) and other origins are never touched, so it cannot serve stale modules to a live
 * preview. It caches pages and static files only — never `/api/` or data requests, which could hold
 * one user's data on a shared device — and keeps at most 80 entries, so hashed bundles from old
 * versions do not pile up. Activating it deletes this worker's older caches (`app-shell-*`, which is
 * what rescues a visitor already stuck on v1) and nothing else. Self-contained. Pure string.
 */
function swJs(): string {
  return `// Auto-generated service worker (NavBharatAI app defaults, v2).
// Network first: online, every request goes to the network, so a new version of the app is seen on
// the next load. The cache is used only when the network is unavailable, and it holds only the app's
// pages and static files — never API responses.
const PREFIX = 'app-shell-';
const CACHE = PREFIX + 'v2';
const MAX_ENTRIES = 80;
const STATIC = ['script', 'style', 'image', 'font', 'manifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/')).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // Only this worker's own older caches; a cache the app itself created is not ours to delete.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
function cacheable(req, url) {
  if (url.pathname.startsWith('/api/')) return false;
  return req.mode === 'navigate' || STATIC.includes(req.destination);
}
function trim(cache) {
  return cache.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((k) => cache.delete(k))));
}
// A cached redirect cannot answer a navigation, so it is re-wrapped as a plain response.
function plain(res) {
  if (!res || !res.redirected) return res;
  return res.blob().then((body) => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\\/(@|src\\/|node_modules\\/)/.test(url.pathname)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic' && cacheable(req, url)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c))).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req)
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : undefined))
          .then(plain)
          .then((res) => res || Response.error()),
      ),
  );
});
`;
}

/**
 * Replace OUR OWN v1 service worker with the current one. Returns the new content, or null when the
 * file is anything else — a worker the user or their framework wrote is never touched. Matched on the
 * exact generated text (line endings and outer whitespace aside), because v1 took no parameters and so
 * was byte-identical in every app; an edited copy is the user's and stays. Pure.
 */
export function upgradeGeneratedServiceWorker(existing: string | null | undefined): string | null {
  if (typeof existing !== 'string') return null;
  const norm = (t: string) => t.replace(/\r\n/g, '\n').trim();
  return norm(existing) === norm(LEGACY_SERVICE_WORKER_V1) ? swJs() : null;
}

/** The workspace path of the generated service worker (before `defaultAssetPath`). */
export const SERVICE_WORKER_FILE = 'sw.js';

/** Escape text for an HTML attribute or element body — the app name comes from the user's prompt. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The idempotent service-worker registration snippet injected into index.html. */
const SW_REGISTER_SCRIPT =
  `<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${SW_HREF}').catch(function(){})})}</script>`;

const ROBOTS_TXT = 'User-agent: *\nAllow: /\n';

/** Ensure <html> carries a lang attribute. Returns [patched, added?]. */
function ensureLang(html: string): [string, boolean] {
  const htmlTag = html.match(/<html\b([^>]*)>/i);
  if (!htmlTag) return [html, false];
  if (/\blang\s*=/.test(htmlTag[1])) return [html, false];
  return [html.replace(htmlTag[0], `<html lang="en"${htmlTag[1]}>`), true];
}

/**
 * Where a standalone default asset (manifest / icon / sw / robots) must live so the app's BUILD actually
 * ships it. A Vite app copies ONLY the `public/` directory verbatim into `dist/` — a file left in the
 * project ROOT is silently dropped from the build, so the deployed site 404s its manifest/icon/sw and the
 * builder burns a rebuild-grind (`mkdir public && cp …`, `npm run build` ×7) copying it into place
 * (deploy-report autopsy 2026-08-03, buildId 588885e8). Vite-family framework → `public/<file>` (the
 * absolute `/manifest.webmanifest` hrefs in index.html still resolve, since Vite serves public/ at root);
 * every other framework (plain static HTML, unknown) → root, unchanged. Never double-prefixes an
 * already-pathed file. Pure.
 */
export function defaultAssetPath(rel: string, framework: string | null | undefined): string {
  const viteFamily = (framework ?? '').toLowerCase().includes('vite');
  if (!viteFamily || rel.includes('/')) return rel;
  return `public/${rel}`;
}

/**
 * Plan the app-scaffold defaults. Pure + idempotent. `indexHtml` may be null (no index.html found):
 * then only the standalone files (manifest, robots) are returned and `indexHtml` stays null.
 */
export function planAppDefaults(indexHtml: string | null, appName = 'App'): AppDefaultsResult {
  const added: string[] = [];
  const files: Record<string, string> = {};

  // Standalone files, added only if absent from the workspace (the tool checks existence before writing).
  files[MANIFEST_HREF.replace(/^\//, '')] = manifestJson(appName);
  files['robots.txt'] = ROBOTS_TXT;
  files[ICON_HREF.replace(/^\//, '')] = iconSvg(appName); // real installable icon (referenced by the manifest)
  files[SW_HREF.replace(/^\//, '')] = swJs();             // network-first service worker (PWA, works offline)

  if (indexHtml == null) {
    return { indexHtml: null, files, added };
  }

  let html = indexHtml;
  const [langHtml, langAdded] = ensureLang(html);
  html = langHtml;
  if (langAdded) added.push('html lang="en"');

  // Tags to ensure in <head>, each guarded by a presence test so this is idempotent.
  // The name comes from the user's prompt; a quote or an angle bracket in it would otherwise break the
  // attribute it sits in, or the document.
  const safeName = escapeHtml(appName);
  const ensures: Array<{ test: RegExp; tag: string; label: string }> = [
    { test: /<meta[^>]+charset/i, tag: '<meta charset="UTF-8" />', label: 'charset' },
    { test: /name=["']viewport["']/i, tag: '<meta name="viewport" content="width=device-width, initial-scale=1.0" />', label: 'viewport' },
    { test: /<title>/i, tag: `<title>${safeName}</title>`, label: 'title' },
    { test: /name=["']description["']/i, tag: `<meta name="description" content="${safeName}" />`, label: 'meta description' },
    { test: /property=["']og:title["']/i, tag: `<meta property="og:title" content="${safeName}" />`, label: 'og:title' },
    { test: /property=["']og:description["']/i, tag: `<meta property="og:description" content="${safeName}" />`, label: 'og:description' },
    { test: /name=["']twitter:card["']/i, tag: '<meta name="twitter:card" content="summary_large_image" />', label: 'twitter:card' },
    { test: /name=["']theme-color["']/i, tag: '<meta name="theme-color" content="#0f172a" />', label: 'theme-color' },
    { test: /rel=["']manifest["']/i, tag: `<link rel="manifest" href="${MANIFEST_HREF}" />`, label: 'manifest link' },
    { test: /rel=["']icon["']/i, tag: `<link rel="icon" href="${ICON_HREF}" type="image/svg+xml" />`, label: 'icon link' },
  ];

  const toInsert: string[] = [];
  for (const e of ensures) {
    if (!e.test.test(html)) { toInsert.push('    ' + e.tag); added.push(e.label); }
  }

  let headPatched = true;
  if (toInsert.length) {
    const block = '\n' + toInsert.join('\n') + '\n';
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${block}  </head>`);
    } else if (/<head\b[^>]*>/i.test(html)) {
      html = html.replace(/(<head\b[^>]*>)/i, `$1${block}`);
    } else {
      // No <head> to patch safely — don't risk mangling the document; drop the head-only additions.
      for (const e of ensures) { const i = added.indexOf(e.label); if (i >= 0) added.splice(i, 1); }
      headPatched = false;
    }
  }

  // Register the service worker (idempotent — only when it isn't registered yet AND there is a body to
  // inject into safely). Injected before </body> so it runs after the app scripts.
  if (headPatched && !/serviceWorker\.register/.test(html) && /<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `    ${SW_REGISTER_SCRIPT}\n  </body>`);
    added.push('service worker registration');
  }

  return { indexHtml: headPatched || langAdded ? html : indexHtml, files, added };
}
