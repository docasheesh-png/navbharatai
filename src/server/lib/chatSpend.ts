import { isGatewayFreePricingProof } from '../AI/InferenceGateway/pricingEvidence';
import type { AIProviderResponse } from '../AI/Router/ProviderTypes';
import { isVerifiedFreeProof } from '../AI/LiveRegistry/proof';
import type { FreeTextResult } from '../AI/LiveRegistry/dispatcher';
// What one AI turn OUTSIDE the v5 builder actually costs — and what it should be billed at.
//
// THE GAP THIS CLOSES. The wallet only ever moved for v5 builds. The 70+ professionals, Doctor AI and
// the Other-AI tools were bounded by a daily MESSAGE COUNT and nothing else, so their real cost to
// NavBharatAI was invisible: ten cheap questions and ten expensive ones counted the same, and no
// surface anywhere could answer "what does Professional AI cost us?".
//
// It reuses the build billing rather than inventing a second money model: the same per-model rate card
// (providerRates.ts) prices the exact model that answered, and the same tiered markup turns that into
// the ₹ figure. One rate card, one markup curve, one wallet — a GLM-flash answer is genuinely free
// here exactly as it is in a build, and nothing has to be kept in sync by hand.
//
// HONESTY (rules 2 and 3). A provider that reports no token usage yields `measured: false` and a cost
// of zero — NOT a guess. Estimating tokens from string length would produce a number that LOOKS like a
// measurement and would end up on a user's bill; an honest "not measured" costs us a little margin and
// keeps every ₹ we do charge real. The same rule the build path already follows for a failed build:
// when we cannot prove the cost, the user is not charged for it.
//
// Pure — no I/O, no clock. The caller supplies what the provider reported.

import { realRateFor, usageCostUsd, tieredMarkupUsd } from '../AgentV3/providerRates';

export interface ChatTurnUsage {
  /** Provider name as the router reports it (GLM, VERTEX, GEMINI, GROK, ANTHROPIC …). */
  provider?: string;
  /** The exact model id that answered — this is what makes flash free and a flagship expensive. */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  pricingProof?: FreeTextResult['pricingProof'];
  inferenceGateway?: AIProviderResponse['inferenceGateway'];
  gatewayPricingProof?: AIProviderResponse['gatewayPricingProof'];
}

export interface ChatTurnCost {
  /** Gateway liability lives in its separate ledger; unknown is never an invoice cost. */
  costBasis?: 'verified-free' | 'unpriced-gateway';
  tokensMeasured?: boolean;
  /** Some gateway turns have no exact cost; known legacy amounts remain additive. */
  costIncomplete?: boolean;
  /** True when usage has a usable cost basis. Unpriced gateway usage keeps tokens but no money. */
  measured: boolean;
  /** What the turn really cost NavBharatAI, in USD. ADMIN-ONLY — never shown to a user. */
  realUsd: number;
  /** What the user should be billed, in USD, after the same tiered markup builds use. */
  billedUsd: number;
  /** The same amount in ₹, at the supplied USD→INR rate. */
  billedInr: number;
  inputTokens: number;
  outputTokens: number;
}

const ZERO: ChatTurnCost = {
  measured: false, realUsd: 0, billedUsd: 0, billedInr: 0, inputTokens: 0, outputTokens: 0,
};

const clean = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Price one chat/tool turn.
 *
 * A turn with no reported usage, or with zero tokens on both sides, is `measured: false` at zero cost.
 * Note that a MEASURED turn can still legitimately cost ₹0 — GLM-4.7-Flash is genuinely free — and the
 * two cases are kept distinct on purpose: "free because the model is free" and "unknown because the
 * provider told us nothing" mean very different things to an admin reading the numbers.
 */
