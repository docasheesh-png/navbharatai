// P-PME.5 — Lessons Learned / Build Retrospective Engine.
//
// A pure, dependency-free engine that turns a failed build (the repair attempts, the final
// error, time spent) into a structured retrospective: a failure classification, a best-effort
// root-cause guess, the strategies tried, and reusable warnings to inject into future similar
// builds. `relevantWarnings` surfaces the most applicable past failures for a new build.
//
// HONESTY: classification and root cause are derived from the actual error text. When the error
// doesn't match any known pattern it is honestly `unknown` — no confident-but-wrong label.

import { isAdvisoryCapOutcome } from '../AgentV3/advisoryCapOutcome';

export type FailureCategory =
  | 'syntax' | 'type' | 'dependency' | 'runtime' | 'network' | 'timeout' | 'test' | 'build'
  // v5's own real failure shapes. Added 2026-09-12 with the failure ledger, because the eight
  // categories above are all COMPILER shapes and v5 mostly fails in other ways — see OUTCOME_TO_CATEGORY.
  | 'preview' | 'incomplete' | 'quality' | 'unknown';

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

/**
 * 🔴 THE CODE BEATS THE PROSE, and this map exists because the regexes above could not have worked.
 *
 * Every pattern above matches a COMPILER's words. A v5 build does not usually fail that way — it fails
 * with an `OUTCOME_*` diagnostic whose message is a sentence we wrote ourselves: *"After one creation
 * pass, 3 local module(s) are STILL missing"*, *"The live in-browser preview does not compile"*. None
 * of those contain `compilation`, `SyntaxError` or `cannot find module`, so classifying them by text
 * would have put nearly every real failure into `unknown` — and a ledger of `unknown` answers nothing.
 *
 * The diagnostic CODE is a machine fact recorded by the build itself. Reading it is not pattern
 * matching, it is just looking. Text classification stays as the fallback for everything that has no
 * code (an imported build, a crash before any outcome was recorded, a caller that has only a string).
 */
export const OUTCOME_TO_CATEGORY: Readonly<Record<string, { category: FailureCategory; hint: string }>> = {
  OUTCOME_BUILD_TIMEOUT: { category: 'timeout', hint: 'The build hit its wall-clock ceiling — it ran out of time rather than out of ideas.' },
  OUTCOME_SYNTAX_ERROR: { category: 'syntax', hint: 'Generated code did not parse — check the file the diagnostic names.' },
  OUTCOME_TYPECHECK_FAILED: { category: 'type', hint: 'The project does not typecheck — align the value with its expected type.' },
  OUTCOME_MISSING_FILES: { category: 'incomplete', hint: 'Modules were imported and never created — the plan and the writes disagreed.' },
  OUTCOME_MISSING_EXPORT: { category: 'incomplete', hint: 'A file was imported for an export it does not have — the contract between two files drifted.' },
  OUTCOME_BUILD_PARTIAL: { category: 'incomplete', hint: 'The build stopped part-way and shipped less than it planned.' },
  OUTCOME_STOPPED: { category: 'incomplete', hint: 'The run ended before it finished — cancelled, out of budget, or stopped by a gate.' },
  OUTCOME_PREVIEW_FAILED: { category: 'preview', hint: 'The app was produced but never rendered — "preview is EARNED", so this is a failure.' },
  OUTCOME_PREVIEW_COMPILE: { category: 'preview', hint: 'The in-browser preview does not compile — the app would not load for the user.' },
  OUTCOME_REVIEW_CRITICAL: { category: 'quality', hint: 'The reviewer found something critical the build did not repair.' },
  OUTCOME_RELEASE_GATE_RED: { category: 'quality', hint: 'The release gate found evidence the app does not work.' },
  // Recorded since 2026-09-17 by the empty-build verdict flip — the one flip that used to record no code.
  OUTCOME_EMPTY_BUILD: { category: 'incomplete', hint: 'The build expected files and wrote none — nothing to run, nothing to verify.' },
  OUTCOME_SANDBOX_UNAVAILABLE: { category: 'unknown', hint: 'The sandbox could not be set up — an infrastructure condition, not the app or the prompt.' },
  // Legacy fast-lane end-state (`OUTCOME_${sb.outcome}`) still present on old records; labelled on the panel, so known here too.
  OUTCOME_BUILD_FAILED: { category: 'build', hint: 'The build itself failed — check the compiler / bundler output the diagnostic names.' },
};

/**
 * Classify a failure into a category + a human hint.
 *
 * `outcomeCode` is the build's own `OUTCOME_*` diagnostic when it has one; it WINS over the text,
 * because it is a fact the build recorded rather than a guess about what its prose means. An
 * unrecognised code falls through to the text, so a code added later is never silently mis-filed — it
 * simply classifies as it would have before the code existed.
 */
export function classifyFailure(error: string, outcomeCode?: string | null): { category: FailureCategory; hint: string } {
  const code = clean(outcomeCode);
  /**
   * 🔴 THE ADVISORY CAP IS NOT A FAILURE (report af3a3f7f, 2026-09-17). Its outcome used to share the
   * code `OUTCOME_STOPPED` with the genuine wall-clock stop, so this map called a fully built,
   * browser-verified app "incomplete — the run ended before it finished". Both shapes are recognised
   * because every build recorded before the split still carries the legacy one.
   */
  if (isAdvisoryCapOutcome({ code, message: error })) {
    return {
      category: 'unknown',
      hint: 'Not a failure — the app was built and only the optional post-build checks hit their 2-minute cap.',
    };
  }
  const mapped = code ? OUTCOME_TO_CATEGORY[code] : undefined;
  if (mapped) return mapped;
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
  /** The build's own `OUTCOME_*` verdict code, when it recorded one. Beats the text — see classifyFailure. */
  outcomeCode?: string;
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
  const { category, hint } = classifyFailure(finalError, input.outcomeCode);
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
