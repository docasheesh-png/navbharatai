// AgentV3 — Build Reflection (Layer 57 / Self-Reflection, seed).
//
// After a v3.0 build finishes, we derive a short, structured reflection from
// what actually happened during the run (errors hit, fixes applied, outcome)
// and store it back into the project's WorkspaceMemory as a note. The NEXT
// build in the same session can then `recall` those lessons when it hits a
// similar error — the first step of the "system learns from every build" loop.
//
// PURE & best-effort: reflectOnBuild does no I/O and is fully deterministic;
// the route wiring is wrapped so reflection can NEVER affect the build result.

import type { Episode } from './WorkspaceMemory';

export interface BuildReflection {
  outcome: 'success' | 'failure';
  errorsEncountered: number;
  fixesApplied: number;
  unresolvedErrors: number;
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

  const lessons: string[] = [];
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
    if (lessons.length < MAX_LESSONS) {
      lessons.push(
        `When '${snippet(err.text)}' occurred, the fix was '${snippet(fixes[pairedIdx].text)}'.`,
      );
    }
  }

  const outcome: 'success' | 'failure' = input.ok ? 'success' : 'failure';
  const summary =
    `Build ${input.ok ? 'succeeded' : 'failed'} in ${input.steps} steps; ` +
    `${errorsEncountered} error(s), ${fixesApplied} fix(es), ${unresolvedErrors} unresolved.`;

  return { outcome, errorsEncountered, fixesApplied, unresolvedErrors, lessons, summary };
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
