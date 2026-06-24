// AgentV3 — Security analysis (Phase 3/8, cat 16).
//
// Real static security scanning over the actual source the agent writes: hardcoded
// secrets/credentials and dangerous code patterns. Findings are computed at index
// time from real content (only the findings are kept, not the file body), so the
// `evaluate` tool can report concrete, real security defects for the team to fix —
// never a synthetic "looks secure".

export type Severity = 'high' | 'medium' | 'low';

export interface SecurityFinding {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
}

interface Rule {
  rule: string;
  severity: Severity;
  re: RegExp;
  message: string;
  /** Optional guard to suppress obvious false positives (e.g. placeholders). */
  ignore?: (matchText: string, fullLine: string) => boolean;
}

const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<|\$\{|process\.env|import\.meta\.env|changeme|dummy|test)/i;

const RULES: Rule[] = [
  {
    rule: 'hardcoded-secret',
    severity: 'high',
    // key/secret/password/token assigned a non-trivial string literal.
    re: /\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"`]([^'"`]{8,})['"`]/i,
    message: 'Hardcoded credential — load it from an environment variable instead.',
    ignore: (_m, line) => PLACEHOLDER.test(line),
  },
  {
    rule: 'connection-string-credentials',
    severity: 'high',
    // user:password baked into a DB/queue connection-string URI (scheme://user:pass@host).
    // The assignment-based hardcoded-secret rule misses this URI form entirely.
    re: /\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?):\/\/[^\s:'"`@/]*:([^\s:'"`@/]{3,})@/i,
    message: 'Credentials embedded in a connection string — move the user/password to environment variables; never commit live DB/queue credentials.',
    ignore: (_m, line) => PLACEHOLDER.test(line),
  },
  {
    rule: 'aws-access-key',
    severity: 'high',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'Hardcoded AWS access key id — remove it and use a secret manager.',
  },
  {
    rule: 'private-key',
    severity: 'high',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    message: 'Private key committed in source — remove it immediately.',
  },
  {
    rule: 'eval-usage',
    severity: 'medium',
    re: /\beval\s*\(/,
    message: 'Use of eval() — avoid it; it enables code injection.',
    ignore: (_m, line) => /\/\/|\*/.test(line.slice(0, line.indexOf('eval'))),
  },
  {
    rule: 'dangerous-html',
    severity: 'medium',
    re: /dangerouslySetInnerHTML/,
    message: 'dangerouslySetInnerHTML — sanitise the HTML or it enables XSS.',
  },
  {
    rule: 'insecure-http',
    severity: 'low',
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+['"`]/,
    message: 'Insecure http:// URL — use https:// for remote endpoints.',
  },
];

/** Scan one file's content for security findings. Returns [] for non-issues. */
export function scanSecurity(file: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified/huge lines
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (m && !(r.ignore && r.ignore(m[0], line))) {
        findings.push({ file, line: i + 1, severity: r.severity, rule: r.rule, message: r.message });
      }
    }
  }
  return findings;
}

/** A concise, honest security report for the agent. */
export function securitySummary(findings: SecurityFinding[]): string {
  if (findings.length === 0) return 'Security scan: no hardcoded secrets or dangerous patterns found.';
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = findings.reduce(
    (acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc),
    {} as Record<Severity, number>,
  );
  const head = `Security scan: ${findings.length} issue(s) — ` +
    (['high', 'medium', 'low'] as Severity[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ') + '.';
  const body = sorted.slice(0, 20).map((f) => `  - [${f.severity}] ${f.file}:${f.line} ${f.rule} — ${f.message}`);
  return [head, ...body].join('\n');
}
