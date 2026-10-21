// AgentV3 — FIRST-PASS QUALITY: the one number that says whether the engine is actually getting better.
//
// WHY THIS EXISTS (ROADMAP #1 Phase 0.2). We shipped ~500 capability points and could not answer the
// only question that matters to a user: *did the app work the first time?* Without that number, every
// "we improved it" claim is a feeling, and a regression is invisible until a user complains. Rule 3
// (no sycophancy) applied to metrics: measure honestly, or do not claim improvement.
//
// WHAT WE MEASURE, AND WHY IT IS *NOT* "did the build succeed". The fifth absolute rule's 50/50 law is
// explicit: **a self-heal is NOT a success — it is a RED FLAG.** A build that generated a bug and then
// repaired it still burned the user's time and money, and the same bug class will fire again on the next
// build. So the headline number is the CLEAN rate — builds that needed ZERO heals — not the ok rate.
// A rising ok rate with a flat clean rate means the heals are working and the BUILDER is not; that is
// exactly the ceiling the constitution tells us to name out loud instead of hiding behind a checkmark.
//
// Four states:
//   • clean  — delivered, and the engine repaired nothing. This is the target (goal: ≥85%).
//   • healed — delivered with repairs or findings left open. Counts as NOT first-pass; split below.
//   • failed — did not deliver a working app.
//   • unknown — delivered, but repair/unresolved measurements are missing or invalid; excluded.
//
// Production report/listing adapters interpret producer provenance before supplying scalar counts.
// Old unversioned closed-event counters are not repair measurements. Delivered rows with unknown
// totals are excluded (and counted as unknown), never silently clean or repaired. Full timelines are
// used only when already available; metadata-only queries never fetch or rewrite historical reports.
//
// Pure + dependency-free (report objects in → numbers out) so it is fully unit-testable.

import { isSelfHeal, interpretRepairCount, repairCountFromProjection, hasMeasuredRepairProvenance, type HealCountInterpretation } from './healIssue';

/** The slice of a BuildDiagnosticsReport this module needs — structural, so tests need no fixtures. */
export interface FirstPassInput {
  ok?: boolean;
  startedAt?: number;
  counts?: { autoResolved?: number | null; unresolved?: number | null; leftOpen?: number };
  issues?: Array<{ code?: string; severity?: string; autoResolved?: boolean; observation?: boolean }>;
}

export type FirstPassVerdict = 'clean' | 'healed' | 'failed' | 'unknown';

/**
 * Classify ONE normalized scalar input. Full reports/listings must use the provenance adapters.
 * Both repair and unresolved measurements must be explicit finite nonnegative numbers.
 *
 * A build that did not deliver is `failed` regardless of how much it healed along the way — healing on
 * the way to a failure is not a partial win. A delivered build is `clean` only when the engine repaired
 * nothing AND left nothing unresolved; repairs or remaining findings make it `healed` (the legacy
 * name for "not first-pass"). The aggregate distinguishes repaired from warning-only delivery.
 */
export function classifyFirstPass(report: FirstPassInput | null | undefined): FirstPassVerdict {
  if (!report || report.ok !== true) return 'failed';
  const measured = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!measured(report.counts?.autoResolved) || !measured(report.counts?.unresolved)
    || (report.counts?.leftOpen !== undefined && !measured(report.counts.leftOpen))) return 'unknown';
  // Findings left OPEN (a readiness warning, a stale snapshot) stopped counting as heals on 2026-09-30
  // and moved to `leftOpen`; a build carrying one was still not right first time, so both count here.
  // Missing `leftOpen` remains compatible here; production adapters qualify the producer semantics.
  const healed = (report.counts?.autoResolved ?? 0) + (report.counts?.leftOpen ?? 0);
  const unresolved = report.counts?.unresolved ?? 0;
  return healed === 0 && unresolved === 0 ? 'clean' : 'healed';
}

