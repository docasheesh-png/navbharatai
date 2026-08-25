// Response compression for the WHOLE server — API JSON and the static bundle alike.
//
// WHY THIS EXISTS (admin 2026-08-25: "app mart me app jaldi open ho"). Nothing on the serving path
// compressed anything: no middleware here, and Cloud Run does not compress for you. So every response
// went over the wire raw — a store app's compiled page at 75–190 KB instead of the 21–23 KB it
// gzips to (measured), and, far worse, the main app bundle: ~1.28 MB raw for a chunk that is 355 KB
// gzipped. On a phone connection that difference IS the loading spinner. All of the 2026-08-24
// bundle-split work only reaches users' phones through this file.
//
// 🔒 THE FILTER IS AN ALLOWLIST, AND THAT IS THE WHOLE DESIGN. gzip buffers output until it has a
// block to emit, which silently breaks every live stream in the product:
//   • the v5 build's progress stream is NDJSON under `Content-Type: text/plain` (routes/agentv3.ts)
//     — a viewer would see nothing for the whole build, then everything at once;
//   • chat and zip progress use `text/event-stream`;
//   • `application/zip` downloads are already compressed — re-compressing wastes CPU for ~0 bytes.
// A denylist would have to name every stream forever; an allowlist is safe for whatever a future
// route streams under a type not listed here. Correct-but-uncompressed beats compressed-but-broken.
import compression from 'compression';
import type { Request, Response, RequestHandler } from 'express';

/** Types that are (a) never streamed by this server and (b) worth compressing. */
const COMPRESSIBLE = [
  'application/json',
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'image/svg+xml',
  'application/manifest+json',
];

/** Pure allowlist decision, exported for tests: compress only what is provably safe. */
export function shouldCompress(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE.includes(base);
}

/** The mounted middleware. Threshold 1 KB — tiny responses cost more to zip than to send. */
export function responseCompression(): RequestHandler {
  return compression({
    threshold: 1024,
    filter: (_req: Request, res: Response) => shouldCompress(String(res.getHeader('Content-Type') ?? '')),
  });
}
