// AgentV3 — Authenticity / Completeness analysis (additive third evaluate dimension).
//
// Real static scanning over the actual source the agent writes, for FAKE or
// INCOMPLETE code — the thing NavBharatAI's constitution forbids ("real features
// only, no fakes"). Findings are computed deterministically from real content so
// the `evaluate` tool can report concrete placeholder/stub/TODO defects for the
// team to fix — never a synthetic "looks complete".

export type AuthenticitySeverity = 'high' | 'medium' | 'low';

export interface AuthenticityIssue {
  file: string;
  line: number;
  kind: string;
  severity: AuthenticitySeverity;
  snippet: string;
}

interface Rule {
  kind: string;
  severity: AuthenticitySeverity;
  re: RegExp;
  /** Optional guard to suppress obvious false positives. */
  ignore?: (matchText: string, fullLine: string) => boolean;
}

/** Paths we never scan — generated, vendored, or test code. */
const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)|(^|[\\/])specs?([\\/]|$)/i;

const SNIPPET_MAX = 120;

const RULES: Rule[] = [
  // ── high: explicit "not implemented" / placeholder throws ────────────────
  {
    kind: 'not-implemented',
    severity: 'high',
    re: /\b(not[\s_-]*implemented|notimplemented|NotImplementedError|unimplemented)\b/i,
  },
  {
    kind: 'placeholder-throw',
    severity: 'high',
    re: /throw\s+new\s+\w*Error\s*\(\s*['"`]?\s*(not[\s_-]*implemented|todo|unimplemented|fixme)/i,
  },
  // ── high: explicit fake/stub markers in non-test files ───────────────────
  {
    kind: 'lorem-ipsum',
    severity: 'high',
    re: /lorem\s+ipsum/i,
  },
  {
    kind: 'fake-data-identifier',
    severity: 'high',
    re: /\b(fakeData|mockData|dummyData)\b/,
  },
  {
    kind: 'dummy-data',
    severity: 'high',
    re: /\bdummy\s+data\b/i,
  },
  {
    kind: 'stub-marker',
    severity: 'high',
    // a left-in stub/placeholder comment or string, not a legitimate identifier.
    // ROOT-CAUSE FIX (2026-07-04, from a real blocked build): `(?![-:])` excludes
    // Tailwind's `placeholder:`/`placeholder-*` utility classes inside quoted class
    // strings (e.g. 'placeholder:text-gray-400', 'placeholder-gray-400') — real UI
    // styling that the old rule counted as "fake/incomplete code" and hard-blocked
    // a complete working app's readiness. A genuine `// placeholder` comment or a
    // "this is a stub" string is still flagged.
    re: /(?:\/\/|\/\*|#|["'`])\s*(this is a )?(placeholder|stub)\b(?![-:])/i,
  },
  {
    kind: 'placeholder-image',
    severity: 'medium',
    // Unambiguous placeholder-image generators left in an <img src>/url — fake
    // content shipped as real, against the "real features only" rule. Conservative:
    // only services whose name IS "placeholder/dummy" (picsum/unsplash are excluded —
    // they serve real photos and are used in shipping apps).
    re: /\b(via\.placeholder\.com|placehold\.(co|it)|placekitten\.com|placeimg\.com|dummyimage\.com|lorempixel\.com)\b/i,
  },
  {
    kind: 'coming-soon',
    severity: 'high',
    // "coming soon" filler = an unimplemented section shipped as done. Deliberately
    // NARROW: the constitution itself MANDATES honest "not available" states for
    // features whose infrastructure is missing — so "not available yet" is legitimate
    // honest UI text (same bug class as the Tailwind-placeholder false positive:
    // legitimate UI language mistaken for a fake-code marker) and must not be flagged.
    re: /\bcoming\s+soon\b/i,
  },
  // ── medium: standard TODO/FIXME/HACK comment markers ─────────────────────
  {
    kind: 'todo-marker',
    severity: 'medium',
    re: /(?:\/\/|\/\*|#|<!--)\s*(TODO|FIXME)\b|\b(XXX|HACK)\s*:/,
  },
  // ── medium: a left-in `debugger;` statement (pauses in devtools; must not ship)
  {
    kind: 'debugger-statement',
    severity: 'medium',
    re: /(?:^|[^.\w])debugger\s*;/,
    ignore: (_m, line) => /^\s*(\/\/|\*|\/\*)/.test(line),
  },
  // ── medium: `@ts-nocheck` disables type-checking for the WHOLE file, hiding
  // every real type error in it — fake "it compiles" against "real features only".
  {
    kind: 'ts-nocheck',
    severity: 'medium',
    re: /@ts-nocheck\b/,
  },
  // ── low: a blind `@ts-ignore` silences the next line's type error without
  // proving one exists (unlike `@ts-expect-error`, which is intentional and is
  // NOT flagged). Often hides a real bug behind a green build. ─────────────────
  {
    kind: 'ts-ignore',
    severity: 'low',
    re: /@ts-ignore\b/,
  },
  // ── low: a BARE eslint-disable (no rule named) turns OFF every lint rule for the
  // file or line, hiding real problems. A disable that names specific rules
  // (`eslint-disable no-console`) is intentional and is NOT flagged. ───────────────
  {
    kind: 'eslint-disable-all',
    severity: 'low',
    re: /eslint-disable(?:-(?:next-)?line)?\b\s*(?:\*\/\s*)?$/,
  },
  {
    // A classic leftover debug print — console.log with a bare number or a throwaway
    // sentinel string ("here"/"test"/"asdf"…). High-precision: only these unambiguous
    // debug arguments, never a real log message.
    kind: 'debug-console-log',
    severity: 'low',
    re: /console\.log\s*\(\s*(?:\d+|['"`](?:here|test(?:ing)?|hello|hi|debug|x+|a{3,}|asdf|todo|wip|foo|bar|baz)\d*['"`])\s*\)/i,
  },
  // ── low: hardcoded obviously-fake return values left in code ──────────────
  {
    kind: 'fake-return',
    severity: 'low',
    re: /return\s+(true|false|null|\[\]|\{\}|0|''|"")\s*;?\s*(?:\/\/|\/\*)\s*(TODO|FIXME|placeholder|stub|fake|hack)/i,
  },
  {
    kind: 'weak-default-password',
    severity: 'low',
    re: /\bpassword\b\s*[:=]\s*['"`](changeme|test123|123456|password)['"`]/i,
  },
  {
    // A left-in placeholder contact email on the RFC-reserved example.* domains —
    // shipped as if real (support@example.com etc.), against "real features only".
    kind: 'placeholder-email',
    severity: 'low',
    re: /@example\.(?:com|org|net)\b/i,
  },
  {
    // A promise `.catch(() => {})` with an EMPTY body silently swallows the rejection —
    // the async failure is hidden and the app looks like it worked (the promise-chain
    // twin of an empty try/catch). A catch with a real body or a comment is not matched.
    kind: 'empty-promise-catch',
    severity: 'low',
    re: /\.catch\s*\(\s*(?:\(\s*[a-zA-Z_$][\w$]*\s*\)|\(\s*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/,
  },
];

/**
 * Detect a function/handler whose body is ONLY a single `console.log(...)` call
 * (or only a comment) — an empty/placeholder handler. Conservative: requires a
 * `{ ... }` block whose sole statement is a console.log or whose body is empty
 * but for a comment. Returns the 1-based line of the offending body, or 0.
 */
function emptyHandlerLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    // An opening brace that starts an actual FUNCTION/ARROW body — `) => {` or `function … {`. The
    // `=>` is REQUIRED (not optional): without it, a bare `) {` matched every control-flow header
    // (`if (…) {`, `for (…) {`, `while (…) {`, `catch (…) {`), so a legitimate guard whose body is a
    // single `console.log` was mislabeled an "empty handler". A real handler here is an arrow or a
    // function, never an `if`/`for`/`while`.
    if (!/(\)\s*=>\s*\{|\bfunction\b[^{]*\{)\s*$/.test(lines[i])) continue;
    // Collect the body until the matching close brace at the same indent feel.
    const body: { text: string; line: number }[] = [];
    let closed = false;
    for (let j = i + 1; j < lines.length && j < i + 8; j++) {
      const t = lines[j].trim();
      if (t === '}' || t === '};' || t === '})' || t === '});') {
        closed = true;
        break;
      }
      if (t === '') continue;
      body.push({ text: t, line: j + 1 });
    }
    if (!closed) continue;
    const meaningful = body.filter(
      (b) => !b.text.startsWith('//') && !b.text.startsWith('/*') && !b.text.startsWith('*'),
    );
    if (meaningful.length === 1 && /^console\.log\s*\(/.test(meaningful[0].text)) {
      return meaningful[0].line;
    }
    if (meaningful.length === 0 && body.length > 0) {
      // body has content but it is all comments → placeholder handler.
      return body[0].line;
    }
  }
  return 0;
}

/**
 * Detect empty catch blocks — `catch {}`, `catch (e) {}`, or a multiline catch whose
 * body is only whitespace — which silently SWALLOW the error: the app looks like it
 * works while a real failure is hidden (directly against "the app must never break").
 * A catch whose body contains a comment is NOT flagged — that is an explicitly
 * documented, intentional ignore. Returns the 1-based line numbers of the `catch`.
 */
function emptyCatchLines(content: string): number[] {
  if (content.length > 500_000) return []; // skip pathologically large/minified files
  const out: number[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{[ \t\r\n]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push(content.slice(0, m.index).split('\n').length);
  }
  return out;
}

/** Scan one file's content for authenticity/completeness issues. Returns [] for non-issues. */
export function scanAuthenticity(file: string, content: string): AuthenticityIssue[] {
  if (SKIP_PATH.test(file)) return [];
  const issues: AuthenticityIssue[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified/huge lines
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (m && !(r.ignore && r.ignore(m[0], line))) {
        issues.push({
          file,
          line: i + 1,
          kind: r.kind,
          severity: r.severity,
          snippet: trimSnippet(line),
        });
      }
    }
  }
  const emptyLine = emptyHandlerLine(lines);
  if (emptyLine > 0) {
    issues.push({
      file,
      line: emptyLine,
      kind: 'empty-handler',
      severity: 'medium',
      snippet: trimSnippet(lines[emptyLine - 1] ?? ''),
    });
  }
  for (const catchLine of emptyCatchLines(content)) {
    issues.push({
      file,
      line: catchLine,
      kind: 'empty-catch',
      severity: 'low',
      snippet: trimSnippet(lines[catchLine - 1] ?? ''),
    });
  }
  return issues;
}

function trimSnippet(line: string): string {
  const t = line.trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX) + '…' : t;
}

/**
 * Scan a whole workspace and return ONLY the HIGH-severity issues — the ones that actually block a build
 * (a placeholder / not-implemented / fake-data stub the model left behind). Medium/low are advisory and
 * are deliberately excluded, so an incomplete-code heal fires only on genuine build-breakers. Pure.
 */
export function highSeverityAuthenticityIssues(files: Record<string, string>): AuthenticityIssue[] {
  const out: AuthenticityIssue[] = [];
  for (const [path, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string' || !content) continue;
    for (const issue of scanAuthenticity(path, content)) {
      if (issue.severity === 'high') out.push(issue);
    }
  }
  return out;
}

/**
 * A FOCUSED repair instruction to COMPLETE incomplete/placeholder code the model left behind — the
 * "real features only" law (rule 2), enforced as a heal. Names the exact file:line so the completion pass
 * fixes what the readiness scan flagged, and forbids the escape hatches (delete/comment-out/fake) that
 * would merely hide the stub instead of implementing it. Pure.
 */
export function authenticityRepairInstruction(issues: AuthenticityIssue[]): string {
  const locations = issues.slice(0, 15).map((x) => `  - ${x.file}:${x.line} — ${x.kind}: ${x.snippet}`).join('\n');
  return [
    'The app was built, but a readiness scan found INCOMPLETE / PLACEHOLDER / NOT-IMPLEMENTED code that',
    'must be completed before it can work. For EACH location below, replace the stub with a REAL, WORKING',
    'implementation that does what the surrounding code expects — the actual function body, the real logic,',
    'the real data flow.',
    '',
    'STRICT RULES:',
    '  • NO placeholder, NO "TODO"/"FIXME", NO "not implemented", NO fake/hardcoded sample data.',
    '  • Do NOT delete the feature, comment it out, or throw to hide it — IMPLEMENT it for real.',
    '  • Keep everything else that already works untouched; change only what is needed to complete these.',
    '',
    'Locations the scan flagged:',
    locations,
  ].join('\n');
}

/** A concise, honest authenticity/completeness report for the agent. */
export function authenticitySummary(issues: AuthenticityIssue[]): string {
  if (issues.length === 0) return 'Authenticity scan: ✓ No fake/incomplete code detected.';
  const order: Record<AuthenticitySeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<AuthenticitySeverity, number>,
  );
  const head = `Authenticity scan: ${issues.length} issue(s) — ` +
    (['high', 'medium', 'low'] as AuthenticitySeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const shown = sorted.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.file}:${x.line} — ${x.kind}: ${x.snippet}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more].join('\n');
}
