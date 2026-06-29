// P-PME.5 — Lessons Learned / Build Retrospective Engine.
//
// A pure, dependency-free engine that turns a failed build (the repair attempts, the final
// error, time spent) into a structured retrospective: a failure classification, a best-effort
// root-cause guess, the strategies tried, and reusable warnings to inject into future similar
// builds. `relevantWarnings` surfaces the most applicable past failures for a new build.
//
// HONESTY: classification and root cause are derived from the actual error text. When the error
// doesn't match any known pattern it is honestly `unknown` — no confident-but-wrong label.

export type FailureCategory =
  | 'syntax' | 'type' | 'dependency' | 'runtime' | 'network' | 'timeout' | 'test' | 'build' | 'unknown';

interface Pattern { category: FailureCategory; re: RegExp; hint: string }

// Ordered most-specific → most-general; the first match wins.
const PATTERNS: Pattern[] = [
  { category: 'dependency', re: /cannot find module|module not found|ERR_MODULE_NOT_FOUND|npm ERR|ENOENT[^]*node_modules/i, hint: 'A package/import could not be resolved — check dependencies + import paths.' },
  { category: 'syntax', re: /syntaxerror|unexpected token|unexpected end of (input|json)/i, hint: 'Malformed code — check brackets/quotes/commas near the reported location.' },
  { category: 'type', re: /typeerror|is not assignable|TS\d{3,}|is not a function/i, hint: 'A type/shape mismatch — align the value with its expected type.' },
  { category: 'timeout', re: /timed?\s?out|ETIMEDOUT|deadline exceeded/i, hint: 'An operation exceeded its time budget — reduce work or raise the timeout.' },
  { category: 'network', re: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network error/i, hint: 'A network call failed — check connectivity/endpoint/credentials.' },
  { category: 'runtime', re: /referenceerror|is not defined|cannot read propert|null is not an object|rangeerror/i, hint: 'A runtime error — a value was undefined/null or out of range when used.' },
  { category: 'test', re: /\btest(s)? failed\b|assertion|expected[^]*received|^\s*FAIL\s/im, hint: 'A test failed — the implementation does not match the expected behaviour.' },
  { category: 'build', re: /build failed|compilation|esbuild|vite|rollup/i, hint: 'The build/bundle step failed — check the compiler output.' },
];

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/** Classify an error string into a failure category + a human hint. */
export function classifyFailure(error: string): { category: FailureCategory; hint: string } {
  const e = clean(error);
  if (!e) return { category: 'unknown', hint: 'No error text supplied — cannot classify.' };
  for (const p of PATTERNS) if (p.re.test(e)) return { category: p.category, hint: p.hint };
  return { category: 'unknown', hint: 'Unrecognised failure — needs manual review.' };
}

export interface RepairAttempt {
  strategy: string;
  error?: string;
}

export interface FailedBuildInput {
  framework?: string;
  intent?: string;
  attempts?: RepairAttempt[];
  finalError?: string;
  timeSpentMs?: number;
}

export interface Retrospective {
  framework: string;
  intent: string;
  category: FailureCategory;
  rootCause: string;
  strategiesAttempted: string[];
  attemptCount: number;
  finalError: string;
  timeSpentMs: number;
  /** A short reusable warning to inject into future similar builds. */
  warning: string;
  summary: string;
}

const ONE_LINE = (s: string): string => clean(s).replace(/\s+/g, ' ').slice(0, 300);

/** Build a structured retrospective from a failed build. Pure. */
export function buildRetrospective(input: FailedBuildInput): Retrospective {
  const framework = clean(input.framework) || 'unknown';
  const intent = clean(input.intent) || 'unknown';
  const attempts = (input.attempts || []).filter((a) => clean(a.strategy));
  const finalError = clean(input.finalError);
  const { category, hint } = classifyFailure(finalError);
  const strategiesAttempted = attempts.map((a) => clean(a.strategy));

  const warning = `[${category}] ${framework}: ${hint}`;
  const summary = finalError
    ? `Build for "${intent}" (${framework}) failed after ${attempts.length} repair attempt(s) with a ${category} error: ${ONE_LINE(finalError)}`
    : `Build for "${intent}" (${framework}) failed after ${attempts.length} repair attempt(s); no final error captured.`;

  return {
    framework,
    intent,
    category,
    rootCause: hint,
    strategiesAttempted,
    attemptCount: attempts.length,
    finalError: ONE_LINE(finalError),
    timeSpentMs: typeof input.timeSpentMs === 'number' && input.timeSpentMs > 0 ? input.timeSpentMs : 0,
    warning,
    summary,
  };
}

/**
 * Given past retrospectives and a new build's framework/intent, return the top-N most relevant
 * past-failure warnings (same framework + overlapping intent words ranked highest). Pure.
 */
export function relevantWarnings(
  history: Retrospective[],
  query: { framework?: string; intent?: string },
  topN = 3,
): Array<{ warning: string; category: FailureCategory; score: number }> {
  const qFramework = clean(query.framework).toLowerCase();
  const qWords = new Set(clean(query.intent).toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const scored = (history || [])
    .filter((r) => r && clean(r.warning))
    .map((r) => {
      let score = 0;
      if (qFramework && clean(r.framework).toLowerCase() === qFramework) score += 2;
      const rWords = clean(r.intent).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (const w of rWords) if (qWords.has(w)) score += 1;
      return { warning: r.warning, category: r.category, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, topN));
}
