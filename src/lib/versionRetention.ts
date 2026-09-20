// HOW LONG CAN YOU GO BACK? — one number, shared by the store that enforces it and the screen that
// promises it.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-20: "agar 4 din baad restore nahi ho sakta to wahan likh kar aana
// chahiye ki --din tak reverse kar sakte hai"). The instruction is right and the premise was mine and
// wrong: I had described the OTHER version system (the Pro panel's git checkpoints, which restore
// inside the sandbox and so stop working once it is recycled) and the admin reasonably read it as a
// deadline on the Time Machine. It is not one.
//
// **The Time Machine has no time limit at all.** `BuildHistoryStore` keeps the newest
// MAX_SAVED_VERSIONS per app and drops the oldest as new ones arrive, and `DataRetentionManager`
// states in writing that this data is "removed with their account, not with age". So a version from
// six months ago restores exactly as well as yesterday's — what runs out is COUNT, not days.
//
// 🔒 THE CONSTANT LIVES HERE, NOT IN THE STORE, so the screen cannot claim a number the store does not
// enforce. That drift is this repo's most expensive recurring bug: a doc (or a label) that states
// another module's fact, and goes stale without anything failing. The store imports this; the panel
// imports this; `tests/theLimitOnScreenIsTheLimitEnforced.test.ts` asserts they are the same value.
// The client cannot import the store (firebase-admin), which is exactly why `checkpointLabel.ts`
// already lives in this directory for the same reason.

/** How many versions of ONE app are kept. The oldest is dropped when a new one is saved. */
export const MAX_SAVED_VERSIONS = 50;

/**
 * The sentence the user reads under their version list.
 *
 * ⚠️ It states a COUNT and deliberately names no number of days. Saying "you can go back 30 days"
 * would be a promise nothing in the code keeps — in both directions: a quiet app's first version
 * survives for ever, and an app built fifty times in one afternoon loses its morning by evening.
 * A limit that is wrong in the user's favour is still a limit that will be wrong when it matters.
 */
export function retentionNote(savedCount: number): string {
  const n = Math.max(0, Math.floor(Number(savedCount) || 0));
  if (n >= MAX_SAVED_VERSIONS) {
    return `Your newest ${MAX_SAVED_VERSIONS} versions are kept — saving another removes the oldest one. There is no time limit: any version in this list can be restored however long ago it was made.`;
  }
  const room = MAX_SAVED_VERSIONS - n;
  return `Your newest ${MAX_SAVED_VERSIONS} versions are kept (room for ${room} more). There is no time limit: any version in this list can be restored however long ago it was made.`;
}
