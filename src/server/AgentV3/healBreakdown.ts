// WHICH REPAIRS FIRE — the work list behind "6.49 heals per build" (admin 2026-09-24: "jo rah gaya hai karo").
//
// PR #3298 put the real population under the Builder scorecard and closed by naming what it did not
// do: *"the heal tally is one number with no breakdown — 6.49 per build, worst 86, and nothing says
// WHICH repairs fire."* Without that, the 50/50 law's central instruction — *"trace why the bug class
// exists and prevent it upstream so v3.0 never has to heal it"* — has no class to trace. A rate is a
// symptom; a ranked list of codes is a work list.
//
// 🔑 IT COSTS NO EXTRA I/O, the same argument `modelPerformance` makes. Both readers of a stored
// report (`listAllDiagnostics` and `listDiagnosticsHistoryInner`) already load the whole document to
// project `ok`/`summary`, so `issues` is in memory; counting it is a walk over at most 500 records.
//
// 🔴 AND THE STORED TIMELINE IS NOT THE WHOLE TIMELINE — which is the entire reason this module
// returns a completeness fact rather than a bare tally. `trimReportForStorage` caps `issues` at 500
// while `counts` keeps the FULL build's numbers, so on a long build the codes that can be SEEN sum to
// fewer heals than really happened. This repo has already paid for that confusion three times
// (`reportTruncation.ts` names them: 40 of 312 model calls reported as forty, `liveTokens` printing
// `0 in · 0 out` for an unsettled build, `JOURNEY_PASSED` on a run that launched no browser), and its
// ruling is the one applied here: **an absent measurement is not a measurement of zero.**
//
// A counter is usable only with producer provenance: unversioned historical autoResolved may be a
// closed-EVENT count, not repairs. interpretRepairCount keeps raw evidence, compatibility arithmetic,
// the usable total and observed rows separate. Unknown totals never become zero or raw fallbacks.
// A numeric deficit is unattributed, not proof of storage trimming; timeline completeness is its own
// evidence field. Zero observed structured rows does not prove that no repair happened in the build.
//
// 🔴 CORRECTED 2026-09-25 — THE PARAGRAPH THAT STOOD HERE WAS THE BUG, IN WRITING. It said the
// module "inherits rather than invents" the recorder's definition of a heal, and then counted
// `autoResolved === true` — which is NOT the recorder's definition. `counts.autoResolved` also requires
// `severity !== 'info'`, no observation, no narration and no workaround code, because every heartbeat,
// tool call and narration line is recorded `info, autoResolved: true` so that it never counts as an
// UNRESOLVED defect. The first scorecard this shipped on printed "TOOL_DONE ×10313, TOOL_CALL ×10171,
// AGENT_STEP ×6903 … 44324 repair(s) named" beside "3.36 repairs per build" — a factor of fifty, and
// the `unattributed` check below clamped to zero on every build, so the truncation it exists to
// declare was invisible. The definition is now `isSelfHeal` in `src/lib/healIssue.ts`, the ONE
// predicate the recorder, this breakdown and `firstPassQuality.topHealCodes` all call.

import { isSelfHeal, isLeftOpen, interpretRepairCount, type HealReportLike, type HealCountInterpretation } from '../../lib/healIssue';

/** At most this many distinct codes per build, so one odd build cannot bloat a listing row. */
export const MAX_CODES_PER_BUILD = 25;

export interface HealCodeTally {
  /** code → heals of that code VISIBLE in the stored timeline. */
  codes: Record<string, number>;
  /** Usable repair total, or null when missing or historical semantics are unverified. */
  total: number | null;
  /** Independent producer, compatibility and timeline evidence. */
  interpretation?: HealCountInterpretation;
  /**
   * Recorded repairs not attributable to visible rows (total − seen), or null when `total` is unknown.
   * ZERO and NULL are different answers and must stay that way: zero means no numeric attribution deficit,
   * null means nobody can say.
   */
  unattributed: number | null;
  /**
   * code → non-blocking findings still open when the build ended (2026-09-30). Kept apart from
   * `codes` on purpose: they repaired nothing, and folding them in is what made READINESS_WARNING the
   * "most-repaired" code. Absent on a tally written before the split.
   */
  open?: Record<string, number>;
}

/**
 * The heal codes of ONE build. `null` when the report carries neither a timeline nor a count — a row
 * that was never measured, which the aggregate must EXCLUDE rather than score as a clean build.
 *
 * PURE. Never throws: a malformed issue is skipped, not fatal, because an observability field may
 * never take down the listing that carries it.
 */
export function summarizeHealCodes(report: HealReportLike | null | undefined): HealCodeTally | null {
  const issues = Array.isArray(report?.issues) ? report!.issues! : null;
  const interpretation = interpretRepairCount(report);
  const total = interpretation.total;
  if (!issues && interpretation.compatibilityCount === null) return null;

  const codes: Record<string, number> = {};
  const open: Record<string, number> = {};
  let seen = 0;
  for (const issue of issues ?? []) {
    if (isLeftOpen(issue)) {
      const code = String(issue.code);
      if (open[code] !== undefined || Object.keys(open).length < MAX_CODES_PER_BUILD) open[code] = (open[code] ?? 0) + 1;
      continue;
    }
    // The recorder's own definition, not the flag: an info row marked autoResolved is the build
    // happening (a tool call, a heartbeat), never a repair.
    if (!isSelfHeal(issue)) continue;
    seen += 1;
    const code = typeof issue.code === 'string' && issue.code.trim() ? issue.code.trim() : 'UNCODED';
    // Past the cap, keep COUNTING (so `unattributed` stays honest) and stop naming.
    if (codes[code] === undefined && Object.keys(codes).length >= MAX_CODES_PER_BUILD) continue;
    codes[code] = (codes[code] ?? 0) + 1;
  }

  return {
    codes,
    total,
    interpretation,
    // Never negative: a timeline can legitimately carry MORE autoResolved rows than `counts` recorded
    // (a count written before a late pass appended to the timeline), and a negative shortfall would
    // subtract from another build's real one in the aggregate.
    unattributed: total === null ? null : Math.max(0, total - seen),
    // Only when there is something to say, so a build with nothing left open keeps its old shape.
    ...(Object.keys(open).length > 0 ? { open } : {}),
  };
}
