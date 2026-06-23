// AgentV3 — Deployment readiness: hardcoded localhost URLs (Section I #11 v1).
//
// A classic "works on my machine, breaks in production" bug: a hardcoded
// http://localhost:PORT (or 127.0.0.1) baked into the app. When deployed it still
// points at localhost and every call fails. This PURE, deterministic scanner flags
// those URLs — but deliberately IGNORES the correct pattern where localhost is only
// an env-var fallback (process.env.X || 'http://localhost...'), so good code that
// already uses configuration is never nagged.

export interface HardcodedUrlIssue {
  severity: 'medium';
  file: string;
  line: number;
  url: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const LOCALHOST_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
// If the line reads configuration, the localhost is (almost always) a safe default.
const ENV_RE = /process\.env\.|import\.meta\.env\.|getenv|process\.env\[/i;

/** Scan one file for hardcoded localhost URLs that are not env-var fallbacks. PURE. */
export function scanHardcodedUrls(file: string, content: string): HardcodedUrlIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: HardcodedUrlIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    if (ENV_RE.test(line)) continue; // env-based default — fine
    const m = line.match(LOCALHOST_RE);
    if (m) issues.push({ severity: 'medium', file, line: i + 1, url: m[0] });
  }
  return issues;
}

/** A short, honest hardcoded-URL block for the `evaluate` output. */
export function hardcodedUrlSummary(issues: HardcodedUrlIssue[]): string {
  if (issues.length === 0) return 'Production URLs: ✓ no hardcoded localhost URLs.';
  const head = `Production URLs — ${issues.length} hardcoded localhost URL(s) (will break in production):`;
  const body = issues
    .slice(0, 10)
    .map((x) => `  ⚠ ${x.file}:${x.line} — "${x.url}" — read it from an env var instead.`);
  return [head, ...body].join('\n');
}
