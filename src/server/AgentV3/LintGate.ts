// U-1 — LintGate: a default-OFF end-of-build gate that treats ESLint ERRORS as build blockers, the
// same "verification is earned" discipline as the R2 §1.1 readiness gate. ESLint catches a real bug
// class `tsc` does not (no-undef, react-hooks/exhaustive-deps, promise misuse). Only ESLint ERRORS
// block: Prettier formatting and ESLint WARNINGS are style, not correctness, so they never fail a build.
// Pure (LintOutcome[] in → verdict out), so it is fully unit-testable independent of the sandbox.

import type { LintOutcome } from './lintRunner';

export interface LintGateVerdict {
  /** True when at least one ESLint error was found — the build should not be reported as a clean pass. */
  blocked: boolean;
  /** Total ESLint errors across the project's linters (warnings excluded). */
  errorCount: number;
  /** Up to a few concrete "file:line rule — message" lines, for an honest, actionable summary. */
  blockers: string[];
  summary: string;
}

/**
 * Decide the lint gate verdict from the project's linter outcomes. Pure. Blocks ONLY on ESLint errors;
 * Prettier (formatting) and ESLint warnings are reported elsewhere but never block. An unparseable
 * ESLint run (errorCount null) does NOT block — the gate is best-effort and must never fail a real
 * build on its own inability to read the output.
 */
export function lintGateVerdict(outcomes: LintOutcome[]): LintGateVerdict {
  let errorCount = 0;
  const blockers: string[] = [];
  for (const o of outcomes) {
    if (o.tool !== 'eslint') continue; // prettier is formatting-only — never a blocker
    const errs = o.errorCount ?? 0; // null (unparseable) → treated as 0, never blocks
    if (errs > 0) {
      errorCount += errs;
      for (const issue of o.firstIssues) blockers.push(issue);
    }
  }
  const blocked = errorCount > 0;
  return {
    blocked,
    errorCount,
    blockers: blockers.slice(0, 10),
    summary: blocked
      ? `Lint gate: ${errorCount} ESLint error${errorCount === 1 ? '' : 's'} block the build.`
      : 'Lint gate: no blocking ESLint errors.',
  };
}
