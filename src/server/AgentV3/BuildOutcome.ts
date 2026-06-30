// AgentV3 — Build Outcome classification.
//
// The build previously reported only a boolean `ok`, which conflates very different end-states: a
// compile error the repair fixed, a build that compiled but whose preview never came up, and a build
// that ran but threw at runtime are NOT the same thing — yet `ok:false` (or a blunt `ok:true`) hid the
// difference. This is the single, deterministic classifier every gate / dashboard / retry policy can
// branch on, and it resolves the apparent tension between two rules the platform holds at once:
//   • "a preview/runtime failure must NOT mark a genuinely-built (compiling) app as a BUILD failure", and
//   • "a runtime smoke check is required before claiming full success".
// → the answer is to CLASSIFY, not to blunt-fail: a compiling app whose preview is down is PREVIEW_FAILED
//   (app built, ship-with-warning), distinct from TYPECHECK_FAILED / BUILD_FAILED (a real build failure).
//
// PURE & deterministic (signals in → label out), so it is fully unit-testable.

export type BuildOutcome =
  | 'BUILD_SUCCESS'    // files written, compiles, and the live app was verified (preview/runtime ok)
  | 'BUILD_PARTIAL'    // files written + compiles, but the live app was NOT verified (best-effort skipped)
  | 'TYPECHECK_FAILED' // tsc errors remained after repair
  | 'BUILD_FAILED'     // no files produced, OR the production build (npm run build) failed though tsc passed
  | 'PREVIEW_FAILED'   // app compiles but the preview never came up (NOT a build failure — ship-with-warning)
  | 'RUNTIME_FAILED';  // preview came up but the app errored at runtime / failed the smoke check

/** Each signal is tri-state: true = passed, false = failed, null/undefined = not run / unknown. */
export interface BuildSignals {
  filesWritten: number;
  typecheckOk?: boolean | null;
  prodBuildOk?: boolean | null;
  previewOk?: boolean | null;
  runtimeOk?: boolean | null;
}

/** The outcomes that mean the BUILD itself failed (vs the app built but live-verification failed). */
const BUILD_FAILURES: ReadonlySet<BuildOutcome> = new Set<BuildOutcome>(['TYPECHECK_FAILED', 'BUILD_FAILED']);

/** True when the outcome means the build itself failed (caller should fall back / report failure). */
export function isBuildFailure(outcome: BuildOutcome): boolean {
  return BUILD_FAILURES.has(outcome);
}

/**
 * Classify a build from its verification signals. Precedence (most fundamental first): no files →
 * type errors → production-build failure → runtime failure → preview failure → then the positive
 * states. PURE & deterministic.
 */
export function classifyBuildOutcome(s: BuildSignals): BuildOutcome {
  const filesWritten = typeof s.filesWritten === 'number' ? s.filesWritten : 0;
  if (filesWritten <= 0) return 'BUILD_FAILED';        // nothing was produced
  if (s.typecheckOk === false) return 'TYPECHECK_FAILED';
  if (s.prodBuildOk === false) return 'BUILD_FAILED';  // tsc clean but `npm run build` broke
  if (s.runtimeOk === false) return 'RUNTIME_FAILED';
  if (s.previewOk === false) return 'PREVIEW_FAILED';

  // No failure signal. "Compiles" = tsc or prod-build passed (not merely un-run).
  const compiles = s.typecheckOk === true || s.prodBuildOk === true;
  const liveVerified = s.previewOk === true || s.runtimeOk === true;
  if (compiles && liveVerified) return 'BUILD_SUCCESS';
  // Compiles but the live app was not verified (preview/runtime not run) — built, not fully proven.
  if (compiles) return 'BUILD_PARTIAL';
  // Files exist but nothing was verified at all (no tsc, no preview) — best-effort partial.
  return 'BUILD_PARTIAL';
}

/** A short, honest human label for the chat/report. */
export function buildOutcomeLabel(outcome: BuildOutcome): string {
  switch (outcome) {
    case 'BUILD_SUCCESS': return 'Build verified — compiles and the live app works. ✓';
    case 'BUILD_PARTIAL': return 'Built and compiles — live preview not fully verified.';
    case 'TYPECHECK_FAILED': return 'Build failed — TypeScript errors.';
    case 'BUILD_FAILED': return 'Build failed — the app could not be produced.';
    case 'PREVIEW_FAILED': return 'App built (compiles) but the preview did not come up.';
    case 'RUNTIME_FAILED': return 'App built but errored at runtime.';
  }
}
