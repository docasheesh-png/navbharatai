// Billing Phase 3 — per-provider token attribution for one v3.0 build (admin plan 2026-07-10).
//
// WHY: the build-level UsageSink (billing accounting fix, #1174) knows the GRAND TOTAL of tokens a
// build spent, but not WHICH provider spent them. That total is all Phase-1 billing needs, but two
// things want the split:
//   1. The admin usage-report (per-provider tokens, real-cost baseline, revenue, achieved margin) —
//      the visibility layer the admin's billing spec asked for.
//   2. Per-tier billing (a FLAG-OFF, future-facing option): once the cheap floor (GLM/KIMI) carries
//      real builds, a mixed build (GLM builds + Sonnet reviews/edits) should bill the Sonnet share at
//      the Sonnet multiplier (×3), not the whole build at the cheap multiplier (×1.2). Today the
//      SONNET tier is never reached because power-level→tier maps off→cheap; this ledger is the
//      per-model token accounting `pricing.ts` explicitly said that fix is waiting on.
//
// HOW: the MultiProviderTurnRunner calls `onTurnComplete(provider, usage)` on every successful turn.
// That callback feeds this ledger. It is purely OBSERVATIONAL — it never changes which provider runs
// or (with the flag off) how much the user is billed. The billing sink is untouched.
//
// HONESTY (rule 5): the ledger only sees turns that flow through a MultiProviderTurnRunner wired with
// the callback — the architect + its sub-agents (they share one client) + the escalation runner. It
// does NOT see auxiliary raw calls (blueprint/plan/judge) that use their own runners. So the caller
// reconciles: `unattributed = buildSinkTotal − ledgerTotal` is bucketed under 'other', and per-tier
// billing charges that remainder at the build's default tier so nothing is ever UNDER-billed.

import {
  billedForTier,
  sonnetEquivalentUsd,
  type BilledUsage,
  type BillingTier,
  type BillingPowerLevel,
} from './pricing';

export interface ProviderTokens {
  inputTokens: number;
  outputTokens: number;
}

/** The bucket key used for tokens we cannot attribute to a specific provider (aux calls, etc.). */
export const UNATTRIBUTED_PROVIDER = 'other';

/**
 * Map a build-chain provider label (as reported by MultiProviderTurnRunner: 'GLM' | 'KIMI' |
 * 'CLAUDE' | 'CLAUDE_HAIKU' | 'VERTEX' | 'GEMINI' | 'other') to the BILLING tier its work is priced
 * on. Everything below Sonnet is the CHEAP tier; the plain 'CLAUDE' runner is the only one that can
 * be running Sonnet/Opus, so it maps to 'sonnet' as a conservative (margin-safe) default — it is the
 * one provider whose work can legitimately deserve the ×3 rate. All non-Claude cheap models, the
 * forced-Haiku backstop, and the unattributed remainder map to 'cheap'.
 *
 * NOTE: this is deliberately provider-granular, not model-granular. 'CLAUDE' running Haiku would be
 * over-tiered to 'sonnet' — but that only ever happens on the Haiku BACKSTOP, which is labelled
 * 'CLAUDE_HAIKU' (→ cheap), so the plain 'CLAUDE' label reliably means the requested Sonnet/Opus
 * model actually ran. Opus is handled by the power-level path (see perTierBilledUsd), not here.
 */
export function providerToTier(provider: string): BillingTier {
  const p = provider.toUpperCase();
  if (p === 'CLAUDE') return 'sonnet';
  return 'cheap';
}

export interface ProviderUsageLedger {
  /** Attribute one successful turn's tokens to the provider that answered. Non-finite/negative ignored. */
  add(provider: string, usage: ProviderTokens): void;
  /** Per-provider token totals, keyed by the provider label. */
  byProvider(): Record<string, ProviderTokens>;
  /** The ledger's grand total across all providers (to reconcile against the billing sink). */
  total(): ProviderTokens;
}

export function createProviderUsageLedger(): ProviderUsageLedger {
  const buckets = new Map<string, ProviderTokens>();
  const addTo = (key: string, u: ProviderTokens): void => {
    const cur = buckets.get(key) ?? { inputTokens: 0, outputTokens: 0 };
    if (Number.isFinite(u.inputTokens) && u.inputTokens > 0) cur.inputTokens += u.inputTokens;
    if (Number.isFinite(u.outputTokens) && u.outputTokens > 0) cur.outputTokens += u.outputTokens;
    buckets.set(key, cur);
  };
  return {
    add(provider, usage) {
      addTo(provider && provider.trim() ? provider : UNATTRIBUTED_PROVIDER, usage);
    },
    byProvider() {
      const out: Record<string, ProviderTokens> = {};
      for (const [k, v] of buckets) out[k] = { ...v };
      return out;
    },
    total() {
      let inputTokens = 0;
      let outputTokens = 0;
      for (const v of buckets.values()) {
        inputTokens += v.inputTokens;
        outputTokens += v.outputTokens;
      }
      return { inputTokens, outputTokens };
    },
  };
}

