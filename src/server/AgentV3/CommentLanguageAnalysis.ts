// AgentV3 — Generated-comment language guard (additive evaluate dimension).
//
// The NavBharatAI language standard (CLAUDE.md) requires all SOURCE CODE, including code COMMENTS, to be in
// professional English. The one sanctioned exception is runtime AI chat-bubble text — NOT the code the
// engine generates for a user's app. So a generated app that carries Hindi/Devanagari CODE COMMENTS is an
// honest standard violation this pass flags, so the builder can rewrite them in English.
//
// ⚠️ CRITICAL PRECISION BOUNDARY — Hindi UI is a FEATURE, never a defect. NavBharatAI is an Indian app
// builder: a generated app with Hindi UI STRINGS (labels, headings, JSX text like `<p>नमस्ते</p>`, a
// `"नमस्ते"` string literal) is exactly what many users want and MUST NEVER be flagged — flagging it would
// push the builder to strip legitimate Hindi UI, a real product downgrade. Therefore this scan is
// deliberately restricted to text that CANNOT be a UI string:
//   • PURE comment lines — a trimmed line that STARTS with `//` (JS/TS/Go/Java/C family) or `#` (only in
//     Python/Ruby/shell/YAML files, where `#` is a comment; NOT in CSS, where `#` is a colour/id selector).
//   • BLOCK comments — the text inside `/* … */` and HTML/template `<!-- … -->` (this already covers JSDoc
//     ` * continuation` lines, so a bare `*`-prefixed line is intentionally NOT treated as a comment — that
//     would false-positive on a Devanagari markdown bullet `* सूची` sitting inside a template literal).
// A `//` that appears mid-line after code (`foo(); // …`) is NOT scanned, because a naive `//` split would
// also match inside a string (`"https://…"`) — so trailing comments are conservatively skipped to guarantee
// no string literal is ever misread as a comment. Lower recall, ZERO false positives on Hindi UI.
//
// Read-only, deterministic, dependency-free. Advisory only (severity 'low') — it lowers the score gently and
// NEVER blocks a build. No code files / no Devanagari in comments ⇒ zero findings.

export interface CommentLanguageIssue {
  file: string;
  /** 1-based line number where the non-English comment text was found. */
  line: number;
  /** A short trimmed snippet of the offending comment (for the report). */
  sample: string;
  severity: 'low';
  kind: 'non-english-comment';
}

/** Devanagari block — the script of Hindi/Marathi/etc. A comment containing any of it is non-English. */
const DEVANAGARI_RE = /[ऀ-ॿ]/;

/** Source files whose comments the standard governs. Docs/data/markup-text files are excluded. */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|css|scss|sass|less|html?|py|rb|go|java|kt|rs|php|sh|bash|yml|yaml)$/i;
/** Files whose `#` lines are genuine comments (elsewhere `#` is a CSS selector / not a comment). */
const HASH_COMMENT_EXT = /\.(py|rb|sh|bash|yml|yaml)$/i;
/** Generated / vendored / test trees are not the app's shipped source. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

// Block-comment forms: C-style slash-star ... star-slash and markup <!-- ... -->. Non-greedy, across newlines.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g;

const MAX_SAMPLE = 80;
const sample = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_SAMPLE ? `${t.slice(0, MAX_SAMPLE)}…` : t;
};

/** Line number (1-based) of a character offset within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Scan one source file for non-English (Devanagari) text in CODE COMMENTS only. Pure + deterministic.
 * A UI string / JSX text with Hindi is NEVER matched (see the precision boundary above).
 */
export function scanCommentLanguage(path: string, code: string): CommentLanguageIssue[] {
  if (typeof code !== 'string' || !code) return [];
  const out: CommentLanguageIssue[] = [];
  const seen = new Set<number>(); // dedupe by line

  // 1) Block comments (/* … */ and <!-- … -->): flag the block's start line if any Devanagari inside.
  for (const m of code.matchAll(BLOCK_COMMENT_RE)) {
    if (DEVANAGARI_RE.test(m[0])) {
      const line = lineAt(code, m.index ?? 0);
      if (!seen.has(line)) {
        seen.add(line);
        out.push({ file: path, line, sample: sample(m[0]), severity: 'low', kind: 'non-english-comment' });
      }
    }
  }

  // 2) Pure line comments: a trimmed line starting with `//` (JS family) or `#` (hash-comment langs only).
  //    A bare `*` line is NOT treated as a comment — genuine JSDoc is already caught by the block scan above,
  //    and treating `*` as a comment marker would false-positive on a Devanagari markdown bullet in a string.
  const allowHash = HASH_COMMENT_EXT.test(path);
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isLineComment = trimmed.startsWith('//') || (allowHash && trimmed.startsWith('#'));
    if (!isLineComment) continue;
    if (!DEVANAGARI_RE.test(trimmed)) continue;
    const line = i + 1;
    if (seen.has(line)) continue; // already reported via a block comment
    seen.add(line);
    out.push({ file: path, line, sample: sample(trimmed), severity: 'low', kind: 'non-english-comment' });
  }

  return out.sort((a, b) => a.line - b.line);
}

/** Scan a whole project's source files. Returns [] when every comment is in English. Pure. */
export function scanProjectCommentLanguage(files: Record<string, string>): CommentLanguageIssue[] {
  const out: CommentLanguageIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_EXT.test(path) || SKIP_PATH.test(path)) continue;
    out.push(...scanCommentLanguage(path, content));
  }
  return out;
}

/** A concise, honest report for the agent. Pure. Never mentions the UI-string case (that is never flagged). */
export function commentLanguageSummary(issues: CommentLanguageIssue[]): string {
  if (issues.length === 0) return 'Comment-language scan: ✓ All code comments are in English.';
  const shown = issues.slice(0, 8);
  const body = shown.map((x) => `  - [${x.severity}] ${x.file}:${x.line} — non-English comment: ${x.sample}`);
  const more = issues.length > shown.length ? [`  … and ${issues.length - shown.length} more.`] : [];
  return [
    `Comment-language scan: ${issues.length} non-English code comment(s) — the NavBharatAI standard requires code comments in professional English (Hindi UI text is fine; only comments must be English). Rewrite these comments in English.`,
    ...body,
    ...more,
  ].join('\n');
}
