// GA-13 (supply-chain & threat) — threat-modeling. The CVE/OSV scanner (VulnScanner) covers KNOWN
// vulnerable dependencies; this covers the app's OWN code — a deterministic, STRIDE-flavoured scan for
// the highest-signal web-app security defects a generated app commonly ships with: a secret hardcoded
// into client code, a wildcard CORS with credentials, SQL built by string interpolation (injection),
// XSS via dangerouslySetInnerHTML from a non-constant, and eval/new Function on a non-literal.
//
// HIGH-PRECISION by design (a false security warning erodes trust — same lesson as AP-9): every rule
// fires only on an unambiguous, exploitable pattern, never a vague heuristic. PURE + dependency-free
// (regex over source text), never throws. ADVISORY only in `evaluate` — never blocks a build.

export type ThreatKind =
  | 'client-secret' | 'cors-wildcard-credentials' | 'sql-injection' | 'xss-dangerous-html' | 'eval-injection';

export interface ThreatFinding {
  kind: ThreatKind;
  severity: 'high' | 'medium';
  file: string;
  line: number;
  message: string;
}

const CODE_FILE = /\.(t|j)sx?$/;
const EXCLUDE = /(^|\/)(node_modules|dist|build|coverage|\.next|\.git|__tests__)\//;
const TEST_FILE = /\.(test|spec)\.[tj]sx?$|(^|\/)(tests?|__tests__|__mocks__)\//i;
/** A frontend/client file (browser-shipped) — where a secret must NEVER live. */
const CLIENT_FILE = /(^|\/)(src|app|components?|pages?|client|web|frontend|ui)\//i;
const SERVER_FILE = /(^|\/)(server|api|backend|routes?|controllers?|services?|functions?)\//i;

/** Real secret shapes (not a generic "long string") — high precision. */
const SECRET_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\bsk_live_[0-9a-zA-Z]{16,}/, what: 'a Stripe live secret key' },
  { re: /\brk_live_[0-9a-zA-Z]{16,}/, what: 'a Stripe restricted live key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key id' },
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/, what: 'a Google API key' },
  { re: /\bghp_[0-9A-Za-z]{36}\b/, what: 'a GitHub personal access token' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, what: 'a Slack token' },
  { re: /\bSG\.[0-9A-Za-z_\-]{16,}\.[0-9A-Za-z_\-]{16,}/, what: 'a SendGrid API key' },
  { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, what: 'a private key' },
];

/** True for a placeholder/example value that is NOT a real leak (your_key_here, xxxx, env refs). */
function looksPlaceholder(line: string): boolean {
  return /your[_-]?(api[_-]?)?key|example|placeholder|xxxx|<[^>]+>|process\.env|import\.meta\.env|\$\{/.test(line.toLowerCase());
}

/**
 * Scan project sources for the highest-signal own-code security threats. Pure; never throws. Sorted by
 * file+line. `sources` is the generated app's files (path + content).
 */
export function analyzeThreatModel(sources: Array<{ path: string; content: string }>): ThreatFinding[] {
  if (!Array.isArray(sources)) return [];
  const out: ThreatFinding[] = [];
  const MAX = 60;
  for (const src of sources) {
    if (!src || typeof src.path !== 'string' || typeof src.content !== 'string') continue;
    const { path } = src;
    if (!CODE_FILE.test(path) || EXCLUDE.test(path) || TEST_FILE.test(path)) continue;
    const isClient = CLIENT_FILE.test(path) && !SERVER_FILE.test(path);
    const lines = src.content.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < MAX; i++) {
      const line = lines[i];
      const stripped = line.replace(/\/\/.*$/, '');
      const n = i + 1;

      // (1) Secret hardcoded in CLIENT code — it ships to the browser and is trivially extractable.
      if (isClient && !looksPlaceholder(line)) {
        for (const s of SECRET_PATTERNS) {
          if (s.re.test(line)) {
            out.push({ kind: 'client-secret', severity: 'high', file: path, line: n,
              message: `${s.what} is hardcoded in client-side code — it ships to every visitor's browser. Move it server-side and reference it via an API.` });
            break;
          }
        }
      }

      // (2) Wildcard CORS WITH credentials — lets any origin make authenticated requests.
      if (/origin\s*:\s*['"`]\*['"`]/.test(stripped) && /credentials\s*:\s*true/.test(src.content)) {
        out.push({ kind: 'cors-wildcard-credentials', severity: 'high', file: path, line: n,
          message: 'CORS allows any origin (*) together with credentials:true — any site can make authenticated requests. Pin an explicit allowed-origin list.' });
      }

      // (3) SQL built by string interpolation → injection. A SQL keyword inside a template literal with
      //     an interpolation, or a string concatenation, passed to a query/execute call.
      if (/\b(query|execute|raw|exec)\s*\(/.test(stripped)) {
        const sqlTemplate = /`[^`]*\b(select|insert|update|delete|drop|where|from)\b[^`]*\$\{/i.test(stripped);
        const sqlConcat = /['"][^'"]*\b(select|insert|update|delete|where|from)\b[^'"]*['"]\s*\+/i.test(stripped);
        if (sqlTemplate || sqlConcat) {
          out.push({ kind: 'sql-injection', severity: 'high', file: path, line: n,
            message: 'SQL is assembled with string interpolation/concatenation — an injection risk. Use parameterized queries ($1/?) instead of embedding values.' });
        }
      }

      // (4) XSS: dangerouslySetInnerHTML fed a non-literal (a variable/expression, not a constant string).
      const dsi = stripped.match(/dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*([^}]+)\}\}/);
      if (dsi) {
        const val = dsi[1].trim();
        const isLiteral = /^['"`]/.test(val);
        const sanitized = /sanitiz|dompurify|purify/i.test(val);
        if (!isLiteral && !sanitized) {
          out.push({ kind: 'xss-dangerous-html', severity: 'medium', file: path, line: n,
            message: 'dangerouslySetInnerHTML is set from a non-constant value without sanitization — an XSS risk. Sanitize the HTML (e.g. DOMPurify) or render as text.' });
        }
      }

      // (5) eval / new Function on a non-literal argument — code injection.
      const evalCall = stripped.match(/\b(?:eval|new\s+Function)\s*\(\s*([^)]*)/);
      if (evalCall) {
        const arg = evalCall[1].trim();
        if (arg && !/^['"`]/.test(arg)) {
          out.push({ kind: 'eval-injection', severity: 'high', file: path, line: n,
            message: 'eval()/new Function() is called on a non-literal value — arbitrary code execution if it reaches user input. Replace with a safe parser or explicit logic.' });
        }
      }
    }
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Advisory `evaluate` line, or '' when clean. Pure. */
export function threatModelSummary(findings: ThreatFinding[]): string {
  if (!findings || findings.length === 0) return '';
  const high = findings.filter((f) => f.severity === 'high').length;
  const shown = findings.slice(0, 8).map((f) => `  ${f.severity === 'high' ? '🔴' : '⚠️'} ${f.file}:${f.line} — ${f.message}`);
  return `Threat model — ${findings.length} security issue(s)${high ? ` (${high} high)` : ''} in the app's own code:\n${shown.join('\n')}${findings.length > 8 ? `\n  …and ${findings.length - 8} more` : ''}`;
}