export interface FirstPassStats {
  total: number;
  /** Explicit unknown inputs excluded from this scalar aggregate. */
  unknown?: number;
  clean: number;
  healed: number;
  failed: number;
  /** THE headline: share of builds that were right first time, 0–1. `null` when there is no data yet. */
  cleanRate: number | null;
  /** Share that delivered at all (clean + healed), 0–1 — the number that flatters us; kept beside the
   *  headline on purpose so nobody can quote it alone. `null` when there is no data yet. */
  deliveredRate: number | null;
  /** Which repairs fire most, worst first — the ACTIONABLE half: each one is an upstream bug to prevent
   *  so the heal becomes dead code (50/50 law), not a heal to celebrate. */
  topHealCodes: Array<{ code: string; count: number }>;
  /**
   * Delivered builds the engine actually repaired (`autoResolved` > 0). A subset of `healed`.
   * The rest of `healed` is `warningOnly` — a warning was left, nothing was repaired.
   */
  repaired: number;
  /** Delivered, not clean, and the engine repaired nothing. A subset of `healed`. */
  warningOnly: number;
}

/** How many heal codes to surface. Enough to act on, few enough to read at a glance. */
const TOP_HEAL_CODES = 8;

/**
 * Aggregate a set of reports (newest-first or oldest-first — order is irrelevant).
 *
 * `topHealCodes` counts issues the engine RESOLVED ITSELF, excluding observations. Sorted by count
 * desc, then code asc so the output is deterministic (a flapping "top problem" list is unreadable and
 * makes week-over-week comparison meaningless).
 */
export function firstPassStats(reports: Array<FirstPassInput | null | undefined>): FirstPassStats {
  const list = (reports ?? []).filter(Boolean) as FirstPassInput[];
  let clean = 0, healed = 0, failed = 0, repaired = 0, warningOnly = 0, unknown = 0;
  const healCodes = new Map<string, number>();
  for (const r of list) {
    const v = classifyFirstPass(r);
    if (v === 'unknown') unknown++;
    else if (v === 'clean') clean++;
    else if (v === 'healed') {
      healed++;
      if ((r.counts?.autoResolved ?? 0) > 0) repaired++;
      else warningOnly++;
    } else failed++;
    for (const i of r.issues ?? []) {
      // ONE definition of a heal (`healIssue.ts`, 2026-09-25): this loop had its own — the flag plus
      // the observation clause — and would have ranked TOOL_CALL as the top repair on any real report.
      if (!isSelfHeal(i)) continue;
      const code = typeof i.code === 'string' && i.code ? i.code : 'UNKNOWN';
      healCodes.set(code, (healCodes.get(code) ?? 0) + 1);
    }
  }
  const total = list.length - unknown;
  return {
    total,
    ...(unknown ? { unknown } : {}),
    clean,
    healed,
    failed,
    cleanRate: total > 0 ? clean / total : null,
    deliveredRate: total > 0 ? (clean + healed) / total : null,
    repaired,
    warningOnly,
    topHealCodes: [...healCodes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_HEAL_CODES)
      .map(([code, count]) => ({ code, count })),
  };
}

/**
 * The admin-list projection of a reported build. Unversioned scalar-only metadata cannot establish
 * repair semantics; new rows carry interpretation from the full report already available at save time.
 */
export interface FirstPassMeta {
  ok?: boolean | null;
  healCount?: number | null;
  /** Optional producer tag on a scalar projection; never infer it from a date. */
  healRule?: number;
  /** New projections retain interpretation from the already-loaded full report. */
  repairCount?: HealCountInterpretation | null;
  unresolvedCount?: number;
  /** Findings left open (see `classifyFirstPass`). Absent on older rows, whose healCount includes them. */
  leftOpenCount?: number;
  /** The user ended this build. Not a failure. Absent means "not known", and those still count as failed. */
  userStopped?: boolean | null;
}

export interface FirstPassMetaStats extends FirstPassStats {
  /** Rows excluded because counts are missing or historical repair semantics are unverified — never quoted as if
   *  it covered them. Counting a legacy row as clean would inflate the exact number we judge ourselves by. */
  skippedLegacy: number;
  /** Builds the user stopped. Left out of `failed` and out of the denominator. */
  userStopped: number;
  /** Skipped delivered rows whose warnings are known even though the repair total is not. */
  unknownWithWarnings?: number;
  qualifiedBuilds?: number;
}

