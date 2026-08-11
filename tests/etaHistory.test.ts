import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isTeachableBuild, historyFromRecords, recentBuildHistoryFor, etaBasisNote,
  MIN_SANE_BUILD_MS, MAX_SANE_BUILD_MS, MIN_HISTORY_FOR_LEARNED,
} from '../src/server/AgentV3/etaHistory';
import { estimateBuildTime } from '../src/server/lib/BuildTimeEstimator';

/**
 * ADMIN 2026-08-11: build the upgrades that are SAFE and really improve the app, spending as little of
 * the admin's money as possible.
 *
 * This is the cheapest real one: **zero provider spend** (pure arithmetic over records already
 * written) against a defect measured in our own autopsies — *"ETA said ~3 min and it took 15.6 (4×
 * 'bigger than expected')"*.
 *
 * THE DEFECT WAS NOT A MISSING FEATURE — which is why it survived so long. `estimateBuildTime` has
 * always been able to learn from history. The live build path simply called it with NONE, so every
 * user saw the cold heuristic at confidence 0.4 on every build, forever. The one place history was
 * accepted took it from a request body, i.e. only from a caller who already knew the answer.
 */

const C = { moduleCount: 10, featureCount: 3 };
const t0 = 1_700_000_000_000;
const build = (ms: number, ok = true) => ({ startedAt: t0, endedAt: t0 + ms, ok });

describe('only builds that really finished may teach the estimate', () => {
  it('a normal successful build teaches', () => {
    expect(isTeachableBuild(build(4 * 60_000))).toBe(true);
  });

  it('a FAILED build never teaches — in either direction', () => {
    /**
     * A build killed at the watchdog cap took 30 minutes; one that failed in 40 seconds took 40
     * seconds. Feeding either in corrupts "how long does a build take" — and the fast failure is the
     * more dangerous one, because it makes the ETA optimistic, which is the complaint we started from.
     */
    expect(isTeachableBuild(build(30 * 60_000, false))).toBe(false);
    expect(isTeachableBuild(build(40_000, false))).toBe(false);
  });

  it('an unfinished or clock-skewed record never teaches', () => {
    expect(isTeachableBuild({ startedAt: t0, ok: true })).toBe(false);          // never ended
    expect(isTeachableBuild({ endedAt: t0, ok: true })).toBe(false);            // never started
    expect(isTeachableBuild({ startedAt: t0, endedAt: t0 - 5_000, ok: true })).toBe(false); // backwards
    expect(isTeachableBuild(undefined as any)).toBe(false);
  });

  it('absurd durations are rejected at both ends — one bad row moves everyone\'s estimate', () => {
    expect(isTeachableBuild(build(MIN_SANE_BUILD_MS - 1))).toBe(false); // nothing was built
    expect(isTeachableBuild(build(MAX_SANE_BUILD_MS + 1))).toBe(false); // killed, not finished
    expect(isTeachableBuild(build(MIN_SANE_BUILD_MS))).toBe(true);
    expect(isTeachableBuild(build(MAX_SANE_BUILD_MS))).toBe(true);
  });

  it('with no success signal at all it does NOT teach', () => {
    // Silence is not consent: an unknown outcome could be a failure, and a failure must never teach.
    expect(isTeachableBuild({ startedAt: t0, endedAt: t0 + 60_000 })).toBe(false);
    expect(isTeachableBuild({ startedAt: t0, endedAt: t0 + 60_000, outcome: 'succeeded' })).toBe(true);
    expect(isTeachableBuild({ startedAt: t0, endedAt: t0 + 60_000, outcome: 'timeout' })).toBe(false);
  });
});