export function chatTurnCost(usage: ChatTurnUsage | null | undefined, usdInr: number): ChatTurnCost {
  if (!usage) return ZERO;
  const inputTokens = clean(usage.inputTokens);
  const outputTokens = clean(usage.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return ZERO;

  if (isGatewayFreePricingProof(usage.gatewayPricingProof, { provider: usage.provider, model: usage.model,
    logicalRequestId: usage.inferenceGateway?.logicalRequestId, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } })) {
    return { ...ZERO, measured: true, inputTokens, outputTokens, costBasis: 'verified-free', tokensMeasured: true };
  }
  if (usage.inferenceGateway !== undefined || usage.gatewayPricingProof !== undefined) {
    // A conservative reservation/ceiling is not actual invoice spend. Preserve tokens,
    // exclude this turn from legacy tariff guesses and leave reconciliation to its ledger.
    return { ...ZERO, inputTokens, outputTokens, costBasis: 'unpriced-gateway', tokensMeasured: true, costIncomplete: true };
  }
  if (usage.provider === 'OPENROUTER' && isVerifiedFreeProof(usage.pricingProof, usage.model)
    && typeof usage.pricingProof.inputTokens === 'number' && Number.isFinite(usage.pricingProof.inputTokens)
    && typeof usage.pricingProof.outputTokens === 'number' && Number.isFinite(usage.pricingProof.outputTokens)
    && inputTokens <= usage.pricingProof.inputTokens && outputTokens <= usage.pricingProof.outputTokens) {
    return { ...ZERO, measured: true, inputTokens, outputTokens };
  }
  // An unverified OpenRouter ID must not inherit a direct provider's promotional zero rate.
  const rate = realRateFor(String(usage.provider ?? ''), usage.provider === 'OPENROUTER' ? undefined : usage.model ? String(usage.model) : undefined);
  const realUsd = usageCostUsd({ inputTokens, outputTokens }, rate);
  const billedUsd = tieredMarkupUsd(realUsd);
  const rupees = Number.isFinite(usdInr) && usdInr > 0 ? usdInr : 0;
  return {
    measured: true,
    realUsd,
    billedUsd,
    billedInr: Math.round(billedUsd * rupees * 100) / 100,
    inputTokens,
    outputTokens,
  };
}

/**
 * Add up several turns of one request — a tool that makes three model calls should bill once, for all
 * three.
 *
 * THE MARKUP IS APPLIED ONCE, TO THE TOTAL — and that is the whole point of this function (defect found
 * in the pre-launch audit, 2026-08-07). The old version summed each turn's ALREADY-MARKED-UP `billedUsd`,
 * which is not the same number, because `tieredMarkupUsd` is a CONCAVE curve: the first $1 of real cost
 * is charged at 4× and everything above it at 3×. Marking up each call separately gives every call its
 * own cheap-rate first dollar, so the threshold is granted N times instead of once:
 *
 *     three calls of $0.50   per-call markup then sum → $6.00
 *                            markup of the $1.50 total → $5.50   ← the real price
 *
 * The error is always in the same direction — the user is OVERCHARGED — and it grows with the number of
 * calls, so the App Debugger (which fans out over batches of files, a dozen calls per action) was the
 * worst case. `aiTurnCharge.ts` documented the correct behaviour in its own comment while the code did
 * the opposite; both now agree.
 *
 * `measured` is true when ANY turn was measured, so a partially-reported request still bills for the
 * part we can prove rather than being written off entirely.
 */
export function sumChatTurnCosts(costs: ChatTurnCost[], usdInr: number): ChatTurnCost {
  const list = (costs || []).filter(Boolean);
  if (!list.length) return ZERO;

  let measured = false;
  let realUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const c of list) {
    measured = measured || !!c.measured;
    realUsd += Number(c.realUsd) || 0;
    inputTokens += Number(c.inputTokens) || 0;
    outputTokens += Number(c.outputTokens) || 0;
  }
  if (!measured) return list.some(c => c.costBasis === 'unpriced-gateway')
    ? { ...ZERO, inputTokens, outputTokens, tokensMeasured: true, costBasis: 'unpriced-gateway', costIncomplete: true } : ZERO;

  const billedUsd = tieredMarkupUsd(realUsd);
  const rupees = Number.isFinite(usdInr) && usdInr > 0 ? usdInr : 0;
  return {
    measured: true,
    ...(list.some(c => c.costBasis === 'unpriced-gateway' || c.costIncomplete)
      ? { costIncomplete: true, costBasis: 'unpriced-gateway' as const, tokensMeasured: true } : {}),
    realUsd,
    billedUsd,
    billedInr: Math.round(billedUsd * rupees * 100) / 100,
    inputTokens,
    outputTokens,
  };
}
