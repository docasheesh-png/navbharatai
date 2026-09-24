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
// So the tally is cross-checked against `counts.autoResolved`, which is the number the scorecard
// already calls a heal and which the storage cap does not touch. The difference is reported as
// `unattributed` — heals we KNOW happened and cannot name — never silently dropped, and never
// presented as if the visible codes were the whole story. That check is stronger than reading
// `truncation.channels.issues`, because it compares what we can see against the real total directly
// and still works on a legacy report written before that field existed.
//
// ⚠️ WHAT `autoResolved` REALLY MEANS, said plainly rather than assumed. The scorecard's heal count
// IS `counts.autoResolved`, a definition this module inherits rather than invents — and that flag
// marks more than repairs: `importTurnObservation` sets it to keep a sub-agent's finding out of OUR
// unresolved tally. So the breakdown may well show that part of the 6.49 was never a repair at all.
// That is not a defect in this module; it is the first thing the breakdown is FOR, and pre-filtering
// the codes to the ones that look like repairs would hide exactly that answer.

/** A stored report, read structurally — this module never imports the recorder. */
interface ReportLike {
  issues?: Array<{ code?: unknown; autoResolved?: unknown }> | null;
  counts?: { autoResolved?: unknown } | null;
}

/** At most this many distinct codes per build, so one odd build cannot bloat a listing row. */
export const MAX_CODES_PER_BUILD = 25;

export interface HealCodeTally {
  /** code → heals of that code VISIBLE in the stored timeline. */
  codes: Record<string, number>;
  /** The build's authoritative heal count, or null when the report never recorded one. */
  total: number | null;
  /**
   * Heals that happened and could not be named (total − seen), or null when `total` is unknown.
   * ZERO and NULL are different answers and must stay that way: zero means the list is complete,
   * null means nobody can say.
   */
  unattributed: number | null;
}

/**
 * The heal codes of ONE build. `null` when the report carries neither a timeline nor a count — a row
 * that was never measured, which the aggregate must EXCLUDE rather than score as a clean build.
 *
 * PURE. Never throws: a malformed issue is skipped, not fatal, because an observability field may
 * never take down the listing that carries it.
 */
export function summarizeHealCodes(report: ReportLike | null | undefined): HealCodeTally | null {
  const issues = Array.isArray(report?.issues) ? report!.issues! : null;
  const rawTotal = report?.counts?.autoResolved;
  const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
    ? Math.floor(rawTotal)
    : null;
  if (!issues && total === null) return null;

  const codes: Record<string, number> = {};
  let seen = 0;
  for (const issue of issues ?? []) {
    if (!issue || issue.autoResolved !== true) continue;
    seen += 1;
    const code = typeof issue.code === 'string' && issue.code.trim() ? issue.code.trim() : 'UNCODED';
    // Past the cap, keep COUNTING (so `unattributed` stays honest) and stop naming.
    if (codes[code] === undefined && Object.keys(codes).length >= MAX_CODES_PER_BUILD) continue;
    codes[code] = (codes[code] ?? 0) + 1;
  }

  return {
    codes,
    total,
    // Never negative: a timeline can legitimately carry MORE autoResolved rows than `counts` recorded
    // (a count written before a late pass appended to the timeline), and a negative shortfall would
    // subtract from another build's real one in the aggregate.
    unattributed: total === null ? null : Math.max(0, total - seen),
  };
}
