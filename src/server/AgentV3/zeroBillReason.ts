/**
 * WHY WAS THIS BUILD FREE? — the one sentence the admin's own ledger records for a ₹0 build.
 *
 * 🔴 WHY IT IS A MODULE (autopsy e9b25b08, 2026-09-18). The route decided it with a two-branch
 * ternary over a THREE-state fact, so a build the USER STOPPED — 90 seconds in, before a single file
 * was written — was recorded as *"empty build (0 files produced) — never charged"*, under a comment
 * reading *"the build failed"*. Neither clause was true: nothing was produced because the user
 * stopped it, and the same report's own `OUTCOME_USER_STOPPED` says so in the line above.
 *
 * This is the class `JOURNEY_PASSED` and `PAGE_RENDER_FAILED` were both fixed for, a third time: one
 * fact with three states, encoded in two, and the wrong one is what a reader scanning the ledger
 * sees. The BILL is unchanged — ₹0 in every branch — only the stated reason stops being false.
 *
 * PURE. No I/O, no clock, no env.
 */

export interface ZeroBillFacts {
  /** Did the turn SUCCEED? A verified-no-change turn writes nothing and is a success (report 697b38ee). */
  ok: boolean;
  /** Did the user press Stop? The release gate's own `stoppedByUser` answers this. */
  stoppedByUser: boolean;
}

/**
 * The sentence recorded on a build that produced no files and is therefore never charged.
 *
 * ⚠️ ORDER IS THE MEANING. Success is asked first because a verified-no-change turn is a success that
 * wrote nothing; a stop is asked next because it explains the absence of files without implying the
 * engine failed; and only what remains is an empty build.
 */
export function zeroBillReasonFor(facts: ZeroBillFacts): string {
  if (facts.ok) return 'verified-no-change turn (nothing needed changing) — not charged';
  if (facts.stoppedByUser) return 'stopped by the user before any file was written — never charged';
  return 'empty build (0 files produced) — never charged';
}
