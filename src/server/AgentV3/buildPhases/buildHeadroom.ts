/**
 * HOW MUCH OF THE BUILD'S CLOCK IS LEFT FOR A POST-BUILD PASS (locked plan item 2, 2026-11-24; weakness audit P0-2).
 *
 * The build route asked "is there time left for this pass?" in about thirty places, each in its own words:
 * `effectiveBuildSeconds === 0 || workElapsed() < effectiveBuildSeconds * 1000 - X`. The game playtest, the only
 * check that actually PLAYS a game, needed 90 s of headroom, and every pass that ran before it (the typecheck, the
 * preview heal, the page checks) could spend that time first. So the builds that ran late, the ones with problems,
 * were exactly the ones whose game was never played.
 *
 * Two changes, one rule:
 *   1. Every headroom question goes through `hasHeadroom` (one arithmetic, one place to read it).
 *   2. On a game turn, `PLAYTEST_RESERVE_MS` is held back until the playtest has run: passes before it see that much
 *      less time, and generation is handed that much less budget, so the playtest's time is taken up front instead of
 *      being whatever is left over. On a non-game turn nothing is held and every answer is what it was before.
 *
 * Kill switch: `AGENTV3_GAME_PLAYTEST_RESERVE=off` holds nothing, which restores the old arithmetic exactly. PURE.
 */

/** The playtest's own budget (60 s) + page load (15 s) + the route's 20 s timeout margin. Kept equal to gamePlaytest.ts. */
export const PLAYTEST_RESERVE_MS = 95_000;

/** How much is held back for the playtest right now: only on a game turn, only until the playtest has run. */
export function playtestReserveMs(o: { gameTurn: boolean; playtestDone: boolean }, env: NodeJS.ProcessEnv = process.env): number {
  if (String(env.AGENTV3_GAME_PLAYTEST_RESERVE ?? '').trim().toLowerCase() === 'off') return 0;
  return o.gameTurn && !o.playtestDone ? PLAYTEST_RESERVE_MS : 0;
}

/**
 * True when a pass that needs `needMs` still fits before the build's cap, after `heldMs` is kept back.
 * A cap of 0 means "no watchdog": every pass fits, exactly as before.
 */
export function hasHeadroom(o: { capMs: number; elapsedMs: number; needMs: number; heldMs?: number }): boolean {
  if (!(o.capMs > 0)) return true;
  return o.elapsedMs < o.capMs - o.needMs - Math.max(0, o.heldMs ?? 0);
}

/** The time left before the cap, minus what is held back (Infinity with no watchdog). */
export function headroomMs(o: { capMs: number; elapsedMs: number; heldMs?: number }): number {
  if (!(o.capMs > 0)) return Number.POSITIVE_INFINITY;
  return o.capMs - o.elapsedMs - Math.max(0, o.heldMs ?? 0);
}
