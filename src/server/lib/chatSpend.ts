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
}

export interface ChatTurnCost {
  /** True only when the provider actually reported tokens. False ⇒ every figure below is 0. */
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

  const rate = realRateFor(String(usage.provider ?? ''), usage.model ? String(usage.model) : undefined);
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
 * three. `measured` is true when ANY turn was measured, so a partially-reported request still bills
 * for the part we can prove rather than being written off entirely.
 */
export function sumChatTurnCosts(costs: ChatTurnCost[]): ChatTurnCost {
  const list = (costs || []).filter(Boolean);
  if (!list.length) return ZERO;
  const total = list.reduce(
    (a, c) => ({
      measured: a.measured || !!c.measured,
      realUsd: a.realUsd + (Number(c.realUsd) || 0),
      billedUsd: a.billedUsd + (Number(c.billedUsd) || 0),
      billedInr: a.billedInr + (Number(c.billedInr) || 0),
      inputTokens: a.inputTokens + (Number(c.inputTokens) || 0),
      outputTokens: a.outputTokens + (Number(c.outputTokens) || 0),
    }),
    { ...ZERO },
  );
  return { ...total, billedInr: Math.round(total.billedInr * 100) / 100 };
}
