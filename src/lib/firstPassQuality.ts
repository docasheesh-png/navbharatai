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
// Three buckets, deliberately not four:
//   • clean  — delivered, and the engine repaired nothing. This is the target (goal: ≥85%).
//   • healed — delivered, but only after repairing its own output. Counts as NOT first-pass.
//   • failed — did not deliver a working app.
//
// The heal signal is `counts.autoResolved`, which already excludes OBSERVATIONS (advisory notes about
// the user's pre-existing code). That exclusion is load-bearing: before it existed, an import turn's 14
// advisory notes were counted as self-heals and a build that healed essentially nothing reported "32
// auto-resolved". A self-heal tally that inflates itself corrupts the very number the autopsy reads, so
// this module trusts `counts` rather than re-deriving from `issues` — one definition, one source.
//
// Pure + dependency-free (report objects in → numbers out) so it is fully unit-testable.

/** The slice of a BuildDiagnosticsReport this module needs — structural, so tests need no fixtures. */
export interface FirstPassInput {
  ok?: boolean;
  startedAt?: number;
  counts?: { autoResolved?: number; unresolved?: number };
  issues?: Array<{ code?: string; autoResolved?: boolean; observation?: boolean }>;
}

export type FirstPassVerdict = 'clean' | 'healed' | 'failed';

/**
 * Classify ONE build.
 *
 * A build that did not deliver is `failed` regardless of how much it healed along the way — healing on
 * the way to a failure is not a partial win. A delivered build is `clean` only when the engine repaired
 * nothing AND left nothing unresolved; anything else it had to fix about its own output makes it
 * `healed`, because the honest question is "was the FIRST attempt right", not "did we recover".
 */
export function classifyFirstPass(report: FirstPassInput | null | undefined): FirstPassVerdict {
  if (!report || report.ok !== true) return 'failed';
  const healed = report.counts?.autoResolved ?? 0;
  const unresolved = report.counts?.unresolved ?? 0;
  return healed === 0 && unresolved === 0 ? 'clean' : 'healed';
}

export interface FirstPassStats {
  total: number;
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
  let clean = 0, healed = 0, failed = 0;
  const healCodes = new Map<string, number>();
  for (const r of list) {
    const v = classifyFirstPass(r);
    if (v === 'clean') clean++; else if (v === 'healed') healed++; else failed++;
    for (const i of r.issues ?? []) {
      if (!i || i.autoResolved !== true || i.observation === true) continue;
      const code = typeof i.code === 'string' && i.code ? i.code : 'UNKNOWN';
      healCodes.set(code, (healCodes.get(code) ?? 0) + 1);
    }
  }
  const total = list.length;
  return {
    total,
    clean,
    healed,
    failed,
    cleanRate: total > 0 ? clean / total : null,
    deliveredRate: total > 0 ? (clean + healed) / total : null,
    topHealCodes: [...healCodes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_HEAL_CODES)
      .map(([code, count]) => ({ code, count })),
  };
}

/**
 * The admin-list projection of a reported build. `healCount`/`unresolvedCount` are absent on records
 * written before the field existed — those rows carry no quality signal at all.
 */
export interface FirstPassMeta {
  ok?: boolean | null;
  healCount?: number;
  unresolvedCount?: number;
}

export interface FirstPassMetaStats extends FirstPassStats {
  /** Rows excluded because they predate the counts field — reported so the rate is never quoted as if
   *  it covered them. Counting a legacy row as clean would inflate the exact number we judge ourselves by. */
  skippedLegacy: number;
}

/**
 * Aggregate over the admin list projection. A DELIVERED row with no counts is skipped (unknowable),
 * but a row that says `ok === false` is still a real failure — that fact needs no counts.
 */
export function firstPassStatsFromMeta(metas: Array<FirstPassMeta | null | undefined>): FirstPassMetaStats {
  const usable: FirstPassInput[] = [];
  let skippedLegacy = 0;
  for (const m of metas ?? []) {
    if (!m) continue;
    if (m.ok === false) { usable.push({ ok: false }); continue; }
    if (typeof m.healCount !== 'number' || typeof m.unresolvedCount !== 'number') { skippedLegacy++; continue; }
    usable.push({ ok: m.ok === true, counts: { autoResolved: m.healCount, unresolved: m.unresolvedCount } });
  }
  return { ...firstPassStats(usable), skippedLegacy };
}

/** The admin-facing target from ROADMAP #1: "#1" is not claimable below this clean rate. */
export const FIRST_PASS_TARGET = 0.85;

/**
 * One honest sentence for the admin dashboard. Never rounds a miss up to the target, and never reports
 * a rate at all when there is no data — "0%" and "no builds yet" are different facts.
 */
export function firstPassHeadline(stats: FirstPassStats): string {
  if (stats.cleanRate === null) return 'No builds recorded yet — first-pass quality is unknown.';
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const hit = stats.cleanRate >= FIRST_PASS_TARGET;
  return `${pct(stats.cleanRate)} of ${stats.total} build(s) were right first time `
    + `(${stats.clean} clean, ${stats.healed} needed repair, ${stats.failed} failed) — `
    + `${hit ? 'at or above' : 'below'} the ${pct(FIRST_PASS_TARGET)} target.`;
}
