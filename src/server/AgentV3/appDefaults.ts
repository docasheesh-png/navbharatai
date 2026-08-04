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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${appName} icon">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="280" font-weight="700" fill="#ffffff">${letter}</text>
</svg>
`;
}

/**
 * A minimal offline-first service worker: precache the app shell on install, then serve cache-first
 * with a network fallback (and cache successful GETs). The CACHE version bumps invalidate old caches.
 * Self-contained (no build step), so it works in any static/Vite/CRA app. Pure string.
 */
function swJs(): string {
  return `// Auto-generated offline-first service worker (NavBharatAI app defaults).
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
  files[SW_HREF.replace(/^\//, '')] = swJs();             // offline-first service worker (PWA)

  if (indexHtml == null) {
    return { indexHtml: null, files, added };
  }

  let html = indexHtml;
  const [langHtml, langAdded] = ensureLang(html);
  html = langHtml;
  if (langAdded) added.push('html lang="en"');

  // Tags to ensure in <head>, each guarded by a presence test so this is idempotent.
  const ensures: Array<{ test: RegExp; tag: string; label: string }> = [
    { test: /<meta[^>]+charset/i, tag: '<meta charset="UTF-8" />', label: 'charset' },
    { test: /name=["']viewport["']/i, tag: '<meta name="viewport" content="width=device-width, initial-scale=1.0" />', label: 'viewport' },
    { test: /<title>/i, tag: `<title>${appName}</title>`, label: 'title' },
    { test: /name=["']description["']/i, tag: `<meta name="description" content="${appName}" />`, label: 'meta description' },
    { test: /property=["']og:title["']/i, tag: `<meta property="og:title" content="${appName}" />`, label: 'og:title' },
    { test: /property=["']og:description["']/i, tag: `<meta property="og:description" content="${appName}" />`, label: 'og:description' },
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
