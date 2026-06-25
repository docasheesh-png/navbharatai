// AgentV3 — Security configuration scan (Section I #4 v1).
//
// Focuses on CORS misconfiguration and secret-logging — config mistakes that are common,
// high-impact and high-precision to detect. TLS-verification-disabled and insecure
// Math.random() randomness are deliberately NOT duplicated here: SecurityAnalysis already
// covers both (`disable-tls-verification` and `insecure-random-token`, the latter with a
// broader security-keyword guard), and running both analyzers would double-report the same
// line in the `evaluate` output. This PURE, deterministic scanner flags its exact patterns so
// the agent fixes them before shipping.
//
// High-precision by design: each rule matches a specific, unambiguous code pattern,
// so well-configured code is not nagged.

export type SecConfigSeverity = 'high' | 'medium' | 'low';

export interface SecConfigIssue {
  severity: SecConfigSeverity;
  rule: string;
  message: string;
  file: string;
  line: number;
}

interface Rule {
  rule: string;
  severity: SecConfigSeverity;
  re: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    rule: 'wildcard-cors',
    severity: 'medium',
    re: /origin\s*:\s*['"]\*['"]|['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/,
    message: 'CORS is open to all origins ("*") — restrict it to the specific trusted origins your app actually needs.',
  },
  {
    rule: 'cors-credentials-reflect-origin',
    severity: 'high',
    // `cors({ origin: true, credentials: true })` reflects ANY request origin AND allows
    // credentials — so any website can make authenticated cross-origin requests to your
    // API with the user's cookies. Both flags on the same line (either order).
    re: /origin\s*:\s*true[^}\n]*credentials\s*:\s*true|credentials\s*:\s*true[^}\n]*origin\s*:\s*true/,
    message: 'CORS reflects any origin (origin:true) while allowing credentials — any site can make authenticated requests with the user\'s cookies. Pin origin to an explicit allow-list of trusted origins.',
  },
  {
    rule: 'logged-secret',
    severity: 'medium',
    // Logging an env var whose name looks like a secret leaks it into logs/console.
    re: /console\.(?:log|info|debug|warn|error)\s*\([^)]*\b(?:process\.env|import\.meta\.env)\.\w*(?:KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/i,
    message: 'A secret env var is being logged to the console — secrets must never be written to logs. Remove the log or redact the value.',
  },
];

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/** Scan one file's content for insecure security-config patterns. PURE. */
export function scanSecurityConfig(file: string, content: string): SecConfigIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: SecConfigIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore obvious single-line comments to cut false positives.
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    for (const r of RULES) {
      if (r.re.test(line)) {
        issues.push({ severity: r.severity, rule: r.rule, message: r.message, file, line: i + 1 });
      }
    }
  }
  return issues;
}

/** A short, honest security-config block for the `evaluate` output. */
export function securityConfigSummary(issues: SecConfigIssue[]): string {
  if (issues.length === 0) return 'Security config: ✓ no insecure TLS/CORS configuration found.';
  const order: Record<SecConfigSeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const head = `Security config — ${issues.length} issue(s):`;
  const body = sorted.slice(0, 10).map((x) => `  ⚠ [${x.severity}] ${x.file}:${x.line} — ${x.message}`);
  return [head, ...body].join('\n');
}
