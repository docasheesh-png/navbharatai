// AgentV3 — pre-flight BUILD-COST ESTIMATE for paid public v5.0 (admin plan 2026-07-06).
//
// Purpose: BEFORE a build starts, turn a user's prompt into an estimated billed cost (USD and INR), so
// the paid-public gate (Affordability.decideAffordability) can compare it against the wallet balance and
// decide proceed / economy / block. This module is the "estimate" input to that decision — nothing else.
//
// Design guarantees:
//   • PURE + deterministic. Same prompt + same power/rate → same number. No I/O, no clock, no randomness.
//   • It reuses the SINGLE sources of truth already in the repo — never a private cost formula:
//       – complexity (module/feature counts) from `complexityFromPrompt` (lib/BuildTimeEstimator), the
//         same signal the build-time ETA uses, so the estimate tracks the same notion of "how big".
//       – the billed price from `billedAmountUsd` / `billedAmountInr` (pricing.ts), the EXACT function
//         that charges the user after a real build — so the estimate is in the same unit as the charge.
//   • HONEST about being an estimate: token counts here are a conservative pre-build projection, not a
//     measurement. The real charge is always settled on ACTUAL usage after the build (see Affordability's
//     graceful-overdraft: a small estimate miss just nudges the balance, it never stops a running build).
//
// Dormant until the paid-public route wiring (a later PR) reads it behind `AGENTV3_PAID_PUBLIC`. Adding
// this module changes NO runtime behavior on its own.

import { complexityFromPrompt } from '../lib/BuildTimeEstimator';
import { billedAmountUsd, billedAmountInr, type BilledUsage, type BillingPowerLevel } from './pricing';

/** Projected token usage for a build of a given size. `input` includes prompt+context+tool round-trips. */
export interface EstimatedUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Base token cost of a build before any modules/features — the fixed overhead of the tool loop itself
 * (system prompt, project context, planning turns, readiness/gate passes). Deliberately non-trivial so a
 * tiny prompt still carries its true minimum cost rather than estimating ~₹0.
 */
const BASE_INPUT_TOKENS = 20_000;
const BASE_OUTPUT_TOKENS = 8_000;
/** Marginal token cost per detected module (a screen/route/service) and per feature (a capability). */
const PER_MODULE_INPUT = 8_000;
const PER_MODULE_OUTPUT = 4_000;
const PER_FEATURE_INPUT = 1_000;
const PER_FEATURE_OUTPUT = 1_500;

/**
 * Project token usage from complexity counts. Pure. Conservative-by-design: it errs slightly HIGH (base
 * overhead + per-unit costs) so the pre-flight estimate rarely under-charges the wallet check — an
 * over-estimate at worst routes a borderline build to the economy engine; an under-estimate would let a
 * build start that the balance can't cover. Negative/NaN counts clamp to 0.
 */
export function estimateBuildTokens(moduleCount: number, featureCount: number): EstimatedUsage {
  const m = Number.isFinite(moduleCount) ? Math.max(0, moduleCount) : 0;
  const f = Number.isFinite(featureCount) ? Math.max(0, featureCount) : 0;
  return {
    inputTokens: BASE_INPUT_TOKENS + m * PER_MODULE_INPUT + f * PER_FEATURE_INPUT,
    outputTokens: BASE_OUTPUT_TOKENS + m * PER_MODULE_OUTPUT + f * PER_FEATURE_OUTPUT,
  };
}

/** Full pre-flight estimate for one build, in both currencies plus the projected usage it was priced on. */
export interface PreflightEstimate {
  usage: EstimatedUsage;
  usd: number;
  inr: number;
}

/**
 * Estimate the billed cost of building `prompt` at a given power level, for a given USD→INR rate.
 * `power` is the SAME billing power the real charge uses (false/'off' → cheap tier; any level → opus tier),
 * so an "Only Opus" build is estimated on the opus tier, matching what it will actually cost. Pure.
 */
export function estimateBuildCost(
  prompt: string,
  power: BillingPowerLevel | boolean,
  usdInrRate: number,
): PreflightEstimate {
  const { moduleCount, featureCount } = complexityFromPrompt(prompt || '');
  const usage: BilledUsage = estimateBuildTokens(moduleCount, featureCount);
  return {
    usage,
    usd: billedAmountUsd(usage, power),
    inr: billedAmountInr(usage, power, usdInrRate),
  };
}

/**
 * 🔴 AN EDIT OF A BIG PROJECT IS NOT PRICED BY ITS PROMPT'S WORDS (failedbr #2437, fe73bca3; admin 2026-11-19: "edit/update se
 * pahle estimate kharcha napa jaye; user ke wallet me paise kam hon to build shuru hi na ho"). "Fix this error and continue
 * building the app: network error" names no screen and no feature, so `estimateBuildCost` gave it the minimum — while an
 * edit of a 37-file app reads the whole project into every turn and cost many times that, until the wallet stopped it
 * mid-build. The evidence that exists is this workspace's own recent builds: their real tokens, priced with the SAME
 * `billedAmountInr` the prompt estimate uses (no new rate, no new markup). The median of the last few — one huge build is
 * not the rule. `null` when there is no history. PURE.
 */
export function historyEstimateInr(
  entries: ReadonlyArray<{ tokenUsage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number } }> | null | undefined,
  power: BillingPowerLevel | boolean,
  usdInrRate: number,
  max = 5,
): number | null {
  const priced = (entries ?? [])
    .map((e) => e?.tokenUsage)
    .filter((u): u is { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number } => !!u && (u.inputTokens + u.outputTokens) > 0)
    .slice(0, max)
    // Cache-served input is priced at its own (cheaper) rate, exactly as the real bill prices it.
    .map((u) => billedAmountInr({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, ...(u.cacheReadInputTokens ? { cacheReadInputTokens: u.cacheReadInputTokens } : {}) }, power, usdInrRate))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (priced.length === 0) return null;
  const mid = Math.floor(priced.length / 2);
  return priced.length % 2 ? priced[mid] : (priced[mid - 1] + priced[mid]) / 2;
}
