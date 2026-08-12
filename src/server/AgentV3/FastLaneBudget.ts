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

export interface PreambleProgress {
  /** The MEASURED duration of the plan call — one real model call, on this build's real provider chain. */
  preambleCallMs: number;
  /** How many dependency tiers the file-generation phase will run. */
  tiers: number;
  /** Time spent in the lane so far (plan + contract). */
  elapsedMs: number;
  /** The lane's whole budget. */
  overallMs: number;
}

/**
 * TRUE when file generation can still plausibly finish, judged BEFORE the first file is generated.
 *
 * ROOT CAUSE (admin report 2026-08-12, the dukaan stock app). `canFinishRemainingTiers` above only runs
 * BETWEEN tiers — it needs a completed tier to measure. So it protects against a lane that starts well
 * and slows down, and not at all against the case where the FIRST tier never completes. That second
 * case is not exotic; it is what a failing provider looks like, and it is what happened:
 *
 *     SIMPLE_BUILD_FALLBACK   detail: "simple-build timed out after 240000ms"
 *     PROVIDER_FALLBACK ×8    "Provider KIMI failed"  detail: "Request timed out."
 *     PROVIDER_FALLBACK ×4    "Provider GLM failed"   detail: "429 … temporarily overloaded"
 *
 * The lane sat for its entire 240 seconds and produced nothing, because no tier ever finished for the
 * between-tiers check to fire on. And it was knowable long before that: the PLAN call — a real model
 * call, on the same provider chain, already completed — had taken **86.6 seconds**. Three tiers at that
 * latency need ~260s, and the lane had ~144s left. It was arithmetically doomed with 8 files still
 * unwritten and 144 seconds still to burn.
 *
 * Same philosophy as its sibling: project from a REAL measurement rather than a model of one, so the
 * decision improves automatically on a fast provider instead of encoding a guess about any particular
 * one. A tier runs its files in parallel, so a tier costs about one call — which is what the plan call
 * measures.
 *
 * Bailing here hands off IMMEDIATELY to the full builder — the same handoff that was going to happen at
 * the timeout, only ~2.5 minutes sooner. Nothing is lost: no file had been generated yet, so there was
 * never anything to salvage.
 */
export function canFinishAfterPreamble(p: PreambleProgress): boolean {
  if (p.tiers <= 0) return true;
  // NEVER bail on an absent signal — the same rule as canFinishRemainingTiers. Without a real measured
  // call duration we know nothing, and guessing "too slow" from no evidence abandons healthy builds.
  if (!(p.preambleCallMs > 0) || !Number.isFinite(p.preambleCallMs)) return true;
  if (!(p.overallMs > 0) || !Number.isFinite(p.overallMs)) return true;
  const projectedMs = p.tiers * p.preambleCallMs;
  return Math.max(0, p.elapsedMs) + projectedMs <= p.overallMs;
}

/** The honest, provider-anonymous reason recorded when the lane bails before generating any file. */
export function preambleBailReason(p: PreambleProgress): string {
  const projectedS = Math.round((Math.max(0, p.elapsedMs) + p.tiers * p.preambleCallMs) / 1000);
  const budgetS = Math.round(p.overallMs / 1000);
  const callS = Math.round(p.preambleCallMs / 1000);
  return `fast lane stopped before writing files — planning alone took ${callS}s, so ${p.tiers} stage(s) would need about ${projectedS}s against a ${budgetS}s budget`;
}

/** The honest, provider-anonymous reason recorded when the lane bails early (White-Label Law). */
export function earlyBailReason(p: TierProgress): string {
  const projectedS = Math.round((p.elapsedMs + p.tiersRemaining * p.lastTierMs) / 1000);
  const budgetS = Math.round(p.overallMs / 1000);
  return `fast lane stopped early — ${p.tiersRemaining} stage(s) left would need about ${projectedS}s against a ${budgetS}s budget`;
}
