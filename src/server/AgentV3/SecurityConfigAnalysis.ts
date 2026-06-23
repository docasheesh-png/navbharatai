// AgentV3 — Security configuration scan (Section I #4 v1).
//
// Beyond the secret/eval/XSS scan in SecurityAnalysis, two configuration mistakes
// are common, high-impact and high-precision to detect: disabling TLS certificate
// verification (opens the app to man-in-the-middle attacks) and a wildcard CORS
// policy (any origin can call the API). This PURE, deterministic scanner flags those
// exact code patterns so the agent fixes them before shipping.
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
    rule: 'tls-verification-disabled',
    severity: 'high',
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0\b/,
    message: 'TLS certificate verification is disabled (rejectUnauthorized:false / NODE_TLS_REJECT_UNAUTHORIZED=0) — this allows man-in-the-middle attacks. Remove it and trust real certificates.',
  },
  {
    rule: 'wildcard-cors',
    severity: 'medium',
    re: /origin\s*:\s*['"]\*['"]|['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/,
    message: 'CORS is open to all origins ("*") — restrict it to the specific trusted origins your app actually needs.',
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
