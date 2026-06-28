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
export function cacheControlFor(filePath: string): string | null {
  const base = basename(filePath);
  if (base === 'sw.js' || base === 'manifest.json') return 'no-cache, no-store, must-revalidate';
  if (filePath.endsWith('.html')) return 'no-cache, no-store, must-revalidate';
  if (/\.(js|mjs|css|woff2|woff|ttf|otf|wasm)$/.test(filePath)) return 'public, max-age=31536000, immutable';
  if (/\.(png|jpg|jpeg|svg|ico|webp|gif|avif)$/.test(filePath)) return 'public, max-age=604800';
  return null;
}
