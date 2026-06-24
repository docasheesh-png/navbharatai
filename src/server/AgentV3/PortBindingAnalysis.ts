// AgentV3 — Deployment readiness: hardcoded server port (Section I #11 v2).
//
// A classic "deploys but receives no traffic" bug: a server that binds to a
// hardcoded port (app.listen(3000)) instead of reading the platform's injected
// port (app.listen(process.env.PORT || 3000)). Every managed host — Cloud Run,
// Heroku, Render, Railway, Fly — assigns the port via the PORT env var and routes
// traffic only to it; a hardcoded port means the container starts but the platform
// can never reach it. This PURE, deterministic scanner flags a literal-port listen
// — but deliberately IGNORES the correct pattern where the port comes from
// configuration (process.env.PORT / import.meta.env), so good code is never nagged.

export interface PortBindingIssue {
  severity: 'medium';
  file: string;
  line: number;
  port: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
// `.listen(3000` / `.listen( 8080,` — a listen call whose first argument is a
// numeric literal port (2–5 digits). Excludes `.listen(port)`, `.listen()` and
// single-digit backlog-only calls.
const LISTEN_LITERAL_RE = /\.listen\s*\(\s*(\d{2,5})\b/;
// If the line reads the port from configuration, the literal is a safe fallback.
const ENV_RE = /process\.env\.|import\.meta\.env\.|getenv|process\.env\[/i;

/** Scan one file for a server bound to a hardcoded (non-env) port. PURE. */
export function scanPortBinding(file: string, content: string): PortBindingIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: PortBindingIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    if (ENV_RE.test(line)) continue; // port read from env on this line — fine
    const m = line.match(LISTEN_LITERAL_RE);
    if (m) issues.push({ severity: 'medium', file, line: i + 1, port: m[1] });
  }
  return issues;
}

/** A short, honest port-binding block for the `evaluate` output. */
export function portBindingSummary(issues: PortBindingIssue[]): string {
  if (issues.length === 0) return 'Server port: ✓ no hardcoded listen port.';
  const head = `Server port — ${issues.length} hardcoded listen port(s) (cloud hosts inject PORT; traffic will not reach the app):`;
  const body = issues
    .slice(0, 10)
    .map((x) => `  ⚠ ${x.file}:${x.line} — listen(${x.port}) — use process.env.PORT (e.g. process.env.PORT || ${x.port}).`);
  return [head, ...body].join('\n');
}