/**
 * Fill the gap between the billing sink's grand total and what the ledger attributed. The difference
 * (aux calls the ledger never saw) is added to the UNATTRIBUTED bucket so the per-provider view
 * reconciles exactly with the amount actually billed — never silently dropped, never double-counted.
 * A negative difference (should not happen) clamps to 0. Returns a NEW record; inputs untouched.
 */
export function reconcileWithSink(
  byProvider: Record<string, ProviderTokens>,
  sinkTotal: BilledUsage,
): Record<string, ProviderTokens> {
  let attrIn = 0;
  let attrOut = 0;
  for (const v of Object.values(byProvider)) {
    attrIn += v.inputTokens;
    attrOut += v.outputTokens;
  }
  const missingIn = Math.max(0, (sinkTotal.inputTokens || 0) - attrIn);
  const missingOut = Math.max(0, (sinkTotal.outputTokens || 0) - attrOut);
  const out: Record<string, ProviderTokens> = {};
  for (const [k, v] of Object.entries(byProvider)) out[k] = { ...v };
  if (missingIn > 0 || missingOut > 0) {
    const cur = out[UNATTRIBUTED_PROVIDER] ?? { inputTokens: 0, outputTokens: 0 };
    out[UNATTRIBUTED_PROVIDER] = {
      inputTokens: cur.inputTokens + missingIn,
      outputTokens: cur.outputTokens + missingOut,
    };
  }
  return out;
}

/**
 * PER-TIER billing (the FLAG-ON path). Sum the reconciled per-provider tokens into their billing tier
 * and price each tier at its own multiplier via billedForTier. The real OPUS tiers ('medium'/'max',
 * legacy boolean true) override everything to the Opus tier (real Opus × 2) — same as
 * billedAmountUsd's opus branch — because on those tiers Opus actually runs the whole build
 * regardless of the cheap labels. Returns the total USD to bill.
 *
 * With the flag OFF the caller uses billedAmountUsd(sinkTotal, power) instead, so this function is
 * never on the default money path; it exists so the switch is a one-line, measured change later.
 */
export function perTierBilledUsd(
  byProvider: Record<string, ProviderTokens>,
  power: BillingPowerLevel | boolean = false,
): number {
  // Admin tier→model redefinition (2026-07-13): ONLY the real Opus tiers are Opus-priced as a whole.
  // 'mini' (Strong pins Sonnet 100%) and 'weak' (GLM/Kimi, never Claude) fall through to the honest
  // per-provider split below — Sonnet work prices at Sonnet × 3, cheap work at × 1.2. This also fixes
  // the sibling bug where a WEAK build under the per-tier flag was priced at real-Opus rates.
  const isOpusTier = power === true || power === 'medium' || power === 'max';
  if (isOpusTier) {
    // Opus tiers: the whole build is Opus-priced (real Opus × 2), same as billedAmountUsd.
    const total = tierSum(Object.values(byProvider));
    return billedForTier(total, 'opus');
  }
  const cheap: ProviderTokens[] = [];
  const sonnet: ProviderTokens[] = [];
  for (const [provider, tokens] of Object.entries(byProvider)) {
    (providerToTier(provider) === 'sonnet' ? sonnet : cheap).push(tokens);
  }
  return billedForTier(tierSum(cheap), 'cheap') + billedForTier(tierSum(sonnet), 'sonnet');
}

/**
 * The per-provider REAL-COST BASELINE (USD), priced at Sonnet-equivalent rates. This is the admin
 * usage-report's cost column and margin denominator. It is an HONEST UPPER BOUND, not the exact bill
 * NavBharatAI pays: cheap providers (GLM/KIMI/Haiku/Gemini) actually cost LESS than Sonnet, so their
 * true cost is below this line — real margin is therefore AT LEAST what the report shows. When real
 * GLM/KIMI rate cards land (a later phase, matching the billing spec), the exact per-provider rate
 * replaces this baseline. Returns USD per provider.
 */
export function providerBaselineCostUsd(byProvider: Record<string, ProviderTokens>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [provider, tokens] of Object.entries(byProvider)) {
    out[provider] = sonnetEquivalentUsd(tokens);
  }
  return out;
}

function tierSum(list: ProviderTokens[]): BilledUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const t of list) {
    inputTokens += t.inputTokens;
    outputTokens += t.outputTokens;
  }
  return { inputTokens, outputTokens };
}
