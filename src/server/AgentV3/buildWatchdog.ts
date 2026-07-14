// T1-watchdog — pure zombie-build selection for the proactive build sweeper.
//
// The reactive reclaim (shouldReclaimBuildLock) only fires when a NEW build for the same key arrives, so a
// hung build that nobody re-requests holds the account's one-build slot until the wall-clock deadline. This
// is the pure core of a proactive sweeper: given the whole running-build registry, return the keys that are
// DEFINITIVELY dead and safe to reap.

export interface ReapableBuild {
  ended: boolean;
  startedTs: number;
}

/**
 * Keys whose build is definitively dead and should be reaped: an `ended` build still lingering in the map,
 * or one grossly past the hard-max duration (the runner aborts at maxBuildSeconds, so past max + grace it
 * never fired its own cleanup — a true zombie). Pure.
 *
 * Deliberately CONSERVATIVE — it does NOT reap a merely "abandoned, no live subscriber, past the stall
 * window" build: that client may just be reconnecting on a network blip, and aborting it proactively would
 * kill a genuinely-live build (rule 1 — never break a working build). That abandoned-lock case stays
 * REACTIVE-only (reclaimed when a new build for the same key actually needs the slot). hardMaxMs <= 0
 * disables the age check (only `ended` builds are then swept).
 */
export function selectZombieBuilds<T extends ReapableBuild>(
  entries: Iterable<[string, T]>,
  now: number,
  hardMaxMs: number,
): string[] {
  const out: string[] = [];
  for (const [key, b] of entries) {
    if (!b) { out.push(key); continue; }
    if (b.ended) { out.push(key); continue; }
    if (hardMaxMs > 0 && now - b.startedTs > hardMaxMs) out.push(key);
  }
  return out;
}
