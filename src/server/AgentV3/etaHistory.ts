// TEACHING THE ETA FROM REAL BUILDS — turning history we already keep into an honest estimate.
//
// ADMIN 2026-08-11, asked for the upgrades that genuinely make v5 stronger while spending as little of
// the admin's money as possible. This is the cheapest real one in the list: it costs **zero provider
// spend** (pure arithmetic over records already written) and it fixes a defect measured in our own
// autopsies — *"ETA said ~3 min and it took 15.6 (4× 'bigger than expected')"*.
//
// THE DEFECT WAS NOT A MISSING FEATURE. `estimateBuildTime(complexity, history)` has ALWAYS been able
// to learn — `historicalEstimateMs` blends past durations and raises confidence as history grows. But
// the LIVE build path calls it as `estimateBuildTime(complexityFromPrompt(prompt))` with **no history
// at all**, so every real user has always seen the cold heuristic at confidence 0.4, for every build,
// forever. The one place history WAS accepted is `POST /api/build-estimate`, which takes it from the
// request body — i.e. only if a caller already knew the answer. The learning machinery was wired to
// everything except the path that matters.
//
// This module is the missing link, and deliberately adds NO new storage. Every settled build is
// already recorded durably per workspace (`listDiagnosticsHistory`), carrying `startedAt`/`endedAt`
// and whether it succeeded. Deriving history from those records means nothing new to persist, nothing
// to migrate, and no second source of truth to drift.
//
// NOT the admin report store, which was the obvious-looking source and is the wrong one: it holds only
// builds a user pressed "Report" on — a sample biased toward builds that went badly, which would teach
// the ETA to expect the worst.
//
// PURE — no clock, no Firestore. Records are passed in, so every rule here is unit-testable.

import type { Complexity, HistoricalBuild } from '../lib/BuildTimeEstimator';

/** The few fields we need off a stored report. Deliberately loose — old records lack newer fields. */
export interface BuildRecordLike {
  startedAt?: number;
  endedAt?: number;
  /** Whether it finished successfully; a failed build's duration must not teach the estimate. */
  ok?: boolean;
  outcome?: string;
}

/**
 * A build has to look SANE before it is allowed to teach the estimate.
 *
 * A single absurd record moves the blended average for everyone, and the failure modes we have
 * actually seen produce exactly such records: a watchdog kill at the wall-clock cap, a crashed
 * instance leaving `endedAt` unset, a clock skew. Each of those is a real event worth reporting — and
 * none of them is evidence of how long a normal build takes.
 */
export const MIN_SANE_BUILD_MS = 5_000;          // under 5s nothing was really built
export const MAX_SANE_BUILD_MS = 45 * 60_000;    // past 45 min it was almost certainly killed, not finished

/**
 * FAILED BUILDS ARE EXCLUDED, and that is the important judgement here.
 *
 * A build that died at the watchdog cap took 30 minutes; a build that failed in 40 seconds took 40
 * seconds. Feeding either into "how long does a build take" corrupts the answer in opposite
 * directions, and the second is the more dangerous one — it makes the ETA optimistic, which is the
 * complaint we started from. Only builds that genuinely finished describe how long finishing takes.
 */
export function isTeachableBuild(r: BuildRecordLike): boolean {
  if (!r || typeof r.startedAt !== 'number' || typeof r.endedAt !== 'number') return false;
  const ms = r.endedAt - r.startedAt;
  if (!(ms >= MIN_SANE_BUILD_MS && ms <= MAX_SANE_BUILD_MS)) return false;
  // `ok` is authoritative when present; otherwise fall back to the recorded outcome string.
  if (typeof r.ok === 'boolean') return r.ok;
  if (typeof r.outcome === 'string') return !/fail|error|abort|timeout|cancel/i.test(r.outcome);
  return false; // no success signal at all ⇒ do not teach from it
}

/**
 * Turn stored build records into the history the estimator understands.
 *
 * WHY EVERY ENTRY CARRIES THE **CURRENT** COMPLEXITY, which looks wrong until you see what is being
 * predicted. The history we keep (`listDiagnosticsHistory`) is per-WORKSPACE — these are past builds of
 * *the same app*, and no stored entry carries a file count. Stamping them with a guessed complexity
 * would be a fabrication; stamping them with the complexity of the build about to run says the true
 * thing: *"here is how long builds on this app have actually taken."*
 *
 * That is also the strongest available predictor. The estimator weights history by how CLOSE a past
 * build's complexity is to the current one, so same-app history gets full weight — which is right,
 * because the same project, the same stack and the same user's editing habits are far more predictive
 * of the next build than a stranger's app with a similar file count.
 *
 * Newest first, capped: a build from months ago describes an engine that no longer exists.
 */
export function historyFromRecords(
  records: readonly BuildRecordLike[],
  currentComplexity: Complexity,
  limit = 20,
): HistoricalBuild[] {
  const out: HistoricalBuild[] = [];
  for (const r of records ?? []) {
    if (out.length >= limit) break;
    if (!isTeachableBuild(r)) continue;
    out.push({
      complexity: currentComplexity,
      durationMs: (r.endedAt as number) - (r.startedAt as number),
    });
  }
  return out;
}

/**
 * Is there enough history to be worth trusting at all?
 *
 * Below this the estimator's own blending already leans on the heuristic, so calling it "learned"
 * would overstate what happened. Used only for what we TELL the admin — never to withhold history
 * from the estimator, which handles a thin history correctly on its own.
 */
export const MIN_HISTORY_FOR_LEARNED = 3;

export function etaBasisNote(history: readonly HistoricalBuild[]): string {
  if (history.length === 0) return 'No past builds to learn from yet — this is a first estimate.';
  if (history.length < MIN_HISTORY_FOR_LEARNED) {
    return `Only ${history.length} past build${history.length === 1 ? '' : 's'} to learn from — still mostly an estimate.`;
  }
  return `Learned from your last ${history.length} builds.`;
}

/**
 * Read this workspace's own recent builds and turn them into estimator history.
 *
 * Best-effort by construction: any failure yields `[]`, which is byte-for-byte today's behaviour (a
 * cold heuristic estimate). An ETA is never worth delaying or failing a build for.
 */
export async function recentBuildHistoryFor(
  workspaceId: string | null | undefined,
  currentComplexity: Complexity,
  listFn: (id: string, limit?: number) => Promise<BuildRecordLike[]>,
  limit = 20,
): Promise<HistoricalBuild[]> {
  if (!workspaceId) return [];
  try {
    const rows = await listFn(workspaceId, limit);
    return historyFromRecords(rows ?? [], currentComplexity, limit);
  } catch {
    return [];
  }
}
