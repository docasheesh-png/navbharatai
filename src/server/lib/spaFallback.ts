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
  '/guide',   // U-9 auto-generated docs site (routes/KnowledgeDocs.ts)
  '/status',  // U-15 public status page (routes/health.ts)
  // PUBLIC LEGAL PAGES — the canonical documents, the Play-required deletion page, and the legacy
  // spellings that redirect to them. DERIVED from lib/legalPaths.ts rather than restated here: a
  // path listed by the route module but forgotten here would be swallowed by the catch-all and
  // answered with index.html — a 200 that looks alive to a human and is empty to a crawler.
  ...ALL_PUBLIC_LEGAL_PATHS,
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
