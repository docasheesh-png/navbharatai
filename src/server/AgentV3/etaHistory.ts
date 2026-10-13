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
import type { TaskType } from './RequestAnalyser';

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

/**
 * An entry is the mean of at least this many finished builds — from one day, or from sparse days pooled
 * (autopsy 303e8a6f, Q-967). One build is not an average.
 */
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
): { history: HistoricalBuild[]; builds: number; days: number; seenOk: number; daysRead: number } {
  const history: HistoricalBuild[] = [];
  let builds = 0;
  // 🔎 What the window HELD, before the per-day floor: an empty `history` alone cannot tell "no build of this
  // kind finished" from "they finished one a day" (autopsy 303e8a6f — both read "no past builds").
  let seenOk = 0;
  const window = (days ?? []).slice(0, maxDays);
  if (!taskType) return { history, builds, days: 0, seenOk, daysRead: window.length };
  // 🔴 SPARSE DAYS ARE POOLED, NOT DROPPED (autopsy 303e8a6f, Q-967). A day with one finished build was thrown
  // away, so a slice the platform used once or twice a day — a NEW slice like `scaffold_pro`, or a quiet template
  // — never taught anything and its ETA was priced from the chip's wording for a whole week. Such days are summed
  // until together they hold FLEET_MIN_BUILDS_PER_DAY builds, and then become ONE entry. Only days that carry the
  // successful-build fields are pooled; a legacy day keeps its old rule.
  let taughtDays = 0;
  const pool = { n: 0, ms: 0, sq: 0, sqKnown: true, days: 0 };
  const emitPool = () => {
    const mean = pool.ms / pool.n;
    if (mean >= MIN_SANE_BUILD_MS && mean <= MAX_SANE_BUILD_MS) {
      const meanSec = mean / 1000;
      const sd = pool.sqKnown && pool.sq > 0 ? Math.sqrt(Math.max(0, pool.sq / pool.n - meanSec * meanSec)) * 1000 : 0;
      history.push({ complexity: currentComplexity, durationMs: Math.round(mean), ...(sd > 0 ? { sdMs: Math.round(sd) } : {}) });
      builds += pool.n;
      taughtDays += pool.days;
    }
    Object.assign(pool, { n: 0, ms: 0, sq: 0, sqKnown: true, days: 0 });
  };
  for (const d of window) {
    const slice = d?.byTaskType?.[taskType];
    const finished = Number(slice?.okBuilds);
    if (Number.isFinite(finished) && finished > 0) seenOk += finished;
    // 🔴 SUCCESSFUL builds only, wherever the day carries them (autopsy 19641ab5). A build the user
    // stopped at 1.8 min and a failure at 40 s are not how long an app of this kind takes; the
    // telemetry has split them out since 728a402d (`okDurationMs`), and this reader still averaged
    // every build. A day written before that field existed keeps the old mean — never a zero.
    const okN = Number(slice?.okBuilds);
    const okMs = Number(slice?.okDurationMs);
    const hasOk = Number.isFinite(okN) && Number.isFinite(okMs) && okN > 0 && okMs > 0;
    const n = hasOk ? okN : (slice?.okDurationMs === undefined ? Number(slice?.builds) : NaN);
    const ms = hasOk ? okMs : Number(slice?.durationMs);
    if (hasOk && okN < FLEET_MIN_BUILDS_PER_DAY) {
      const daySq = Number(slice?.okDurationSqSec);
      pool.n += okN;
      pool.ms += okMs;
      if (Number.isFinite(daySq) && daySq > 0) pool.sq += daySq; else pool.sqKnown = false;
      pool.days += 1;
      if (pool.n >= FLEET_MIN_BUILDS_PER_DAY) emitPool();
      continue;
    }
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
    taughtDays += 1;
  }
  // A leftover pool under FLEET_MIN_BUILDS_PER_DAY builds is not emitted: one build is not an average.
  // `days` counts the CALENDAR days that taught (a pooled entry spans several), not the entries.
  return { history, builds, days: taughtDays, seenOk, daysRead: window.length };
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

/**
 * A PRO template is a different build from a simple one (adversarial review of autopsy 303e8a6f). A simple template
 * IS the finished app — the turn verifies and polishes it; a pro template is an architecture the builder EXTENDS to
 * the request. Filed under one key, the slice averaged the two, so a simple chip's ETA learned from pro extend
 * builds and the admin line called those "verify and polish". Each tier learns from its own builds.
 */
export const SCAFFOLD_PRO_TASK_KEY = 'scaffold_pro';

/**
 * WHAT KIND OF BUILD THIS IS, KNOWN FROM THE PROMPT BEFORE THE ETA IS SHOWN (admin 2026-10-11, build
 * 46e2d74b — item L-12).
 *
 * 🔴 "Create an racing game for Nokia c 2-01" scored `simple_app` (a game counts as a personal tool unless
 * it names 3D, multiplayer, a physics engine or an open world — admin decision 2026-09-27), so its ETA was
 * learned from the `simple_app` slice: mostly fast-lane apps finished in two to four minutes. But EVERY
 * game skips the fast lane (`fastLaneSkipsGame`) and is built by the full builder with the game recipes
 * and a playtest, and the route only decided that a few thousand lines AFTER the ETA was fixed. The user
 * was told 2–4 min; the build took 7.4. The same blindness priced an app that makes pictures
 * (`fastLaneSkipsImageApp`) as a fast-lane app.
 *
 * Both facts are deterministic from the prompt alone — the platform's own domain classifier and the image-
 * app detector, the same readings the fast-lane skips use — so the kind is decided here, up front, and
 * keys its own slice: games learn from games, picture apps from picture apps. Routing is untouched; this
 * only changes which past builds the estimate is taught by.
 */
export type EtaBuildKind = 'game' | 'image_app';
export function etaBuildKind(domain: string | null | undefined, generatesImages: boolean): EtaBuildKind | null {
  if (domain === 'game') return 'game';
  if (generatesImages) return 'image_app';
  return null;
}

/**
 * The ONE key both sides use: the reader that picks the ETA's slice and the telemetry writer that files the
 * finished build under it. They were built two different ways (the writer left out `routedComplex`), so the
 * history a routed-complex build was filed under was not the history it was later priced from. `kind` is
 * `etaBuildKind`'s answer. PURE.
 */
export function etaTaskKey(taskType: string | null | undefined, scaffolded: boolean, routedComplex = false, kind: EtaBuildKind | null = null, scaffoldTier: 'simple' | 'pro' | null = null): string {
  if (scaffolded) return scaffoldTier === 'pro' ? SCAFFOLD_PRO_TASK_KEY : SCAFFOLD_TASK_KEY;
  // A seeded template stays its own kind (above); otherwise the build's kind decides before its label.
  if (kind) return kind;
  const t = String(taskType ?? '').trim() || 'unknown';
  // The scorer cannot read every script (autopsy Sur Taal: a Hindi design note scored `simple_app`), and the
  // complexity router then asked a second opinion and opened the build as COMPLEX. The ETA must price the
  // build the router decided on, not the scorer's unread guess — so a routed-complex build is a complex_app.
  if (routedComplex && (t === 'simple_app' || t === 'unknown')) return 'complex_app';
  return t;
}

/**
 * The words for every slice the ETA can learn from — one table, so the line that says a slice WAS used and the
 * line that says it was EMPTY name it identically. Keyed by every `TaskType` plus the build kinds `etaTaskKey`
 * adds, so a new task type or kind fails to compile until it has words (autopsy 303e8a6f).
 */
const SLICE_WORDS: Record<TaskType | typeof SCAFFOLD_TASK_KEY | typeof SCAFFOLD_PRO_TASK_KEY | EtaBuildKind | 'unknown', string> = {
  scaffold: 'builds that start from a tested template (verify and polish)',
  scaffold_pro: 'builds that extend a tested pro template to the request',
  game: 'game builds',
  image_app: 'builds of apps that make pictures',
  complex_app: 'complex app builds',
  simple_app: 'simple app builds',
  app_unsized: 'app builds the request did not size',
  edit_unsized: 'edits to an existing app',
  coding: 'coding changes to an existing app',
  debugging: 'fix (debugging) turns',
  architecture: 'architecture turns',
  translate: 'translation turns',
  summary: 'summary turns',
  chat: 'chat turns',
  unknown: 'builds of an unrecognised kind',
};

/** How a slice is named to the admin. PURE. */
export function etaSliceWords(taskType: string): string {
  return (SLICE_WORDS as Record<string, string>)[taskType] ?? `"${taskType}" builds`;
}

/** The admin line for an estimate taught by the platform's recent builds of this kind. PURE. */
export function fleetEtaBasisNote(taskType: string, builds: number, days: number): string {
  return `No past builds of this app — using NavBharatAI's recent average for ${etaSliceWords(taskType)} (${builds} build${builds === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'}).`;
}

/**
 * The admin line when the platform's slice for this kind gave the estimate NOTHING — which says which slice was
 * asked and why it was empty, instead of "no past builds" (autopsy 303e8a6f). That sentence was the same for a
 * template build and a from-scratch complex app, so a regressed key was invisible; and it claimed "no past
 * builds" from a filter that only proves "no day with FLEET_MIN_BUILDS_PER_DAY finished builds". PURE.
 */
export function fleetEmptyBasisNote(taskType: string, seenOk: number, daysRead: number, opts: { readFailed?: boolean } = {}): string {
  const kind = etaSliceWords(taskType);
  const window = `the last ${daysRead} day${daysRead === 1 ? '' : 's'}`;
  // A read that timed out or threw is said as exactly that — never as "no days" (adversarial review of 303e8a6f).
  if (opts.readFailed === true) {
    return `No past builds of this app, and the platform's build telemetry for ${kind} could not be read in time (timed out or failed) — this is the heuristic alone.`;
  }
  if (daysRead <= 0) {
    // The telemetry store turns its own failure into an empty list, so "no days" cannot be told from a quiet failure.
    return `No past builds of this app, and the platform's build telemetry returned no days to learn ${kind} from (an empty week, or a read that failed without saying so) — this is the heuristic alone.`;
  }
  if (seenOk <= 0) {
    return `No past builds of this app, and none of NavBharatAI's ${kind} finished in ${window} — this is the heuristic alone.`;
  }
  // Sparse days are pooled (Q-967), so "never 2 on one day" is no longer a reason the slice is empty.
  if (seenOk < FLEET_MIN_BUILDS_PER_DAY) {
    return `No past builds of this app. NavBharatAI finished only ${seenOk} of its ${kind} in ${window} — one build is not an average, so this is the heuristic alone.`;
  }
  return `No past builds of this app. NavBharatAI finished ${seenOk} of its ${kind} in ${window}, but none gave a usable average `
    + `(a mean outside 5 s – 45 min, or no duration recorded) — this is the heuristic alone.`;
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
