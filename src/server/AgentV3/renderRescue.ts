// Render rescue (admin 2026-07-30) — a genuinely-rendering app must never be reported as a failure.
//
// Root cause it fixes: a build can finish `ok:false` (a late tool error, out-of-steps, or a false
// "replied-without-building") yet have actually written the app AND have a live preview that renders.
// Because build-health, billing and the chat verdict all key off `ok`, that working app was shown as
// a failure, scored 0 health, and — worst — billed ₹0 (NavBharatAI ate the real API cost). v5.0's own
// real-browser eyes already DOWNGRADE a bill when the preview doesn't render; these pure predicates let
// the route use the SAME authority to UPGRADE `ok:false → ok:true` when the preview truly renders.
//
// Pure + unit-tested so the exact failure case is locked forever. The route wraps these with the
// env kill switch, the live preview URL, the abort signal and the wall-clock budget.

/** Is this build even a candidate for a render rescue? Only a build that was SUPPOSED to produce an
 *  app (expectsArtifacts), actually wrote files this turn, and finished NOT ok. A build that is
 *  already ok needs no rescue; a no-artifact turn (chat/import/survey) has nothing to render. */
export function renderRescueEligible(input: { ok: boolean; expectsArtifacts: boolean; filesWritten: number }): boolean {
  return input.ok === false && input.expectsArtifacts === true && input.filesWritten > 0;
}

/** Does the real-browser verdict CONFIRM the app is genuinely working? The preview must have rendered,
 *  there must be no actionable runtime console errors, AND there must be no deterministic proof of a
 *  latent RUNTIME CRASH. Only then is upgrading `ok` honest (never a fake success — a blank/erroring
 *  preview leaves the build failed).
 *
 *  The `runtimeCrashBlocker` guard (real report 8a6e4585): a React Rules-of-Hooks violation renders
 *  fine on the FIRST paint and crashes only on a later re-render/interaction — so a one-shot HTML
 *  snapshot with zero console errors passes while the real app white-screens the moment the user
 *  touches it (exactly what the admin saw). A deterministic AST proof of a runtime crash OUTWEIGHS a
 *  single render check, so the rescue must stand down and leave the build honestly not-ok. */
export function renderRescueConfirmsSuccess(input: {
  rendered: boolean;
  consoleErrorCount: number;
  runtimeCrashBlocker?: boolean;
}): boolean {
  return input.rendered === true && input.consoleErrorCount === 0 && input.runtimeCrashBlocker !== true;
}
