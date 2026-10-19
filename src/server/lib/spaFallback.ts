// SPA fallback routing decision (deployed-PWA autopsy 2026-08-02).
//
// server.ts serves the built SPA with `app.get('*')`, which is registered BEFORE most real route
// modules. Because `*` matches every GET, any server-owned GET route registered afterwards is
// SWALLOWED: the request never reaches its handler and Express returns NavBharatAI's own index.html
// with a 200. It looks like a working page, so it fails silently.
//
// This has now bitten twice:
//   • the live preview (documented in the original comment: "the preview silently 'worked' in audits
//     but showed the main app") — fixed by hand-adding /preview/ and /preview-app/;
//   • the DEPLOYED PWA — a user deploys their app via Settings → Hosting & Deploy → Deploy to
//     NavBharatAI, gets https://navbharatai.com/pwa/<id>, opens it, and sees NAVBHARATAI instead of
//     their own app. The /pwa/ handler (routes/pwa.ts) is correct and serves the user's HTML — it was
//     simply never reached, because /pwa/ was missing from the hand-maintained exclusion list.
//
// A hand-edited inline list drifts every time a route is added, so the decision now lives here as ONE
// pure, exported, test-locked function: every server-owned path prefix is declared in a single place a
// test can assert against. Adding a new non-/api server route means adding it here — and the test that
// enumerates the real routes fails until you do.
//
// IMPORTANT: only SERVER-owned paths belong here. Client-side SPA routes (/, /admin, /store, …) must
// keep receiving index.html so the React router can handle them — deferring one would 404 the app.

import { ALL_PUBLIC_LEGAL_PATHS } from './legalPaths';
import { CHECKOUT_HANDOFF_PATH } from './checkoutHandoff';
import { ROBOTS_PATH, SITEMAP_PATH } from './siteIndex';
import { MARKETING_PATHS } from '../../content/marketing';

/**
 * Path prefixes owned by real server route handlers registered AFTER the SPA catch-all. A request
 * matching one of these must fall through (`next()`) to its handler instead of receiving index.html.
 */
export const SERVER_ROUTE_PREFIXES: readonly string[] = [
  '/api/',          // every JSON API
  '/preview-app/',  // live preview asset proxy (routes/preview.ts)
  '/preview/',      // live preview shell (routes/preview.ts)
  '/pwa/',          // DEPLOYED USER APPS — the app HTML, its manifest.json and its sw.js (routes/pwa.ts)
];

/** Exact server-owned paths (with and without a trailing slash) that are NOT prefixes. */
export const SERVER_ROUTE_EXACT: readonly string[] = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/v1/failedbr/mcp',
  '/.well-known/oauth-protected-resource/api/failedbr/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/api/v1/failedbr/oauth',
  '/guide',   // U-9 auto-generated docs site (routes/KnowledgeDocs.ts)
  '/status',  // U-15 public status page (routes/health.ts)
  ROBOTS_PATH,  // robots.txt and sitemap.xml (routes/siteIndex.ts) — a crawler must get the file, not index.html
  SITEMAP_PATH,
  // The checkout hand-off page (routes/checkoutHandoff.ts). Forgetting it here would be the worst
  // version of this module's own bug: the native app would open a payment link and be served the
  // app shell with a 200, i.e. a blank-looking page instead of a checkout, with nothing failing.
  CHECKOUT_HANDOFF_PATH,
  // PUBLIC LEGAL PAGES — the canonical documents, the Play-required deletion page, and the legacy
  // spellings that redirect to them. DERIVED from lib/legalPaths.ts rather than restated here: a
  // path listed by the route module but forgotten here would be swallowed by the catch-all and
  // answered with index.html — a 200 that looks alive to a human and is empty to a crawler.
  ...ALL_PUBLIC_LEGAL_PATHS,
  // PUBLIC PRODUCT PAGES (/about, /pricing and the three product pages — routes/marketing.ts).
  // Derived, like the legal list: a page forgotten here would be answered with the app shell.
  ...MARKETING_PATHS,
];

/**
 * True when the SPA catch-all must DEFER this path to a real server handler; false when it should serve
 * the SPA's index.html. Pure — same input, same answer, no I/O.
 */
export function spaFallbackShouldDefer(path: string): boolean {
  const p = typeof path === 'string' ? path : '';
  if (!p) return false;
  if (SERVER_ROUTE_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  const noTrailing = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  return SERVER_ROUTE_EXACT.includes(noTrailing);
}

/**
 * A FILE path the static handler did not find (SEO verification 2026-10-18, P2-6).
 *
 * The SPA catch-all runs AFTER express.static, so a path that reaches it and names a file — a stale
 * `/assets/index-<old hash>.js` after a deploy, a mistyped `/logo.pngg`, `/favicon.ico` — is a file
 * that does not exist. It used to be answered with index.html and a 200, which:
 *   • tells a crawler a missing image is an HTML page (a soft-404);
 *   • hands the browser HTML where it expected a script, so a stale chunk failed with a confusing
 *     MIME-type error instead of a plain 404;
 *   • and, worst, let the service worker CACHE that HTML as the image (sw.js caches any `res.ok`
 *     image/json response), so the broken answer outlived the deploy that fixed it.
 * A client-side route never names a file, so no app screen is affected. PURE.
 */
const STATIC_FILE_EXT = /\.(?:m?js|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|json|txt|xml|webmanifest|wasm|mp3|mp4|webm|pdf|zip)$/i;

export function isMissingStaticFilePath(path: string): boolean {
  const p = typeof path === 'string' ? path : '';
  if (!p.startsWith('/')) return false;
  if (p.startsWith('/assets/')) return true;
  const last = p.split('/').pop() ?? '';
  return STATIC_FILE_EXT.test(last);
}

