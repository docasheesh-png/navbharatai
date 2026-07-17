// AgentV3 — Build Reflection (Layer 57 / Self-Reflection, seed).
//
// After a v5.0 build finishes, we derive a short, structured reflection from
// what actually happened during the run (errors hit, fixes applied, outcome)
// and store it back into the project's WorkspaceMemory as a note. The NEXT
// build in the same session can then `recall` those lessons when it hits a
// similar error — the first step of the "system learns from every build" loop.
//
// PURE & best-effort: reflectOnBuild does no I/O and is fully deterministic;
// the route wiring is wrapped so reflection can NEVER affect the build result.

import type { Episode } from './WorkspaceMemory';

export interface RecurringError {
  /** Normalized error signature (paths/numbers/quotes stripped). */
  signature: string;
  /** How many times this signature occurred in the build. */
  count: number;
  /** A short snippet of a representative occurrence. */
  sample: string;
}

export interface BuildReflection {
  outcome: 'success' | 'failure';
  errorsEncountered: number;
  fixesApplied: number;
  unresolvedErrors: number;
  /** Errors that recurred (same signature ≥ threshold) — a "stuck loop" signal. */
  recurringErrors: RecurringError[];
  lessons: string[];
  summary: string;
}

/** Max number of lessons we derive from a single build. */
const MAX_LESSONS = 8;
/** Soft cap for a single reflection note stored in memory. */
const NOTE_MAX_CHARS = 1500;

/** Trim a piece of episode text to a short, single-line snippet (~`max` chars). */
function snippet(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Normalize an error message to a stable signature so the SAME error recurring is
 * detectable across attempts: strip file paths, line:col numbers, hex addresses and
 * quoted specifics that vary between otherwise-identical failures.
 */
export function errorSignature(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/[a-z]?:?[\\/][^\s'"`)]+/g, '<path>') // unix/windows paths
    .replace(/['"`][^'"`]*['"`]/g, '<str>') // quoted specifics
    .replace(/\b\d+(?::\d+)?\b/g, '<n>') // line:col and bare numbers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Group 'error' episodes by signature and return those that recurred at least
 * `minCount` times — i.e. the build kept hitting the SAME failure, a strong signal
 * that the current fix approach is not working. PURE & deterministic.
 */
export function detectRecurringErrors(episodes: Episode[], minCount = 3): RecurringError[] {
  const groups = new Map<string, { count: number; sample: string }>();
  for (const e of episodes) {
    if (e.kind !== 'error') continue;
    const sig = errorSignature(e.text);
    if (!sig) continue;
    const g = groups.get(sig);
    if (g) g.count++;
    else groups.set(sig, { count: 1, sample: e.text });
  }
  return [...groups.entries()]
    .filter(([, g]) => g.count >= minCount)
    .map(([signature, g]) => ({ signature, count: g.count, sample: snippet(g.sample) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Derive a deterministic reflection from a finished build's episodes. No I/O.
 *
 * Pairs each 'error' episode with the NEAREST LATER 'fix' episode (by `ts`),
 * never reusing a fix for two errors. An error with no later fix is counted as
 * unresolved. Lessons describe the error→fix pairs and are capped at 8.
 */
export function reflectOnBuild(input: {
  ok: boolean;
  summary: string;
  steps: number;
  episodes: Episode[];
}): BuildReflection {
  // Sort a shallow copy by ts so "later" is well-defined regardless of input order.
  const sorted = [...input.episodes].sort((a, b) => a.ts - b.ts);
  const errors = sorted.filter((e) => e.kind === 'error');
  const fixes = sorted.filter((e) => e.kind === 'fix');

  const errorsEncountered = errors.length;
  const fixesApplied = fixes.length;

  const pairLessons: string[] = [];
  const usedFix = new Set<number>(); // indices into `fixes` already paired
  let unresolvedErrors = 0;

  for (const err of errors) {
    // Find the nearest not-yet-used fix that occurred after this error.
    let pairedIdx = -1;
    for (let i = 0; i < fixes.length; i++) {
      if (usedFix.has(i)) continue;
      if (fixes[i].ts > err.ts) {
        pairedIdx = i;
        break; // `fixes` is sorted ascending → first match is the nearest later fix
      }
    }
    if (pairedIdx === -1) {
      unresolvedErrors++;
      continue;
    }
    usedFix.add(pairedIdx);
    pairLessons.push(
      `When '${snippet(err.text)}' occurred, the fix was '${snippet(fixes[pairedIdx].text)}'.`,
    );
  }

  // A repeatedly-recurring error is the highest-value lesson — surface it FIRST so
  // the next build changes approach instead of re-applying a fix that never worked.
  const recurringErrors = detectRecurringErrors(sorted);
  const recurringLessons = recurringErrors.map(
    (r) =>
      `The same error recurred ${r.count}× (e.g. '${r.sample}') — repeated fixes were not resolving it; change strategy (different root cause) or ask for help instead of retrying the same approach.`,
  );
  const lessons = [...recurringLessons, ...pairLessons].slice(0, MAX_LESSONS);

  const outcome: 'success' | 'failure' = input.ok ? 'success' : 'failure';
  const summary =
    `Build ${input.ok ? 'succeeded' : 'failed'} in ${input.steps} steps; ` +
    `${errorsEncountered} error(s), ${fixesApplied} fix(es), ${unresolvedErrors} unresolved.`;

  return { outcome, errorsEncountered, fixesApplied, unresolvedErrors, recurringErrors, lessons, summary };
}

/**
 * Render a reflection as a compact multi-line note suitable for storing in
 * memory AND for later keyword `recall`. Tagged `[reflection]` so it is easy to
 * find; each lesson is on its own line so a future recall on a similar error
 * text matches. Kept under ~1500 chars (lessons are truncated if needed).
 */
export function reflectionNote(r: BuildReflection): string {
  const header = `[reflection] ${r.summary}`;
  const lines = [header];
  for (const lesson of r.lessons) {
    const candidate = `- lesson: ${lesson}`;
    // Stop before exceeding the soft cap (account for the joining newline).
    if (lines.join('\n').length + 1 + candidate.length > NOTE_MAX_CHARS) break;
    lines.push(candidate);
  }
  return lines.join('\n');
}
