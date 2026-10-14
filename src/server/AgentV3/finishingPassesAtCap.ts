// AgentV3 — NOTHING THAT CHANGES THE APP RUNS AFTER THE CLOCK RAN OUT, BECAUSE NOTHING CAN CHECK IT (Q-1069).
//
// 🔴 WHY (autopsy 398db9f3 — PAWTRACE, 2026-10-14). The build hit its 25-minute cap. The finishing passes
// (unused-import sweep, production defaults) then wrote 16 files into an app that could not be re-opened,
// and the report said so itself: "The end state could not be checked, so nothing is known about whether they
// broke it" (`POST_GREEN_WRITES`, `GREEN_GUARD_NONE`). Those passes are designed to run BEFORE the preview
// proof so that what they write is verified like every other file; at the cap there is no time left for the
// proof, so they wrote and nobody looked.
//
// THE RULE (admin, 2026-10-14, "han" to the recommendation): after the wall-clock cap, only a pass that
// cannot change how the app behaves may write. Both finishing passes touch code, a service worker or a
// manifest, so both wait. A capped build is resumable by design: the next turn runs them with time to verify.
//
// PURE. A leaf: the route reads one function and one sentence.

/** Did this run end because the wall-clock cap stopped it? */
export function capStoppedTheRun(result: { timedOut?: boolean } | null | undefined): boolean {
  return result?.timedOut === true;
}

/** May a pass that writes into the app (and is meant to be verified afterwards) run on this result? */
export function finishingPassMayRun(result: { timedOut?: boolean } | null | undefined): boolean {
  return !capStoppedTheRun(result);
}

/** The admin-report line for the passes that waited. Never user-facing. */
export function finishingPassesHeldNote(passes: readonly string[]): string {
  return `The wall-clock cap stopped this build, so ${passes.join(' and ')} did not write into the app: there was no time left to open it and check what they wrote. `
    + 'They run on the next turn, with time to verify.';
}

/**
 * Record `FINISHING_PASSES_HELD_AT_CAP`. Its own try lives here, not in the route: the chat handler sits at
 * TypeScript's control-flow limit (TS2563) and every branch added there is one more the checker must walk.
 */
export function recordFinishingPassesHeld(
  diag: { record(r: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): unknown },
): void {
  try {
    diag.record({ phase: 'build', severity: 'info', code: 'FINISHING_PASSES_HELD_AT_CAP', autoResolved: true, message: finishingPassesHeldNote(['the unused-import sweep', 'the production defaults']) });
  } catch { /* an advisory line must never affect a build */ }
}
