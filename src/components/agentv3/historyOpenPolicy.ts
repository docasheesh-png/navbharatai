// AgentV3 — what to do when opening a history chat returns NO server transcript (HTTP 404).
//
// ROOT CAUSE it fixes (2026-07-05, IMG_5715): the admin's build from EARLIER THE SAME HOUR was opened
// from history while its transcript hadn't reached the server yet (the build was still running /
// persistence in flight after a tab-switch). openConversation treated the single 404 as PROOF of a
// pre-rebuild destroyed transcript and PERMANENTLY branded the row `deadTranscript: true` ("Transcript
// lost") — a false, destructive verdict written durably to Firestore for a chat that was alive minutes
// earlier. A 404 alone is NOT proof of death: the build may still be running, or the first persist
// slice may simply not have landed yet.
//
// This pure module is the ONE decision for that moment, so it is unit-testable and can never drift:
//   • build still running server-side  → 'resume-live'   (re-attach the live stream — what the user wants)
//   • chat is YOUNG (< threshold)      → 'not-saved-yet'  (honest transient message; NO permanent branding)
//   • old + not running                → 'brand-dead'     (the genuine pre-rebuild destroyed-transcript class)
//
// The age gate matches the true dead class exactly: every transcript destroyed by the old pre-rebuild
// eraser bug is from BEFORE the history fix (days old). A young row can never be one of them.

/** A chat younger than this can never be branded dead on a 404 — its persist may simply be in flight. */
export const DEAD_BRAND_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export type HistoryOpen404Action = 'resume-live' | 'not-saved-yet' | 'brand-dead';

/**
 * Decide the action for a history open whose server transcript came back 404.
 * `ageMs` = now - the row's last update (Infinity/unknown → treated as old);
 * `buildRunning` = the server says a build for this chat's workspace is still running.
 * Pure + unit-testable.
 */
export function historyOpen404Action(input: { ageMs: number; buildRunning: boolean }): HistoryOpen404Action {
  if (input.buildRunning) return 'resume-live';
  const age = Number.isFinite(input.ageMs) && input.ageMs >= 0 ? input.ageMs : Number.POSITIVE_INFINITY;
  if (age < DEAD_BRAND_MIN_AGE_MS) return 'not-saved-yet';
  return 'brand-dead';
}
