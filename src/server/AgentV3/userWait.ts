// ⏸️ WAITING FOR THE USER IS NOT BUILDING (autopsy 1219c639, 2026-10-01).
//
// A build that asks the user something — a key, a plan approval, a database offer — waits on them. That
// report's build sat in a key popup for ten minutes while the live line said "Still building… 4 min in ·
// ~3 min to go", then scored itself "1.7× the midpoint and OVER the band" for the time the user spent
// looking for a key. The route's `waitForUser` is the one door every such wait goes through; this module is
// the words the user sees while it is open. PURE.

/** The live line shown while the build is waiting for the user's answer. */
export function waitingForUserLine(waitedMs: number): string {
  const ms = Number.isFinite(waitedMs) && waitedMs > 0 ? waitedMs : 0;
  const minutes = Math.floor(ms / 60_000);
  const since = minutes >= 1 ? ` (${minutes} min so far)` : '';
  return `⏸️ Waiting for your answer above${since} — the build carries on the moment you reply, and this time is not counted against it.`;
}
