// Full-App Debugger — deterministic static scanner (admin request 2026-07-24).
//
// WHY THIS EXISTS: the AI Debugger tile could only analyze ONE pasted error. The admin asked for a
// real "scan the WHOLE app" system that reads every file and lists real problems + fixes. An LLM
// pass alone can hallucinate; so the debugger runs TWO layers and merges them:
//   1. THIS deterministic scanner — precise, zero-hallucination findings with EXACT file:line, from a
//      curated, low-false-positive rule set (leftover debug code, swallowed errors, eval, possible
//      hardcoded secrets, unfinished TODO/FIXME work, `as any` escape hatches, oversized files).
//   2. appDebugAnalysis.ts — an LLM semantic pass for deeper logic bugs the regexes can't see.
// Because this layer is deterministic, its findings are always REAL (no invented problems) and free.
//
// Pure + fully unit-testable. No I/O, no LLM, no provider names — safe on any file map.

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StaticFinding {
  severity: FindingSeverity;
  file: string;
  line: number;
  category: string;
  problem: string;
  suggestion: string;
  /** Marks the origin so the merged view can show a "verified" badge for deterministic findings. */
  source: 'static';
}

/** A very long line is almost always minified/generated — skip it (regex-blowup + false positives). */
const MAX_SCANNED_LINE_CHARS = 2_000;
/** Per-rule, per-file cap so one noisy file can't flood the report with hundreds of the same finding. */
const MAX_HITS_PER_RULE_PER_FILE = 20;
/** A source file above this many lines is flagged once as a maintainability smell. */
const LARGE_FILE_LINES = 1_200;

const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|php|java|kt|swift|c|cc|cpp|h|hpp|cs|vue|svelte)$/i;
const JS_TS_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;

