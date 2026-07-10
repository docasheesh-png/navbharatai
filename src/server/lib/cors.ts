// CORS policy — single source of truth (root-cause rule: ONE allowlist, not per-route copies).
//
// Two consumers:
//   • setCorsHeaders(req,res) — the original per-route helper (zip/engineer/pro routes), unchanged
//     behavior, now reading the same shared allowlist.
//   • corsMiddleware() — global middleware (Bundled-mode foundation, 2026-07-08): the native app
//     shells run the frontend from a LOCAL WebView origin (https://localhost on Android/iOS with the
//     https scheme, capacitor://localhost on default iOS), so every API call from the bundled app is
//     cross-origin and needs both response headers AND OPTIONS preflight handling (Authorization +
//     JSON bodies always trigger preflight). Web traffic is same-origin → no Origin match → the
//     middleware does nothing → byte-for-byte today's behavior.
//
// SECURITY: only exact allowlisted origins are ever reflected — never a wildcard, never an arbitrary
// caller origin. Auth is Bearer-token-only (no cookies anywhere in the app), so reflecting the native
// shell origins grants no ambient credentials: every request still needs a verified Firebase token.

const ALLOWED_ORIGINS = new Set([
  'https://navbharatai.web.app',
  'https://navbharatai.firebaseapp.com',
  // Native app shells (Capacitor). https://localhost = Android/iOS with androidScheme/iosScheme
  // 'https' (our capacitor.config.ts); capacitor://localhost = default iOS scheme fallback.
  'https://localhost',
  'capacitor://localhost',
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
]);

/** Pure: is this Origin allowed to make cross-origin API calls? (exact allowlist + local dev) */
export function isAllowedCorsOrigin(origin: string | undefined, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  if (!origin) return false;
  // In non-production we additionally permit localhost dev servers (any port) — but NEVER reflect an
  // arbitrary attacker origin, even outside production (the old `NODE_ENV !== 'production'` blanket
  // reflection was a CORS hole if NODE_ENV was unset).
  const isLocalDev = nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ALLOWED_ORIGINS.has(origin) || isLocalDev;
}

export function setCorsHeaders(
  req: { headers: { origin?: string } },
  res: { setHeader: (name: string, value: string) => void },
): void {
  const origin = req.headers.origin;
  if (!origin || !isAllowedCorsOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}

/**
 * Global CORS middleware (installed once in server.ts, before the routes). For allowlisted origins it
 * sets the response headers on every request and short-circuits OPTIONS preflights with 204. For
 * everything else (same-origin web traffic, unknown origins) it is a pass-through no-op.
 */
export function corsMiddleware() {
  return (
    req: { method: string; headers: { origin?: string; 'access-control-request-headers'?: string } },
    res: { setHeader: (name: string, value: string) => void; status: (code: number) => { end: () => void } },
    next: () => void,
  ): void => {
    const origin = req.headers.origin;
    if (!origin || !isAllowedCorsOrigin(origin)) { next(); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      // Reflect the exact headers the browser asked to send (Authorization, Content-Type, …);
      // fall back to the two this app actually uses.
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }
    next();
  };
}
