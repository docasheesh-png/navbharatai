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
// `new Promise(async ...)` — an async executor. If it throws, the promise never
// rejects (the throw becomes an unhandled rejection) and resolve/reject do not see
// the error — a classic, silent correctness bug.
const NEW_PROMISE_ASYNC_RE = /\bnew\s+Promise\s*(<[^>]*>)?\s*\(\s*async\b/;
// `useEffect(async () => …)` — React expects the effect callback to return nothing
// or a cleanup function, but an async function returns a Promise. React cannot use it
// as cleanup, so cleanup silently never runs (leaks/stale state) — the eslint-react
// rule flags this too.
const USEEFFECT_ASYNC_RE = /\buseEffect\s*\(\s*async\b/;

/** Human-readable fix guidance per footgun kind. */
const FIX: Record<string, string> = {
  'async-foreach': 'forEach(async …) → use for...of with await, or await Promise.all(arr.map(...)).',
  'new-promise-async': 'new Promise(async …) → the async executor\'s errors are swallowed (the promise never rejects); do the async work before the Promise, or call resolve/reject from .then/.catch.',
  'async-useeffect': 'useEffect(async …) → the effect returns a Promise, so React never runs cleanup; define an async function inside and call it (and return a real cleanup if needed).',
};

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
    if (NEW_PROMISE_ASYNC_RE.test(line)) {
      issues.push({ file, line: i + 1, kind: 'new-promise-async' });
    }
    if (USEEFFECT_ASYNC_RE.test(line)) {
      issues.push({ file, line: i + 1, kind: 'async-useeffect' });
    }
  }
  return issues;
}

/** A short, honest async-pattern block for the `evaluate` output. */
export function asyncPatternSummary(issues: AsyncPatternIssue[]): string {
  if (issues.length === 0) return 'Async patterns: ✓ no async footguns (await-in-forEach / async Promise executor / async useEffect).';
  const head = `Async patterns — ${issues.length} footgun(s) (the loop does not await / the executor swallows errors):`;
  const body = issues
    .slice(0, 10)
    .map((x) => `  ⚠ ${x.file}:${x.line} — ${FIX[x.kind] ?? x.kind}`);
  return [head, ...body].join('\n');
}