/** Placeholder values that must NOT be reported as real secrets (demos, env indirection, blanks). */
const SECRET_PLACEHOLDER_RE =
  /(process\.env|import\.meta\.env|getenv|os\.environ|^\s*$|your[-_ ]?|example|placeholder|changeme|xxx+|<[^>]+>|\{\{|\$\{|todo|dummy|test[-_]?key|sample|redacted|\*{4,})/i;

/**
 * Curated secret shapes. Kept conservative on purpose: a false "you leaked a key" is worse than a
 * missed one, so generic assignments require a quoted, non-placeholder, non-trivial literal.
 */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\bASIA[0-9A-Z]{16}\b/, label: 'AWS temporary access key id' },
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/, label: 'Google API key' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/, label: 'secret API key (sk-…)' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/, label: 'GitHub personal access token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, label: 'GitHub fine-grained token' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, label: 'Slack token' },
  { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, label: 'private key' },
];

/** Generic `password/secret/apiKey = "literal"` — only when the literal looks real, not a placeholder. */
const GENERIC_SECRET_RE =
  /\b(passwd|password|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(['"`])([^'"`]{8,})\2/i;

function looksLikeRealSecret(literal: string): boolean {
  if (SECRET_PLACEHOLDER_RE.test(literal)) return false;
  // Require some entropy: a mix of letter case or digits, not a plain lowercase English word.
  const hasDigit = /\d/.test(literal);
  const hasUpper = /[A-Z]/.test(literal);
  const hasSymbol = /[^A-Za-z0-9]/.test(literal);
  return literal.length >= 12 && (hasDigit || hasUpper || hasSymbol);
}

/** True for a line that is only a comment (so a "TODO" in prose isn't double-counted as code). */
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*|#|<!--)/;

/**
 * Scan a single file's text for deterministic defects. `path` is only used to decide which rules
 * apply and to label findings — no filesystem access.
 */
export function scanFileStatic(path: string, content: string): StaticFinding[] {
  const out: StaticFinding[] = [];
  if (!content || typeof content !== 'string') return out;
  const isCode = CODE_EXT_RE.test(path);
  const isJsTs = JS_TS_EXT_RE.test(path);
  const lines = content.split('\n');

  const hits: Record<string, number> = {};
  const under = (rule: string): boolean => (hits[rule] = (hits[rule] || 0) + 1) <= MAX_HITS_PER_RULE_PER_FILE;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > MAX_SCANNED_LINE_CHARS) continue; // minified/generated line
    const line = i + 1;
    const isComment = COMMENT_LINE_RE.test(raw);

    // 1) Possible hardcoded secret — highest signal, scan every file type.
    let secretLabel = '';
    for (const { re, label } of SECRET_PATTERNS) {
      if (re.test(raw)) { secretLabel = label; break; }
    }
    if (!secretLabel) {
      const m = GENERIC_SECRET_RE.exec(raw);
      if (m && looksLikeRealSecret(m[3])) secretLabel = `${m[1].toLowerCase()} literal`;
    }
    if (secretLabel && under('secret')) {
      out.push({
        severity: 'high', file: path, line, category: 'security', source: 'static',
        problem: `Possible hardcoded ${secretLabel} committed in source.`,
        suggestion: 'Move the value to an environment variable / secrets store and rotate the exposed credential.',
      });
      continue;
    }

    if (!isCode) continue;

    // 2) eval() — code-injection risk.
    if (/\beval\s*\(/.test(raw) && !isComment && under('eval')) {
      out.push({
        severity: 'high', file: path, line, category: 'security', source: 'static',
        problem: 'Use of eval() executes arbitrary code and is a common injection vector.',
        suggestion: 'Replace eval() with a safe parser (JSON.parse) or explicit logic; never eval untrusted input.',
      });
    }

    // 3) Empty catch block on the same line — a silently swallowed error.
    if (/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/.test(raw) && under('empty-catch')) {
      out.push({
        severity: 'medium', file: path, line, category: 'error-handling', source: 'static',
        problem: 'Empty catch block swallows the error — failures become invisible and undebuggable.',
        suggestion: 'Log or handle the error, or rethrow it — never silently discard a caught exception.',
      });
    }

    // 4) Leftover debugger statement.
    if (isJsTs && /(^|[^A-Za-z0-9_.])debugger\s*;?\s*$/.test(raw) && !isComment && under('debugger')) {
      out.push({
        severity: 'medium', file: path, line, category: 'cleanup', source: 'static',
        problem: 'Leftover `debugger` statement will pause execution in the browser devtools.',
        suggestion: 'Remove the `debugger` statement before shipping.',
      });
    }

    // 5) Leftover console.log in shippable code (skip test/spec files).
    if (isJsTs && !/\.(test|spec)\./.test(path) && /\bconsole\.(log|debug)\s*\(/.test(raw) && !isComment && under('console')) {
      out.push({
        severity: 'low', file: path, line, category: 'cleanup', source: 'static',
        problem: 'Leftover console.log/debug in shippable code clutters output and can leak data.',
        suggestion: 'Remove the console statement or route it through a proper logger with levels.',
      });
    }

    // 6) Unfinished work markers.
    if (/(^|[^A-Za-z])(TODO|FIXME|XXX|HACK)([^A-Za-z]|:|$)/.test(raw) && under('todo')) {
      out.push({
        severity: 'low', file: path, line, category: 'incomplete', source: 'static',
        problem: 'Unfinished-work marker (TODO/FIXME/HACK) — the code path may be incomplete.',
        suggestion: 'Resolve the item and remove the marker, or track it in an issue if it is out of scope.',
      });
    }

    // 7) `as any` / `: any` escape hatches defeat type safety.
    if (isJsTs && !isComment && /\bas\s+any\b|:\s*any\b/.test(raw) && under('any')) {
      out.push({
        severity: 'low', file: path, line, category: 'type-safety', source: 'static',
        problem: '`any` disables TypeScript checking here, so real type errors can slip through.',
        suggestion: 'Give the value a precise type (or `unknown` + a narrowing guard) instead of `any`.',
      });
    }
  }

  // 8) Oversized source file — a maintainability smell (reported once, at line 1).
  if (isCode && lines.length > LARGE_FILE_LINES) {
    out.push({
      severity: 'low', file: path, line: 1, category: 'maintainability', source: 'static',
      problem: `Very large file (${lines.length} lines) — hard to review and a frequent source of hidden bugs.`,
      suggestion: 'Split this file into smaller, focused modules with single responsibilities.',
    });
  }

  return out;
}

/** Scan a whole `{path: content}` file map. Order is stable (input order), then per-file line order. */
export function scanFilesStatic(files: Record<string, string>): StaticFinding[] {
  const out: StaticFinding[] = [];
  for (const [path, content] of Object.entries(files || {})) {
    out.push(...scanFileStatic(path, content));
  }
  return out;
}
