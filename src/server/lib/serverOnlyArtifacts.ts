// Files the build writes into `dist/` that belong to the SERVER and must never be served to a browser.
//
// 🔴 WHY (forensic audit 2026-10-04, P1). `npm run build` bundles the server to `dist/server.cjs` with a
// sourcemap beside it, and production serves `dist/` as the public static root. So
// `GET /server.cjs.map` answered 200 with 27 MB of JSON whose `sourcesContent` held every one of the
// server's ~1,600 source files — every admin route, every gate's logic, the fallback constants. A boot
// of the production bundle confirmed it. The phone bundle already strips these two files
// (`scripts/stripServerFromNativeBundle.mjs`, `SERVER_ONLY_ARTIFACTS`) — the web lane never got the
// same protection. This list mirrors that one; `tests/theServerSourceIsNeverServed.test.ts` keeps the
// two equal, so a third artifact added to one is added to both.

import path from 'path';
import type { Request, Response, NextFunction } from 'express';

export const SERVER_ONLY_ARTIFACTS: readonly string[] = Object.freeze(['server.cjs', 'server.cjs.map']);

/** Is this request path one of the server's own artifacts (or a precompressed copy of one)? PURE. */
export function isServerOnlyArtifactPath(rawPath: string): boolean {
  let p = rawPath;
  try { p = decodeURIComponent(rawPath); } catch { /* a malformed escape is not one of our files */ }
  const norm = path.posix.normalize(p.replace(/\\/g, '/')).toLowerCase();
  const base = path.posix.basename(norm).replace(/\.(?:br|gz)$/, '');
  return SERVER_ONLY_ARTIFACTS.includes(base);
}

/** Express middleware: answer 404 for a server artifact before any static handler can serve it. */
export function denyServerOnlyArtifacts() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isServerOnlyArtifactPath(req.path)) { res.status(404).end(); return; }
    next();
  };
}
