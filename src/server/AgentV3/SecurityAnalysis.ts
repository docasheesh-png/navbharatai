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
    rule: 'settimeout-string',
    severity: 'medium',
    // setTimeout/setInterval with a STRING first argument runs it as code (an eval) —
    // code injection + a CSP violation. Matches only a quoted first arg; a function
    // argument (setTimeout(() => …) / setTimeout(fn, …)) is not matched.
    re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
    message: 'setTimeout/setInterval with a string argument runs it as code (an eval — code injection, breaks CSP); pass a function instead.',
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
    rule: 'weak-crypto-cipher',
    severity: 'high',
    // crypto.createCipher()/createDecipher() (no IV) are deprecated and insecure:
    // they derive the key/IV from a password with a single MD5 pass, producing the
    // SAME ciphertext for the same input every time (no randomness). The `\s*\(`
    // right after the name excludes the correct `createCipheriv(`/`createDecipheriv(`.
    re: /\.create(?:De)?[Cc]ipher\s*\(/,
    message: 'crypto.createCipher()/createDecipher() are insecure (no IV, MD5 key derivation) — use createCipheriv()/createDecipheriv() with a random IV instead.',
  },
  {
    rule: 'dangerous-html',
    severity: 'medium',
    re: /dangerouslySetInnerHTML/,
    message: 'dangerouslySetInnerHTML — sanitise the HTML or it enables XSS.',
  },
  {
    rule: 'vue-v-html',
    severity: 'medium',
    // Vue's v-html binding renders a raw HTML string into the DOM — the framework
    // equivalent of dangerouslySetInnerHTML and an XSS sink when the value is dynamic.
    re: /\bv-html\s*=/,
    message: 'Vue v-html renders raw HTML (XSS sink) — sanitise the HTML or render text with {{ }} / v-text instead.',
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
    rule: 'document-write',
    severity: 'medium',
    // document.write()/.writeln() injects raw HTML (an XSS sink when fed dynamic data),
    // blocks the parser, and silently wipes the whole page if called after load.
    re: /\bdocument\.write(?:ln)?\s*\(/,
    message: 'document.write() injects raw HTML (XSS sink) and blocks/overwrites the page — build DOM nodes, set textContent, or render via the framework instead.',
  },
  {
    rule: 'open-redirect',
    severity: 'medium',
    // res.redirect() to a value taken DIRECTLY from the request (req.query/params/body/
    // headers) is an open redirect — attackers craft a link to send users to a phishing
    // site. High-precision: the redirect target must START with req.* (optionally after a
    // status code), so `res.redirect(`/go?to=${req.query.x}`)` (fixed path) is not flagged.
    re: /\bres(?:ponse)?\.redirect\s*\(\s*(?:\d{3}\s*,\s*)?req\.(?:query|params|body|headers)\b/,
    message: 'Open redirect — res.redirect() to a value from the request lets attackers send users to a phishing site; validate against an allow-list of paths/hosts.',
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
    rule: 'hardcoded-auth-header',
    severity: 'high',
    // An Authorization header set to a literal `Bearer <token>` / `Basic <creds>` — a
    // hardcoded API/access credential the assignment-based hardcoded-secret rule misses
    // (its key-set has no "Authorization"). The PLACEHOLDER ignore excludes the correct
    // env form (`Bearer ${token}`) and obvious placeholders.
    re: /\bauthorization\b['"`]?\s*[:=]\s*(['"`])\s*(?:bearer|basic)\s+[^'"`]{8,}\1/i,
    message: 'Hardcoded Authorization credential (Bearer/Basic literal) — load the token from an environment variable instead of committing it.',
    ignore: (_m, line) => PLACEHOLDER.test(line),
  },
  {
    rule: 'hardcoded-provider-token',
    severity: 'high',
    // Distinctive provider credential formats (GitHub / Google / Slack / Stripe-live)
    // hardcoded in SOURCE. The assignment-based hardcoded-secret rule needs a known
    // key NAME, so a token stored under an arbitrary variable (`const k = "ghp_…"`) is
    // missed; these formats are unmistakable, so matching one is almost certainly a
    // real leaked credential. (EnvSecretValueAnalysis covers the same formats, but only
    // inside .env templates — this covers code.)
    re: /\bgh[posru]_[A-Za-z0-9]{30,}|\bAIza[0-9A-Za-z_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\b[rs]k_live_[A-Za-z0-9]{16,}/,
    message: 'Hardcoded API credential (GitHub/Google/Slack/Stripe token) in source — remove it, load it from an environment variable, and rotate the key since it was committed.',
    ignore: (_m, line) => PLACEHOLDER.test(line),
  },
  {
    rule: 'unsafe-target-blank',
    severity: 'medium',
    // A link opened with target="_blank" but no rel="noopener" lets the opened page
    // control this tab via window.opener (reverse tabnabbing — it can redirect the
    // original tab to a phishing page). The `noopener` guard below ignores the safe
    // form; same-line rel is the common case (a documented precision trade-off).
    re: /target\s*=\s*['"]_blank['"]/i,
    message: 'target="_blank" without rel="noopener" — the opened page can hijack this tab (reverse tabnabbing); add rel="noopener noreferrer".',
    ignore: (_m, line) => /noopener/i.test(line),
  },
  {
    rule: 'postmessage-wildcard-origin',
    severity: 'medium',
    // window.postMessage(data, '*') broadcasts the message to a frame at ANY origin —
    // a malicious/compromised iframe can read it. Always target a specific origin.
    re: /\.postMessage\s*\(\s*[^,]+,\s*['"]\*['"]\s*\)/,
    message: "postMessage(..., '*') sends data to any origin — pass the exact target origin instead of '*'.",
  },
  {
    rule: 'javascript-uri',
    severity: 'medium',
    // A `javascript:` URL in an href/src/action executes script when followed — an XSS
    // sink (especially when the URL is built from data) and a CSP violation. The common
    // no-op placeholders `javascript:void(0)` / `javascript:;` are ignored to keep
    // precision on the dangerous, script-bearing forms.
    re: /(?:href|src|to|action|formaction|xlink:href)\s*=\s*['"{]?\s*javascript:/i,
    message: 'javascript: URL in an href/src — following it executes script (XSS sink, breaks CSP); use an onClick handler or a real URL.',
    ignore: (_m, line) => /javascript:\s*(?:void\s*\(\s*0\s*\)|;)/i.test(line),
  },
  {
    rule: 'insecure-http',
    severity: 'low',
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+['"`]/,
    message: 'Insecure http:// URL — use https:// for remote endpoints.',
  },
  {
    rule: 'insecure-websocket',
    severity: 'low',
    // A non-encrypted ws:// socket to a remote host travels in the clear, and an https
    // page cannot open it at all (mixed content). Local dev sockets are not flagged.
    re: /['"`]ws:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+['"`]/,
    message: 'Insecure ws:// WebSocket to a remote host — use wss:// (an https page is blocked from opening a ws:// socket as mixed content).',
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
