// U-4 (verified recipe modules) — CORS configuration generator.
//
// A real functional blocker for almost every fullstack app: the browser refuses the frontend→backend call
// unless the server sends correct CORS headers. The threat-model analyzer already FLAGS the dangerous
// anti-pattern (a wildcard `Access-Control-Allow-Origin: *` together with credentials — which lets any site
// read authenticated responses); this generator produces the SAFE version instead of leaving the user to
// hand-roll it. It emits a dependency-free middleware that:
//   - reads an allowlist from ALLOWED_ORIGINS (comma-separated) — the app's own frontend origin(s),
//   - echoes back ONLY a matching origin (never `*`), and only then sets Allow-Credentials: true,
//   - answers the OPTIONS preflight with 204,
// so credentialed cross-origin requests work for YOUR frontend and no one else. Framework-agnostic (Express
// and the raw Node http server both work). PURE builder; complete code, no TODO stubs. Unit-tested.

export interface CorsConfig {
  files: Record<string, string>;
  envKeys: string[];
  /** Dependency-free — plain response headers, no `cors` package needed. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const CORS_SERVER = `// Safe CORS middleware. Set ALLOWED_ORIGINS in .env to your frontend origin(s), comma-separated
// (e.g. ALLOWED_ORIGINS=https://app.example.com,http://localhost:5173). Only a request whose Origin is on
// this allowlist is allowed — the middleware echoes back that exact origin, NEVER '*', so credentialed
// cross-origin requests are safe (a wildcard with credentials would let any site read authenticated data).
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Express-compatible signature; also works with the raw Node http server (req.headers / res.setHeader).
export function corsMiddleware(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  res: { setHeader: (k: string, v: string) => void; statusCode?: number; end: () => void },
  next: () => void,
): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // echo the exact allowlisted origin, never '*'
    res.setHeader('Vary', 'Origin'); // caches must key on Origin since the header is per-request
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if ((req.method ?? '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204; // preflight — no body
    res.end();
    return;
  }
  next();
}
`;

const INSTRUCTIONS =
  'Safe CORS wired at server/lib/cors.ts. Set ALLOWED_ORIGINS in .env to your frontend origin(s), ' +
  'comma-separated (e.g. https://app.example.com,http://localhost:5173) — NavBharatAI never stores it. ' +
  'Register corsMiddleware BEFORE your routes (Express: app.use(corsMiddleware)). It allows credentialed ' +
  'requests ONLY from an allowlisted origin and echoes that exact origin, never "*", so it is safe by ' +
  'construction. An empty/unset ALLOWED_ORIGINS blocks all cross-origin requests (same-origin still works).';

export function generateCorsIntegration(): CorsConfig {
  return {
    files: {
      'server/lib/cors.ts': CORS_SERVER,
      [ENV_EXAMPLE]: 'ALLOWED_ORIGINS=\n',
    },
    envKeys: ['ALLOWED_ORIGINS'],
    instructions: INSTRUCTIONS,
  };
}
