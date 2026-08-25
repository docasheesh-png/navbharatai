// AgentV3 — Deployment readiness: hardcoded local/private-network URLs (Section I #11).
//
// A classic "works on my machine, breaks in production" bug: a hardcoded
// http://localhost:PORT (or 127.0.0.1), OR a private-network address
// (192.168.x.x / 10.x.x.x / 172.16–31.x.x) baked into the app. When deployed it
// still points at that local/LAN address and every call fails. This PURE,
// deterministic scanner flags those URLs — but deliberately IGNORES the correct
// pattern where the address is only an env-var fallback
// (process.env.X || 'http://localhost...'), so good code that already uses
// configuration is never nagged.

export interface HardcodedUrlIssue {
  severity: 'medium';
  /** Which kind of non-production address was hardcoded. */
  kind: 'localhost' | 'private-ip';
  file: string;
  line: number;
  url: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
// Files where a localhost / private address is legitimate and never ships to production:
// test files (hit a local test server) and build/tooling config (e.g. a Vite dev-server
// proxy → http://localhost:3000). Scanning them just produces false positives.
const SKIP_PATH = /(?:\.test\.|\.spec\.|(?:^|[\\/])(?:__tests__|tests?|e2e)[\\/]|\.config\.[cm]?[jt]s$|(?:^|[\\/])(?:setupTests|vite\.config|vitest\.config|playwright\.config|webpack\.config|next\.config))/i;
// `wss?` too, not just `https?`: a hardcoded `ws://localhost:8080` / `wss://10.0.0.5` (common for
// chat / live-update features) points at the container's own loopback in production and breaks 100%
// — yet it was flagged by NEITHER this analyzer nor the security scanner (which excludes local
// sockets). Matching the WebSocket schemes closes that gap.
const LOCALHOST_RE = /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
// RFC 1918 private-network ranges as a URL host: 10/8, 172.16–31/12, 192.168/16.
const PRIVATE_IP_RE = /(?:https?|wss?):\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?/i;
// If the line reads configuration, the address is (almost always) a safe default.
const ENV_RE = /process\.env\.|import\.meta\.env\.|getenv|process\.env\[/i;
// A localhost inside a LOG statement is TEXT shown to a human, not an address the app calls —
// `app.listen(PORT, () => console.log('http://localhost:' + PORT))` is the universal Node boilerplate
// and breaks nothing in production. Flagging it (admin build report 2026-08-25, the UPI API: "1
// hardcoded localhost URL(s)" on an app whose every endpoint was env-ported and curl-verified) is the
// worse failure: a warning that fires on harmless, near-universal code teaches everyone to ignore the
// warning, and the REAL signal — a fetch/axios/WebSocket aimed at localhost — dies with it.
const LOG_LINE_RE = /(?:console\.(?:log|info|warn|error|debug)|logger\.\w+|\bprint(?:ln)?)\s*\(/i;

/** Scan one file for hardcoded local/private URLs that are not env-var fallbacks. PURE. */
export function scanHardcodedUrls(file: string, content: string): HardcodedUrlIssue[] {
  if (!CODE_RE.test(file) || SKIP_PATH.test(file) || !content) return [];
  const issues: HardcodedUrlIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    if (ENV_RE.test(line)) continue; // env-based default — fine
    if (LOG_LINE_RE.test(line)) continue; // a URL being PRINTED, not called — see LOG_LINE_RE
    const lm = line.match(LOCALHOST_RE);
    if (lm) {
      issues.push({ severity: 'medium', kind: 'localhost', file, line: i + 1, url: lm[0] });
      continue;
    }
    const pm = line.match(PRIVATE_IP_RE);
    if (pm) issues.push({ severity: 'medium', kind: 'private-ip', file, line: i + 1, url: pm[0] });
  }
  return issues;
}

/** A short, honest hardcoded-URL block for the `evaluate` output. */
export function hardcodedUrlSummary(issues: HardcodedUrlIssue[]): string {
  if (issues.length === 0) return 'Production URLs: ✓ no hardcoded localhost or private-network URLs.';
  const head = `Production URLs — ${issues.length} hardcoded local/private-network URL(s) (will break in production):`;
  const body = issues
    .slice(0, 10)
    .map((x) => {
      const why = x.kind === 'private-ip'
        ? 'a private-network address that will not resolve in production'
        : 'a localhost address';
      return `  ⚠ ${x.file}:${x.line} — "${x.url}" — ${why}; read it from an env var instead.`;
    });
  return [head, ...body].join('\n');
}
