// WHERE THE FAST LANE'S MINUTES WENT — a measurement, and only a measurement.
//
// 🔴 WHY IT EXISTS BEFORE ANY FIX (autopsy `21b431e1`, 2026-09-22). The fast lane spent ~8.5 minutes,
// ran three repair rounds, died on ONE `TS2554`, handed off, and the architect rebuilt the app. It
// was the single most expensive item in that report — and nothing anywhere could say which PHASE the
// time was in. Two plausible cures were on the table:
//
//   (a) hand off the moment the first verify blames many files, instead of spending three rounds;
//   (b) send the repair only the offending file rather than the whole set.
//
// Choosing between them from the evidence available would have been a guess, and the fourth absolute
// rule forbids fixing from a guess. So the number comes first. **Nothing in the engine reads this —
// it decides nothing, changes no routing, and costs no model call.**
//
// ⚠️ `verifyRuns` / `repairRuns` are COUNTS, not durations, on purpose: a lane that compiled three
// times is a different problem from one that sat inside a single slow compile, and a millisecond
// total cannot tell them apart. Pure.

export interface FastLanePhases {
  planMs: number;
  contractMs: number;
  generateMs: number;
  verifyMs: number;
  repairMs: number;
  verifyRuns: number;
  repairRuns: number;
  totalMs: number;
}

const sec = (ms: number): string => `${Math.round(Math.max(0, ms) / 100) / 10}s`;

/** Whole percent of the lane's own clock, or '' when the total is not yet meaningful. Pure. */
function share(ms: number, totalMs: number): string {
  if (!(totalMs > 0)) return '';
  const pct = Math.round((Math.max(0, ms) / totalMs) * 100);
  return ` (${pct}%)`;
}

/**
 * The admin-only report line. Names every phase and the share of the lane's clock it took.
 *
 * ⚠️ THE UNACCOUNTED REMAINDER IS PRINTED RATHER THAN HIDDEN. Writing files, the deterministic import
 * and scaffold passes, and the lane's own bookkeeping are not timed here; if they were silently
 * folded into another phase the first reader would draw a conclusion about the wrong one. A ledger
 * that does not add up must SAY it does not add up. Pure.
 */
export function fastLanePhaseSummary(p: FastLanePhases | undefined): string {
  if (!p) return 'Fast lane: it never started, so there are no phase timings.';
  const measured = p.planMs + p.contractMs + p.generateMs + p.verifyMs + p.repairMs;
  const other = Math.max(0, p.totalMs - measured);
  const parts = [
    `plan ${sec(p.planMs)}${share(p.planMs, p.totalMs)}`,
    p.contractMs > 0 ? `contract ${sec(p.contractMs)}${share(p.contractMs, p.totalMs)}` : '',
    `generate ${sec(p.generateMs)}${share(p.generateMs, p.totalMs)}`,
    `verify ${sec(p.verifyMs)}${share(p.verifyMs, p.totalMs)} over ${p.verifyRuns} run(s)`,
    `repair ${sec(p.repairMs)}${share(p.repairMs, p.totalMs)} over ${p.repairRuns} round(s)`,
    other > 0 ? `everything else ${sec(other)}${share(other, p.totalMs)}` : '',
  ].filter(Boolean);
  return `Fast lane took ${sec(p.totalMs)}: ${parts.join(', ')}.`;
}

/**
 * The one phase that took most of the lane's clock, for the report's `detail` — so a scan of many
 * reports can be grouped without re-reading every sentence. Pure.
 */
export function dominantFastLanePhase(p: FastLanePhases | undefined): string {
  if (!p || !(p.totalMs > 0)) return 'unknown';
  const measured = p.planMs + p.contractMs + p.generateMs + p.verifyMs + p.repairMs;
  const rows: Array<[string, number]> = [
    ['plan', p.planMs], ['contract', p.contractMs], ['generate', p.generateMs],
    ['verify', p.verifyMs], ['repair', p.repairMs], ['other', Math.max(0, p.totalMs - measured)],
  ];
  rows.sort((a, b) => b[1] - a[1]);
  return `${rows[0][0]} ${sec(rows[0][1])} of ${sec(p.totalMs)}`;
}
