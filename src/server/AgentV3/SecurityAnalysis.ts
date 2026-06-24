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
    rule: 'hardcoded-jwt-secret',
    severity: 'high',
    // jwt.sign(payload, '<literal>'[, opts]) — a hardcoded signing secret lets anyone
    // with the source forge tokens. The assignment-based hardcoded-secret rule misses
    // this function-argument form. `.*?,` skips the payload (object/variable) so the
    // secret arg is matched whether or not an options object follows.
    re: /\b(?:jwt|jsonwebtoken)\.sign\s*\(.*?,\s*(['"`])[^'"`]{4,}\1\s*[,)]/,
    message: 'Hardcoded JWT signing secret — anyone with the source can forge tokens; load it from an environment variable.',
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
    rule: 'dynamic-function',
    severity: 'medium',
    // `new Function('...')` builds code from a string at runtime — eval()'s twin. The
    // \b after Function avoids matching `new FunctionComponent(...)` and similar.
    re: /\bnew\s+Function\b\s*\(/,
    message: 'new Function() builds code from a string — like eval(), it enables code injection; avoid it.',
  },
  {
    rule: 'command-injection',
    severity: 'high',
    // A child_process shell sink (exec/execFile/spawn, sync or async) whose command is
    // built from a template interpolation (`...${x}`) or a string concatenation
    // ("..." + x) — the classic command-injection vector. The negative lookbehind
    // excludes method calls like `regex.exec(...)` / `cp.exec(...)` so RegExp.exec and
    // other libraries are not false-positives (a documented precision trade-off: the
    // `cp.exec(...)` member form is not matched — prefer the imported `exec(...)` form).
    re: /(?<![.\w])(?:exec|execFile|spawn)(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*\S)/,
    message: 'Shell command built from dynamic input — this enables command injection; validate/escape the input or use execFile with an args array (no shell).',
  },
  {
    rule: 'dangerous-html',
    severity: 'medium',
    re: /dangerouslySetInnerHTML/,
    message: 'dangerouslySetInnerHTML — sanitise the HTML or it enables XSS.',
  },
  {
    rule: 'unsafe-html-sink',
    severity: 'medium',
    // Vanilla-DOM XSS sinks the React rule misses: assigning to innerHTML/outerHTML, or
    // insertAdjacentHTML. `=(?!=)` excludes ==/=== comparisons; empty-string clears are
    // ignored below.
    re: /\.(inner|outer)HTML\s*=(?!=)|\.insertAdjacentHTML\s*\(/,
    message: 'Writing raw HTML (innerHTML/outerHTML/insertAdjacentHTML) enables XSS — sanitise the HTML or use textContent.',
    ignore: (_m, line) => /\.(?:inner|outer)HTML\s*=\s*(['"`])\s*\1/.test(line),
  },
  {
    rule: 'sql-injection',
    severity: 'high',
    // A SQL statement built by interpolating/concatenating a value straight into the
    // query string — the classic SQL-injection vector. High-precision: the string must
    // actually start with a SQL verb (SELECT/INSERT/UPDATE/DELETE) AND contain a
    // template `${…}` interpolation, OR be concatenated with a non-literal (`"…" + x`).
    // Parameterised queries (`query('… WHERE id = ?', [id])`) have no `${`/`+ var`, so
    // they are not flagged. `(?!['"])` after `+` excludes safe literal+literal joins.
    re: /`\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{|['"]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+\s*(?!['"])\S/i,
    message: 'SQL query built from interpolated/concatenated input — this enables SQL injection; use parameterised queries (placeholders + a values array) instead.',
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
