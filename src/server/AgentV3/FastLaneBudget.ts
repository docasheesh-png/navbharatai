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

/**
 * TRUE when the lane can still finish its files AFTER paying for the shared-contract pass.
 *
 * 🔴 ROOT CAUSE (autopsy c6e4c6ff, 2026-09-18 — "E commerce website"). `preambleCapMs` bounds the
 * contract by the PREAMBLE'S SHARE and never asks the only question that decides whether the lane
 * survives: is there still room for the TIERS once it is paid for? On that build there was not, and
 * the arithmetic is stark because every number in it was already known:
 *
 *     plan call            49s      (measured, a real call on this build's chain)
 *     3 populated tiers  ~147s      (projected at the plan's latency, as canFinishAfterPreamble does)
 *     after the plan      49 + 147 = 196s  of 240s   → the lane could finish
 *     contract cap         47s      (what the preamble share still allowed)
 *     after the contract  96 + 147 = 243s  of 240s   → DOOMED
 *
 * So `canFinishAfterPreamble` — which runs after the contract — correctly bailed, and the lane handed
 * off having produced nothing. **The best-effort pass is what caused the bail that then discarded it.**
 * The app was built by the full builder instead, and that build took 26.7 minutes.
 *
 * 🔑 THE CONTRACT IS ALREADY OPTIONAL AND THIS FILE ALREADY SAYS SO — `preambleCapMs` returns 0 to mean
 * "skip this phase", with the reasoning that "an empty contract degrades per-file agreement, it does
 * not break the build" while "a starved build phase produces no app at all". That is exactly the trade
 * here; it was simply never applied to the tier projection. Skipping one optional pass is strictly
 * better than bailing the whole lane.
 *
 * ⚠️ The contract's expected cost is the PLAN's measured duration, not its cap — same philosophy as
 * both siblings above (project from a real measurement, so the decision improves automatically on a
 * fast provider). Bounded by the cap, because the call cannot outlive it.
 */
export function canAffordSharedContract(p: PreambleProgress & { contractCapMs: number }): boolean {
  if (p.contractCapMs <= 0) return false;        // already skipped by the share — nothing to decide
  if (p.tiers <= 0) return true;
  if (!(p.preambleCallMs > 0)) return true;      // no measurement — never bail on an absent signal
  const expectedContractMs = Math.min(p.contractCapMs, p.preambleCallMs);
  return canFinishAfterPreamble({ ...p, elapsedMs: p.elapsedMs + expectedContractMs });
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
  /**
   * The MEASURED duration of the shared-contract call, when one ran — including a call that was cut
   * off by its cap, which counts as "at least this long".
   *
   * 🔴 WHY THIS EXISTS (autopsy 31dc61fd, 2026-09-20). The projection below used the PLAN call alone
   * and was 1.8× optimistic, so the lane started a file phase it could not finish:
   *
   *     plan call        34s   ← the only sample the check used
   *     contract call   ~61s   ← ran to its cap and was killed; IGNORED
   *     real tier cost  ~62.5s ← what a file-writing stage actually took
   *
   * A plan call emits a short FILE LIST; a tier writes whole files. Output tokens dominate latency, so
   * the plan systematically under-measures a tier — and the contract call, which also produces a long
   * body, predicts it almost exactly. The check had that better sample in hand and threw it away,
   * projecting from the cheapest measurement instead of the most representative one.
   *
   * Optional: a lane that skipped the contract has nothing to add and keeps the plan-only projection.
   */
  contractCallMs?: number;
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
  const projectedMs = p.tiers * tierEstimateMs(p);
  return Math.max(0, p.elapsedMs) + projectedMs <= p.overallMs;
}

/**
 * What one file-writing tier is expected to cost, from the best measurement the lane actually has.
 *
 * THE SLOWEST REAL SAMPLE, not the cheapest. Both preamble calls ran on the same provider chain, so
 * both are evidence — and the one that produces a long body (the contract) is the closer analogue of a
 * tier. Taking the max is also the only direction that is safe to be wrong in: over-estimating costs a
 * handoff that was going to happen anyway, while under-estimating starts a phase that cannot finish and
 * burns the whole budget to discover it.
 *
 * An absent or unusable contract measurement falls back to the plan alone — today's behaviour exactly.
 */
export function tierEstimateMs(p: PreambleProgress): number {
  const contract = p.contractCallMs;
  const usable = typeof contract === 'number' && Number.isFinite(contract) && contract > 0 ? contract : 0;
  return Math.max(p.preambleCallMs, usable);
}

/** The honest, provider-anonymous reason recorded when the lane bails before generating any file. */
export function preambleBailReason(p: PreambleProgress): string {
  const perTierMs = tierEstimateMs(p);
  const projectedS = Math.round((Math.max(0, p.elapsedMs) + p.tiers * perTierMs) / 1000);
  const budgetS = Math.round(p.overallMs / 1000);
  const callS = Math.round(perTierMs / 1000);
  // Name WHICH measurement the projection came from. "Planning alone took 34s" was a true sentence
  // about the wrong sample, and a reader chasing a bad bail needs to know which call was believed.
  const source = perTierMs > p.preambleCallMs ? 'designing the shared contract took' : 'planning alone took';
  return `fast lane stopped before writing files — ${source} ${callS}s, so ${p.tiers} stage(s) would need about ${projectedS}s against a ${budgetS}s budget`;
}

