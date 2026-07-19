// AgentV3 — Security-headers analysis (additive evaluate dimension).
//
// A real, deterministic PROJECT-LEVEL scan over the backend the agent actually wrote, for a single
// high-value hardening gap that SecurityConfigAnalysis (CORS / TLS / secret-logging) does NOT cover: an
// Express/Koa HTTP server that never sets the core HTTP security response headers — neither via `helmet()`
// (the one-line standard) nor by setting them by hand.
//
// Why this matters for a shipped app: without these headers a served page is exposed to well-known,
// entirely-preventable attacks:
//   • X-Frame-Options / frame-ancestors  — clickjacking (the app framed by a malicious site).
//   • Content-Security-Policy             — a large class of XSS / data-injection.
//   • X-Content-Type-Options: nosniff     — MIME-sniffing content attacks.
//   • Strict-Transport-Security           — SSL-strip / downgrade on subsequent visits.
// `helmet()` sets sensible defaults for all of these in one line; this scan tells the agent when neither
// helmet nor a hand-rolled equivalent is present.
//
// Read-only and conservative (high precision): a finding is only raised for an Express/Koa-style app with a
// real server (their `res.setHeader` / middleware idioms are what we can reason about precisely). Fastify/
// Nest/Hono have their own header/plugin conventions we do NOT false-flag. No server ⇒ zero findings (a
// static SPA is correctly clean). The `evaluate` tool surfaces the summary so the agent can add `helmet()` —
// never a synthetic "looks secure".

export type SecurityHeaderSeverity = 'high' | 'medium' | 'low';

export interface SecurityHeaderIssue {
  file: string;
  kind: 'missing-security-headers';
  severity: SecurityHeaderSeverity;
  detail: string;
}

/** Server-side source we scan. Front-end markup and configs carry no response-header semantics. */
const BACKEND_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Paths we never scan — generated, vendored, test, or clearly front-end-only trees. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git|public|assets)([\\/]|$)|\.d\.ts$|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** Signals that a file sets up an HTTP server (any one is enough to call the project "has a backend"). */
const SERVER_SIGNALS: RegExp[] = [
  /\bexpress\s*\(/,
  /\bhttp\.createServer\s*\(/,
  /\bcreateServer\s*\(/,
  /\.listen\s*\(\s*(?:process\.env\.PORT|\d)/,
];
/** Express/Koa-style app — the frameworks whose security-header idioms we reason about precisely. */
const EXPRESS_LIKE = /\bexpress\s*\(|\bKoa\s*\(|\bnew\s+Koa\s*\(|\brequire\(['"`]express['"`]\)|from\s+['"`]express['"`]/;

/** `helmet()` (or a middleware/import of it) — the standard one-liner that sets every core header. */
const HELMET = /\bhelmet\s*\(|require\(['"`]helmet|from\s+['"`]helmet['"`]|koa-helmet|@fastify\/helmet/i;
/**
 * A hand-rolled set of the core security headers — any explicit setHeader/header/set for one of the four
 * key headers is treated as "the app deliberately manages headers" (high precision: we do not want to nag a
 * team that set them manually).
 */
const MANUAL_SECURITY_HEADER =
  /['"`](?:Content-Security-Policy|X-Frame-Options|Strict-Transport-Security|X-Content-Type-Options|Referrer-Policy|Permissions-Policy)['"`]|\bframeguard\s*\(|\bhsts\s*\(|\bcontentSecurityPolicy\s*\(/i;

function scannableBackendFiles(files: Record<string, string>): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    if (!BACKEND_EXT.test(path) || SKIP_PATH.test(path)) continue;
    if (typeof content !== 'string' || !content) continue;
    out.push({ path, content });
  }
  return out;
}

/**
 * Scan a whole project's files for an Express/Koa server that sets no core security headers. Aggregated at
 * the project level: the server is detected once, then helmet / manual-header evidence is checked across ALL
 * backend files (helmet may be applied in a separate middleware file). Returns [] when there is no
 * Express/Koa server, or when headers are already handled.
 */
export function scanSecurityHeaders(files: Record<string, string>): SecurityHeaderIssue[] {
  const backend = scannableBackendFiles(files);
  if (backend.length === 0) return [];

  const serverFiles = backend.filter((f) => SERVER_SIGNALS.some((re) => re.test(f.content)));
  if (serverFiles.length === 0) return [];

  // Only Express/Koa-style apps — other frameworks have their own plugin conventions we do not false-flag.
  const expressLikeFile = backend.find((f) => EXPRESS_LIKE.test(f.content));
  if (!expressLikeFile) return [];

  const allText = backend.map((f) => f.content).join('\n');
  if (HELMET.test(allText) || MANUAL_SECURITY_HEADER.test(allText)) return [];

  // Report against the express-like entry file (where helmet() would be applied).
  const entry = serverFiles.find((f) => EXPRESS_LIKE.test(f.content))?.path ?? expressLikeFile.path;
  return [
    {
      file: entry,
      kind: 'missing-security-headers',
      severity: 'medium',
      detail:
        'no HTTP security headers — the server sets neither helmet() nor Content-Security-Policy / X-Frame-Options / X-Content-Type-Options / Strict-Transport-Security by hand, leaving served pages open to clickjacking, MIME-sniffing and a class of XSS. Add `app.use(helmet())`.',
    },
  ];
}

/** A concise, honest security-headers report for the agent. */
export function securityHeadersSummary(issues: SecurityHeaderIssue[]): string {
  if (issues.length === 0) return 'Security-headers scan: ✓ No security-header gaps detected.';
  const body = issues.map((x) => `  - [${x.severity}] ${x.file} — ${x.kind}: ${x.detail}`);
  return [`Security-headers scan: ${issues.length} gap(s) — ${issues.length} medium.`, ...body].join('\n');
}
