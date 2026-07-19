// U-4 (verified recipe modules) — security-headers generator.
//
// The actionable counterpart to the security-headers ADVISORY analyzer (which only FLAGS an app missing
// them). This adds a real middleware that sets the browser hardening headers that defend against clickjacking,
// MIME-sniffing and referrer leakage. IMPORTANT (rule 1 — never break the app): it sets only the SAFE,
// non-breaking headers by default. It deliberately does NOT force a Content-Security-Policy, because a wrong
// CSP silently breaks a working app (blocks its own scripts/styles/images) — CSP needs per-app tuning, so it
// is provided as a clearly-marked, commented, opt-in block with guidance instead of a breaking default.
// Dependency-free. PURE builder; complete code, no TODO stubs. Unit-tested.

export interface SecurityHeadersConfig {
  files: Record<string, string>;
  envKeys: string[];
  /** Dependency-free — plain response headers (no helmet needed). */
  dependency?: { name: string; version: string };
  instructions: string;
}

const HEADERS_SERVER = `// Security headers middleware. Register it early: app.use(securityHeaders). These headers are SAFE — they
// harden the browser without breaking a normal app.
export function securityHeaders(
  _req: unknown,
  res: { setHeader: (k: string, v: string) => void },
  next: () => void,
): void {
  // Don't let the browser MIME-sniff a response into an unexpected (dangerous) type.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Clickjacking defence — only same-origin pages may frame this app.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Don't leak full URLs (which can contain tokens) to other origins in the Referer header.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Once seen over HTTPS, the browser refuses plain HTTP for a year (no effect over plain http/localhost).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Turn off powerful features the app doesn't need by default.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // ── OPTIONAL: Content-Security-Policy ──────────────────────────────────────────────────────────────────
  // A CSP is the strongest XSS defence, but a wrong one BREAKS your app (it will block your own scripts,
  // styles, fonts or images). Tune it to what your app actually loads, then uncomment:
  // res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");

  next();
}
`;

const INSTRUCTIONS =
  'Security headers wired at server/lib/securityHeaders.ts. Register app.use(securityHeaders) early — it ' +
  'sets safe hardening headers (X-Content-Type-Options, X-Frame-Options SAMEORIGIN, Referrer-Policy, HSTS, ' +
  'Permissions-Policy) that defend against clickjacking, MIME-sniffing and referrer leakage WITHOUT breaking ' +
  'a normal app. A Content-Security-Policy is included as a commented, opt-in block: it is the strongest XSS ' +
  'defence but a wrong CSP breaks your app, so tune it to what your app loads before enabling. No dependency ' +
  'needed.';

export function generateSecurityHeadersIntegration(): SecurityHeadersConfig {
  return {
    files: { 'server/lib/securityHeaders.ts': HEADERS_SERVER },
    envKeys: [],
    instructions: INSTRUCTIONS,
  };
}
