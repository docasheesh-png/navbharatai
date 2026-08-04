// AgentV3 — FAST-LANE BUDGET ALLOCATION (admin report 2026-08-02, buildId 858f6d7b).
//
// ROOT CAUSE it closes. The Simple Builder runs three phases inside ONE 240s budget: plan the file
// manifest, design the shared contract, then generate the files tier by tier. The first two phases were
// each capped at 90s independently — so by construction the preamble could consume 180s of 240s and
// leave 60s to actually write the app. Nothing enforced that the phase which produces the FILES got a
// usable share of its own budget.
//
// On the reported build that is exactly what happened: plan 89s (one second under its cap) + contract
// 70s = 159s spent before the first file was written, leaving 81s for 14 files. Only tier 0 (4 files)
// finished before the lane was killed. Its work was salvaged and thrown at the full builder, which
// restarted the slow path — a to-do app took 591s end to end.
//
// Two independent defects, two decisions here:
//
//   1. THE PREAMBLE COULD EAT THE BUILD PHASE. `preambleCapMs` derives each preamble call's cap from
//      what the overall budget can still afford, instead of a fixed 90s that is only safe in isolation.
//      A slow plan now shrinks the contract's cap rather than compounding with it.
//
//   2. THE LANE GROUND ON AFTER IT WAS ARITHMETICALLY DOOMED. Files generate in dependency TIERS, and a
//      tier costs as much as its slowest file, so once one tier's real duration is known the remaining
//      cost is predictable. `canFinishRemainingTiers` uses that MEASURED duration to bail out the moment
//      the maths says the lane cannot finish — handing off immediately instead of burning the rest of
//      the budget to produce a partial result the full builder discards anyway.
//
// Both are PURE and unit-tested; the timing and the LLM calls stay in SimpleBuilder.

/**
 * The fraction of the overall fast-lane budget reserved for GENERATING FILES. The preamble (plan +
 * contract) shares what is left. 0.6 is the smallest reserve that fits the reported build's real
 * numbers: a 3-tier app at ~45s per tier needs ~135s, which 60% of a 240s budget covers with margin.
 */
export const BUILD_PHASE_RESERVE = 0.6;

/**
 * The cap for the next preamble call: never more than its configured cap, and never more than the
 * preamble's remaining share of the overall budget.
 *
 * Returns 0 when the preamble's share is already spent — the caller treats that as "skip this phase",
 * which is safe because the contract is best-effort by design (an empty contract degrades per-file
 * agreement, it does not break the build) and is strictly better than starving file generation.
 */
export function preambleCapMs(overallMs: number, elapsedMs: number, configuredCapMs: number): number {
  const preambleShare = Math.max(0, overallMs * (1 - BUILD_PHASE_RESERVE));
  const remaining = Math.max(0, preambleShare - Math.max(0, elapsedMs));
  return Math.max(0, Math.min(configuredCapMs, remaining));
}

export interface TierProgress {
  /** Dependency tiers still to generate after the one just measured. */
  tiersRemaining: number;
  /** How long the tier that just completed actually took — the real, measured cost of one tier. */
  lastTierMs: number;
  /** Total time spent in the lane so far. */
  elapsedMs: number;
  /** The lane's whole budget. */
  overallMs: number;
}

/**
 * TRUE when the remaining tiers can still plausibly finish inside the budget.
 *
 * The projection is deliberately simple and measured rather than modelled: the next tiers are assumed
 * to cost about what the last one did. That is the honest read on a lane whose per-call latency is
 * dominated by one provider's speed, and it means the decision improves automatically on a fast tier
 * instead of encoding a guess about any particular model.
 *
 * Bailing early is not giving up — the caller salvages the finished files and hands off to the full
 * builder, which is exactly what would have happened at the timeout anyway, only ~40s sooner and
 * without a tier being killed mid-flight.
 */
export function canFinishRemainingTiers(p: TierProgress): boolean {
  if (p.tiersRemaining <= 0) return true;
  // No usable measurement (a tier that returned instantly, e.g. every file cached or skipped) — never
  // bail on an absent signal. Guessing "too slow" from no evidence would abandon healthy builds.
  if (!(p.lastTierMs > 0)) return true;
  const projectedMs = p.tiersRemaining * p.lastTierMs;
  return p.elapsedMs + projectedMs <= p.overallMs;
}

/** The honest, provider-anonymous reason recorded when the lane bails early (White-Label Law). */
export function earlyBailReason(p: TierProgress): string {
  const projectedS = Math.round((p.elapsedMs + p.tiersRemaining * p.lastTierMs) / 1000);
  const budgetS = Math.round(p.overallMs / 1000);
  return `fast lane stopped early — ${p.tiersRemaining} stage(s) left would need about ${projectedS}s against a ${budgetS}s budget`;
}