describe('building the history', () => {
  it('keeps only teachable builds, newest first, capped', () => {
    const rows = [build(60_000), build(10, true), build(120_000, false), build(180_000)];
    const h = historyFromRecords(rows, C);
    expect(h.map((x) => x.durationMs)).toEqual([60_000, 180_000]);
    expect(historyFromRecords([build(1), build(2), build(3)].map(() => build(60_000)), C, 2)).toHaveLength(2);
  });

  it('stamps every entry with the CURRENT complexity — same-app history, at full weight', () => {
    /**
     * Looks wrong until you see what is predicted. The stored history is per-WORKSPACE — past builds of
     * THIS app — and carries no file count. Guessing one would be a fabrication; using the current
     * complexity says the true thing ("here is how long builds on this app have taken") and gives that
     * history full weight in the estimator, which is right: the same project and the same user's habits
     * predict the next build far better than a stranger's app with a similar file count.
     */
    const h = historyFromRecords([build(60_000)], C);
    expect(h[0].complexity).toEqual(C);
  });

  it('junk in never throws', () => {
    expect(historyFromRecords(undefined as any, C)).toEqual([]);
    expect(historyFromRecords([null as any, undefined as any], C)).toEqual([]);
  });
});

describe('it actually changes the estimate — otherwise none of this matters', () => {
  it('history moves the ETA toward what really happened, and raises confidence', () => {
    const cold = estimateBuildTime(C);
    const slowReality = Array.from({ length: 8 }, () => build(15 * 60_000));
    const learned = estimateBuildTime(C, historyFromRecords(slowReality, C));

    // The measured complaint: reality was ~4× the promise. After learning, the estimate moves there.
    expect(learned.estimateMs).toBeGreaterThan(cold.estimateMs);
    expect(learned.confidence).toBeGreaterThan(cold.confidence);
    expect(learned.basis).not.toBe('heuristic');
  });

  it('an EMPTY history leaves today\'s behaviour byte-for-byte unchanged', () => {
    // This is the safety property: every failure path in this feature ends at [].
    expect(estimateBuildTime(C, [])).toEqual(estimateBuildTime(C));
  });
});

describe('reading it is best-effort — an ETA must never delay or fail a build', () => {
  it('a store that throws yields no history, not an error', async () => {
    const h = await recentBuildHistoryFor('ws1', C, async () => { throw new Error('firestore down'); });
    expect(h).toEqual([]);
  });

  it('no workspace ⇒ no history, without touching the store', async () => {
    let called = false;
    const h = await recentBuildHistoryFor(null, C, async () => { called = true; return []; });
    expect(h).toEqual([]);
    expect(called).toBe(false);
  });

  it('a real store is read and converted', async () => {
    const h = await recentBuildHistoryFor('ws1', C, async () => [build(90_000), build(30_000, false)]);
    expect(h.map((x) => x.durationMs)).toEqual([90_000]);
  });
});

describe('what we tell the admin about the basis', () => {
  it('never claims to have learned from a history too thin to have learned from', () => {
    expect(etaBasisNote([])).toMatch(/no past builds/i);
    expect(etaBasisNote(historyFromRecords([build(60_000)], C))).toMatch(/only 1 past build\b/i);
    const many = historyFromRecords(Array.from({ length: MIN_HISTORY_FOR_LEARNED }, () => build(60_000)), C);
    expect(etaBasisNote(many)).toMatch(/learned from/i);
  });
});

describe('WIRING — the live build path finally gets history', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('the build ETA is no longer computed with no history at all', () => {
    // The whole defect in one line: this used to be estimateBuildTime(complexityFromPrompt(prompt)).
    expect(route).toContain('const est = estimateBuildTime(etaComplexity, past);');
    expect(route).toContain('recentBuildHistoryFor(');
    expect(route).toContain('listDiagnosticsHistory(id, n)');
  });

  it('the SAME complexity object feeds both the history and the estimate', () => {
    // Two different complexities would make the estimator compare incomparable things and return a
    // confident number that means nothing.
    expect(route).toContain('const etaComplexity = complexityFromPrompt(prompt);');
    expect(route).toMatch(/recentBuildHistoryFor\(\s*\n?\s*workspaceId, etaComplexity,/);
  });

  it('the basis is recorded, so a wrong ETA can be diagnosed instead of argued about', () => {
    expect(route).toContain("code: 'ETA_BASIS'");
    expect(route).toContain('etaBasisNote(past)');
  });
});
