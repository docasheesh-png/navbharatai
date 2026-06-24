// AgentV3 — Correctness: async-pattern footguns (Section I #6 — Execution quality).
//
// `array.forEach(async (x) => { await ... })` is a classic bug: forEach ignores the
// promise each callback returns, so the awaits do NOT sequence, the loop does not wait
// for them, and any rejection becomes an unhandled promise rejection (silently swallowed).
// The code looks correct and "compiles", but data races and lost errors follow at runtime
// — directly against "the app must never break". This PURE, deterministic scanner flags it
// so it is rewritten as a `for...of` loop with await, or `await Promise.all(arr.map(...))`.

export interface AsyncPatternIssue {
  file: string;
  line: number;
  kind: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
// `.forEach(async ...)` — an async callback passed to forEach (arrow or function form).
const FOREACH_ASYNC_RE = /\.forEach\s*\(\s*async\b/;

/** Scan one file for async-pattern footguns. PURE. */
export function scanAsyncPatterns(file: string, content: string): AsyncPatternIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: AsyncPatternIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    if (FOREACH_ASYNC_RE.test(line)) {
      issues.push({ file, line: i + 1, kind: 'async-foreach' });
    }
  }
  return issues;
}

/** A short, honest async-pattern block for the `evaluate` output. */
export function asyncPatternSummary(issues: AsyncPatternIssue[]): string {
  if (issues.length === 0) return 'Async patterns: ✓ no await-in-forEach footguns.';
  const head = `Async patterns — ${issues.length} forEach(async …) (the loop does not await; errors are swallowed):`;
  const body = issues
    .slice(0, 10)
    .map((x) => `  ⚠ ${x.file}:${x.line} — forEach(async …) → use for...of with await, or await Promise.all(arr.map(...)).`);
  return [head, ...body].join('\n');
}
