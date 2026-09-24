// P3.4 — CDN/edge-cache policy for static assets.
//
// Single source of truth for the `Cache-Control` we put on built static files, used by the
// Express static handler (server.ts). `public` + long `max-age` + `immutable` on
// content-hashed assets makes them safe for ANY CDN (Cloudflare / Cloud CDN / Firebase
// Hosting) to cache at the edge. The matching policy is mirrored in firebase.json's
// `hosting.headers` so the Firebase Hosting CDN serves the same way.

import { basename } from 'path';

/**
 * The Cache-Control value for a built asset path, or null if no specific policy applies
 * (the static handler then leaves Express's default). Pure + unit-tested.
 *
 * Ordering matters: sw.js / manifest.json are checked FIRST because they end in
 * .js/.json but must NEVER be cached long — they are not content-hashed, so a long cache
 * (or a CDN pin) would stop service-worker / PWA updates from ever shipping.
 */
/**
 * Files that are NOT content-hashed, yet end in .js/.css/.ttf and so used to fall into the 1-year
 * `immutable` rule (found by the 2026-09-24 compression audit): the Monaco editor copied from
 * node_modules (`/monaco/vs/...`, 24 MB) and the preview runtime (`/vendor/...` — React and Babel).
 * `immutable` tells a browser never to ask again for a year, so after a Monaco or React upgrade a
 * returning user would run old files beside new ones. One day, then an ETag revalidation (a 304 costs
 * a few hundred bytes), keeps them fast AND lets an upgrade reach everyone within a day.
 */
export const UNHASHED_ASSET_CACHE = 'public, max-age=86400';
const UNHASHED_DIR = /(^|[\\/])(monaco|vendor)[\\/]/;

export function cacheControlFor(filePath: string): string | null {
  const base = basename(filePath);
  if (base === 'sw.js' || base === 'manifest.json') return 'no-cache, no-store, must-revalidate';
  if (filePath.endsWith('.html')) return 'no-cache, no-store, must-revalidate';
  if (UNHASHED_DIR.test(filePath)) return UNHASHED_ASSET_CACHE;
  if (/\.(js|mjs|css|woff2|woff|ttf|otf|wasm)$/.test(filePath)) return 'public, max-age=31536000, immutable';
  if (/\.(png|jpg|jpeg|svg|ico|webp|gif|avif)$/.test(filePath)) return 'public, max-age=604800';
  return null;
}