/** The honest, provider-anonymous reason recorded when the lane bails early (White-Label Law). */
export function earlyBailReason(p: TierProgress): string {
  const projectedS = Math.round((p.elapsedMs + p.tiersRemaining * p.lastTierMs) / 1000);
  const budgetS = Math.round(p.overallMs / 1000);
  return `fast lane stopped early — ${p.tiersRemaining} stage(s) left would need about ${projectedS}s against a ${budgetS}s budget`;
}

// ─── Q-926 (autopsy db07e0af, admin 2026-10-13: "han, apka suggestion ke anusar banao") ──────────────────────────
//
// 🔴 THE HAND-OFF MOVED THE WHOLE BUILD ONTO THE RUNG IT WAS RUNNING FROM. A todo app on Weak: the lane's opener
// (GLM flash) crawled on one file call, the chain's next rung (kimi) reasons before every answer, and the lane
// stopped in front of it and handed three files to the full builder — which then built the rest of the app on that
// SAME reasoning engine, one sequential step at a time: 68 s before its first write, nine calls of 10–25 s, the
// first render at 248 s. The lane would have paid the reasoning price once per file, eight files at a time.
//
// The stop exists for a real reason (autopsy Study-Racer: one per-file call on that rung took 123 s, and the lane
// handed off anyway with 3 of 13 files; autopsy 33812996: a repair call spent 497 s there). So the lane stays only
// when what is LEFT is small and its own budget can carry it at a pessimistic per-wave price; the measured early
// bail (`canFinishRemainingTiers`) still hands off the moment a real tier proves slower. Plan, contract and repair
// calls still stop in front of the rung. Every stay is measured in the report (FAST_LANE_STAYED_ON_REASONING_RUNG),
// so the next builds decide whether this stays on.

/** `AGENTV3_FASTLANE_REASONING_STAY=off` restores the hand-off at the first reasoning rung exactly. */
export function reasoningStayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_FASTLANE_REASONING_STAY ?? '').trim().toLowerCase() !== 'off';
}

/**
 * More files than this left to write and the lane hands off as before. The proposal to the admin said 12; the
 * very todo app that raised Q-926 planned 17 (four waves ≈ 180 s, inside a 240 s lane), so 12 would have left the
 * case it was approved for exactly as it was. The real guard is the time check below; this bounds the class.
 */
export const REASONING_STAY_MAX_FILES = 20;

/**
 * The price assumed for one wave of per-file calls on a rung that reasons before every answer. Measured in
 * db07e0af: 10–25 s per call for files of up to 4 KB; 45 s leaves room for a slow one without assuming the
 * Study-Racer outlier (123 s), which the measured early bail exists to catch.
 */
export const REASONING_WAVE_MS = 45_000;

export interface ReasoningStayInput {
  /** Files the lane still has to generate (this tier and every later one). */
  remainingFiles: number;
  /** Waves those files need at the lane's concurrency, tier by tier. */
  remainingWaves: number;
  elapsedMs: number;
  overallMs: number;
}

/** May this tier's per-file calls continue onto a reasoning rung instead of handing off? PURE. */
export function mayStayOnReasoningRung(p: ReasoningStayInput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!reasoningStayEnabled(env)) return false;
  if (!(p.remainingFiles > 0) || p.remainingFiles > REASONING_STAY_MAX_FILES) return false;
  return p.elapsedMs + Math.max(1, p.remainingWaves) * REASONING_WAVE_MS <= p.overallMs;
}

/** The waves `sizes` (files per remaining tier) need at `concurrency`. PURE. */
export function wavesFor(sizes: readonly number[], concurrency: number): number {
  const c = Math.max(1, Math.floor(concurrency) || 1);
  return sizes.reduce((n, s) => n + (s > 0 ? Math.ceil(s / c) : 0), 0);
}

/**
 * The report line for the stays this lane made — the measurement the admin asked for before the change is kept.
 * '' when the lane never stayed. PURE.
 */
export function reasoningStayNote(calls: ReadonlyArray<{ model: string; ms: number }>, outcome: string): string {
  if (calls.length === 0) return '';
  const ms = calls.map((c) => c.ms).sort((a, b) => a - b);
  const median = ms[Math.floor((ms.length - 1) / 2)];
  const models = [...new Set(calls.map((c) => c.model))].join(', ');
  return `The fast lane stayed on ${models}, which reasons before every answer, instead of handing off (Q-926): `
    + `${calls.length} file call(s), median ${Math.round(median / 1000)}s, slowest ${Math.round(ms[ms.length - 1] / 1000)}s. ${outcome}`;
}

/** How the lane ended, in the words the stay line closes with. PURE. */
export function laneOutcomeWords(sb: { ok: boolean; stopped?: boolean; reason?: string | null; salvagedPaths?: readonly string[] }): string {
  if (sb.ok) return 'The lane finished the app itself.';
  if (sb.stopped) return 'The lane was stopped by the user.';
  return `The lane still handed off (${sb.reason || 'no reason recorded'}), with ${sb.salvagedPaths?.length ?? 0} finished file(s).`;
}

/**
 * The route's one call after the lane: record the stays, if any, as an engine fact. Here rather than inline because
 * the route handler sits at TypeScript's control-flow-analysis limit (TS2563) — every branch added there costs it.
 */
export function recordReasoningStays(
  report: { record(issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): void },
  calls: ReadonlyArray<{ model: string; ms: number }>,
  sb: Parameters<typeof laneOutcomeWords>[0],
): void {
  if (calls.length === 0) return;
  report.record({ phase: 'build', severity: 'info', code: 'FAST_LANE_STAYED_ON_REASONING_RUNG', message: reasoningStayNote(calls, laneOutcomeWords(sb)), autoResolved: true });
}