/** Both diagnostics projections already carry this normalization, with no additional fetch. */
export function firstPassMetaFromDiagnostics(row: {
  ok?: boolean | null;
  counts?: { autoResolved?: number; healRule?: number; unresolved?: number; leftOpen?: number } | null;
  healCodes?: { total: number | null; interpretation?: HealCountInterpretation } | null;
  userStopped?: boolean | null;
}): FirstPassMeta {
  const repairCount = repairCountFromProjection(row);
  return {
    ok: row.ok,
    healCount: repairCount?.total ?? null,
    repairCount,
    unresolvedCount: row.counts?.unresolved,
    leftOpenCount: row.counts?.leftOpen,
    userStopped: row.userStopped === true,
  };
}

/**
 * Aggregate over the admin list projection. A DELIVERED row with no counts is skipped (unknowable),
 * but a row that says `ok === false` is still a real failure — that fact needs no counts.
 */
export function firstPassStatsFromMeta(metas: Array<FirstPassMeta | null | undefined>): FirstPassMetaStats {
  const usable: FirstPassInput[] = [];
  let skippedLegacy = 0;
  let userStopped = 0;
  let unknownWithWarnings = 0;
  let qualifiedBuilds = 0;
  for (const m of metas ?? []) {
    if (!m) continue;
    if (m.ok === false) {
      if (m.userStopped === true) { userStopped++; continue; }
      usable.push({ ok: false });
      continue;
    }
    // A scalar without a producer tag is compatibility evidence, not verified repair semantics.
    // Explicit null (including failed normalization) must not trigger a fallback.
    const interpretation = m.repairCount === undefined
      ? interpretRepairCount({ counts: { autoResolved: m.healCount, healRule: m.healRule } }) : m.repairCount;
    const healCount = interpretation?.total;
    if (!hasMeasuredRepairProvenance(interpretation?.provenance) || typeof healCount !== 'number' || !Number.isFinite(healCount)
      || healCount < 0 || typeof m.unresolvedCount !== 'number' || !Number.isFinite(m.unresolvedCount) || m.unresolvedCount < 0
      || (m.leftOpenCount !== undefined && (typeof m.leftOpenCount !== 'number' || !Number.isFinite(m.leftOpenCount) || m.leftOpenCount < 0))) {
      skippedLegacy++;
      if ((m.leftOpenCount ?? 0) > 0 || (m.unresolvedCount ?? 0) > 0) unknownWithWarnings++;
      continue;
    }
    if (interpretation?.provenance !== 'current-rule') qualifiedBuilds++;
    usable.push({ ok: m.ok === true, counts: { autoResolved: healCount, unresolved: m.unresolvedCount, leftOpen: m.leftOpenCount } });
  }
  return { ...firstPassStats(usable), skippedLegacy, userStopped,
    ...(unknownWithWarnings ? { unknownWithWarnings } : {}), ...(qualifiedBuilds ? { qualifiedBuilds } : {}) };
}

/** The admin-facing target from ROADMAP #1: "#1" is not claimable below this clean rate. */
export const FIRST_PASS_TARGET = 0.85;

/**
 * One honest sentence for the admin dashboard. Never rounds a miss up to the target, and never reports
 * a rate at all when there is no data — "0%" and "no builds yet" are different facts.
 */
export function firstPassHeadline(stats: FirstPassStats): string {
  if (stats.cleanRate === null) return 'No measured first-pass results — quality is unknown.';
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const hit = stats.cleanRate >= FIRST_PASS_TARGET;
  return `${pct(stats.cleanRate)} of ${stats.total} build(s) were right first time `
    + `(${stats.clean} clean, ${stats.repaired} repaired, ${stats.warningOnly} warning-only, ${stats.failed} failed) — `
    + `${hit ? 'at or above' : 'below'} the ${pct(FIRST_PASS_TARGET)} target.`
    + ((stats as FirstPassMetaStats).qualifiedBuilds ? ` ${(stats as FirstPassMetaStats).qualifiedBuilds} build(s) retain older/future producer-rule semantics.` : '');
}
