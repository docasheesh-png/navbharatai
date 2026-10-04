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
  /** Time spent waiting for the user's answer — not build time (autopsy 1219c639). */
  userWaitMs?: number;
}

/** The build's own working time: wall clock minus the time it waited for the user. PURE. */
export function workingMs(r: BuildRecordLike): number {
  const wall = (r.endedAt as number) - (r.startedAt as number);
  const wait = Number(r.userWaitMs);
  return Number.isFinite(wait) && wait > 0 ? Math.max(0, wall - wait) : wall;
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
  const ms = workingMs(r);
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
      durationMs: workingMs(r),
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

/** The per-day, per-task-type slice of the platform's own cost telemetry the fleet prior reads. */
export interface FleetTelemetryDayLike {
  date?: string;
  byTaskType?: Record<string, { builds?: number; durationMs?: number; okBuilds?: number; okDurationMs?: number; okDurationSqSec?: number } | undefined>;
}

/** Fewer builds of a kind on one day than this, and that day's mean is noise, not a measurement. */
export const FLEET_MIN_BUILDS_PER_DAY = 2;

/**
 * The PLATFORM's recent builds of this kind, as estimator history — for an app with no builds of its own.
 * PURE.
 *
 * 🔴 AUTOPSY a5b661c8 (2026-09-30): a complex six-step app was told "~5–11 min" and took 24.3. It was the
 * workspace's first build, so `historyFromRecords` had nothing and the estimate fell back to the prompt
 * heuristic — which this module's own header says runs backwards on short, ambitious prompts. The
 * platform DID know how long complex apps take: every build is folded into the daily cost telemetry,
 * per task type, with its duration. That record was read by the admin report and never by the ETA.
 *
 * One entry per day (that day's mean for this task type), newest first, and only days with enough builds
 * of the kind to be a measurement. Stamped with the CURRENT complexity for the reason `historyFromRecords`
 * gives. The mean is of SUCCESSFUL builds (`okDurationMs`) wherever the day records them; only a day
 * written before that field existed falls back to the mean of every build. The workspace's own history
 * still wins the moment it exists.
 */
export function fleetHistoryFromTelemetry(
  days: readonly FleetTelemetryDayLike[],
  taskType: string | null | undefined,
  currentComplexity: Complexity,
  maxDays = 7,
): { history: HistoricalBuild[]; builds: number; days: number } {
  const history: HistoricalBuild[] = [];
  let builds = 0;
  if (!taskType) return { history, builds, days: 0 };
  for (const d of (days ?? []).slice(0, maxDays)) {
    const slice = d?.byTaskType?.[taskType];
    // 🔴 SUCCESSFUL builds only, wherever the day carries them (autopsy 19641ab5). A build the user
    // stopped at 1.8 min and a failure at 40 s are not how long an app of this kind takes; the
    // telemetry has split them out since 728a402d (`okDurationMs`), and this reader still averaged
    // every build. A day written before that field existed keeps the old mean — never a zero.
    const okN = Number(slice?.okBuilds);
    const okMs = Number(slice?.okDurationMs);
    const hasOk = Number.isFinite(okN) && Number.isFinite(okMs) && okN > 0 && okMs > 0;
    const n = hasOk ? okN : (slice?.okDurationMs === undefined ? Number(slice?.builds) : NaN);
    const ms = hasOk ? okMs : Number(slice?.durationMs);
    if (!Number.isFinite(n) || !Number.isFinite(ms) || n < FLEET_MIN_BUILDS_PER_DAY || ms <= 0) continue;
    const mean = ms / n;
    if (!(mean >= MIN_SANE_BUILD_MS && mean <= MAX_SANE_BUILD_MS)) continue;
    // How far that day's builds were from its mean, when the day recorded it (`okDurationSqSec`) — so the
    // band reflects one build's spread, not only the spread of daily averages (autopsy 68f0a486).
    const sq = Number(slice?.okDurationSqSec);
    const meanSec = mean / 1000;
    const daySd = hasOk && n >= 2 && Number.isFinite(sq) && sq > 0
      ? Math.sqrt(Math.max(0, sq / n - meanSec * meanSec)) * 1000
      : 0;
    history.push({ complexity: currentComplexity, durationMs: Math.round(mean), ...(daySd > 0 ? { sdMs: Math.round(daySd) } : {}) });
    builds += n;
  }
  return { history, builds, days: history.length };
}

/**
 * The telemetry slice a build is counted under, and the one its ETA learns from.
 *
 * 🔴 A BUILD THAT STARTS FROM A TESTED TEMPLATE IS NOT A FROM-SCRATCH BUILD OF THE SAME PROMPT (autopsy
 * 4a1c0157, 2026-10-01). A starter chip's login page scored 58 (`complex_app`): routing already knew the
 * template was seeded and opened it on the cheap rung (`scaffoldedComplexityDecision`), but the ETA asked
 * the fleet how long `complex_app` builds take and told the user ~11 min. The build verified and polished
 * the template in 3.8. The same key also poured every short template build into the `complex_app`
 * average, pulling a from-scratch complex build's estimate down. Routing, the ETA and the history now
 * agree on one answer: a seeded build is its own kind. PURE.
 */
export const SCAFFOLD_TASK_KEY = 'scaffold';
export function etaTaskKey(taskType: string | null | undefined, scaffolded: boolean, routedComplex = false): string {
  if (scaffolded) return SCAFFOLD_TASK_KEY;
  const t = String(taskType ?? '').trim() || 'unknown';
  // The scorer cannot read every script (autopsy Sur Taal: a Hindi design note scored `simple_app`), and the
  // complexity router then asked a second opinion and opened the build as COMPLEX. The ETA must price the
  // build the router decided on, not the scorer's unread guess — so a routed-complex build is a complex_app.
  if (routedComplex && (t === 'simple_app' || t === 'unknown')) return 'complex_app';
  return t;
}

/** The admin line for an estimate taught by the platform's recent builds of this kind. PURE. */
export function fleetEtaBasisNote(taskType: string, builds: number, days: number): string {
  const kind = taskType === SCAFFOLD_TASK_KEY
    ? 'builds that start from a tested template (verify and polish)'
    : `"${taskType}" builds`;
  return `No past builds of this app — using NavBharatAI's recent average for ${kind} (${builds} build${builds === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'}).`;
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
