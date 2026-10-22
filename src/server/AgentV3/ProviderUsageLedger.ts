import { isVerifiedFreeProof, type VerifiedFreeProof } from '../AI/LiveRegistry/proof';
// Billing Phase 3 — per-provider token attribution for one v5.0 build (admin plan 2026-07-10).
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

import { addUnbilled } from './unbilledTurns';
import {
  billedForTier,
  sonnetEquivalentUsd,
  type BilledUsage,
  type BillingTier,
  type BillingPowerLevel,
} from './pricing';

export interface ProviderTokens {
  pricingProof?: VerifiedFreeProof;
  inputTokens: number;
  outputTokens: number;
  /** Fix 66 — the share of inputTokens the provider served from its prefix cache (already INCLUDED in
   *  inputTokens, never additional). Optional and purely additive: legacy paths (per-tier billing,
   *  Sonnet-baseline) ignore it; only the real-cost path prices it at the cheaper cache-read rate. */
  cacheReadInputTokens?: number;
  /** Q-343 — the share of inputTokens WRITTEN to a prompt cache (Anthropic bills it at 1.25× input).
   *  Already INCLUDED in inputTokens, never additional; priced by `tokenCostUsd` at settle. */
  cacheCreationInputTokens?: number;
}

/** A per-(provider, model) attributed slice — feeds the REAL-cost billing (providerRates.ts). */
export interface ProviderModelEntry {
  pricingProof?: VerifiedFreeProof;
  provider: string;
  /** The actual model id that answered (TurnResult.model), when the runner reported it. */
  model?: string;
  usage: ProviderTokens;
  /**
   * The SUBSET of `usage` that came from turns which produced nothing a caller could use — no text,
   * no tool call (see `turnStarvedItsBudget`). Optional and purely additive: `byProvider()`,
   * `total()` and `realProviderCostUsd()` all keep seeing the FULL figures, because this is money we
   * really spent. Only the code that builds the USER's bill subtracts it — see unbilledTurns.ts for
   * why both halves of that are load-bearing.
   */
  unbilled?: ProviderTokens & { discardedOutputTokens?: number };
  /**
   * WHICH PART OF THE BUILD spent this slice — 'post-build-review', etc. (see `billingPhase.ts`).
   *
   * Optional, and absent for every turn made outside a phase, which is most of them. Slices are keyed
   * by provider + model + phase, so a phase SPLITS an entry rather than relabelling it; every
   * consumer sums (`realProviderCostUsd`, `ledgerCostUsd` and `priceProviderUsage` all aggregate), so
   * more rows change no total. Without this dimension the ledger knows which VENDOR was paid and
   * never what FOR, and "leave that barren pass out of the bill" has nowhere to be written down.
   */
  phase?: string;
}

/** What a caller can say about ONE turn beyond its tokens. Both optional; omitting the object is
 *  byte-for-byte the behaviour before either existed. */
export interface AddTurnOptions {
  /** The turn produced no text and no tool call — see `unbilledTurns.ts`. */
  producedNothing?: boolean;
  /** Which part of the build made the call — see `billingPhase.ts`. */
  phase?: string;
  /**
   * The turn ended at the output limit and its cut-off part was THROWN AWAY (Q-166, admin 2026-10-11:
   * "output that is discarded as truncated is not billed"). Its output is recorded in the slice's
   * `unbilled` subset; its input stays billed, because the prompt was really read.
   */
  discardedOutput?: boolean;
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
  /**
   * Attribute one successful turn's tokens to the provider that answered (and, when the runner
   * reports it, the exact model). Non-finite/negative token counts are ignored. `model` is optional
   * and purely additive — omitting it keeps the byProvider()/total() behavior identical to before.
   *
   * `opts.producedNothing` marks a turn that carried nothing a caller could use (no text, no tool
   * call). Its tokens are still added IN FULL — we paid for them — and ALSO recorded in this slice's
   * `unbilled` subset, which is the only thing the user's bill subtracts.
   *
   * `opts.phase` says which part of the build made the call, so a whole pass can later be judged to
   * have delivered nothing (see `billingPhase.ts`). Omitting `opts` is byte-for-byte today's behaviour.
   */
  add(provider: string, usage: ProviderTokens, model?: string, opts?: AddTurnOptions): void;
  /**
   * Say AFTER the fact that a call's output was thrown away (Q-166). For a lane that learns it only once
   * a later step has looked at the reply — the fast lane drops a half-written file after its last
   * continuation, a planner throws away a plan it could not read. The tokens were already added by
   * `add`; this records `outputTokens` in the same slice's `unbilled` subset and nothing else.
   */
  discardOutput(provider: string, model: string | undefined, outputTokens: number, opts?: { phase?: string }): void;
  /** Per-provider token totals, keyed by the provider label. */
  byProvider(): Record<string, ProviderTokens>;
  /**
   * Per-(provider, model) attributed slices — the exact granularity REAL-cost billing prices on
   * (a GLM turn on glm-4.7-flash is free; on glm-5.2 it is the flagship rate). Turns added without a
   * model id collapse to a single model-less slice per provider.
   */
  entries(): ProviderModelEntry[];
  /** The ledger's grand total across all providers (to reconcile against the billing sink). */
  total(): ProviderTokens;
  /**
   * How many model calls each provider answered — one per `add` (Q-164). The token slices merge calls by
   * provider + model + phase, so the call count cannot be read back from them; it is counted here.
   */
  callsByProvider?(): Record<string, number>;
}

/** The one key of a slice — provider + model + phase, NUL-separated (a byte none of the three can hold).
 *  `add` and `discardOutput` both build it here, so a discarded share always lands in the slice that
 *  holds the tokens (Q-166). */
function sliceKey(provider: string, model: string | undefined, phase: string | undefined): string {
  return `${provider}\0${model ?? ''}\0${phase ?? ''}`;
}

export function createProviderUsageLedger(): ProviderUsageLedger {
  const buckets = new Map<string, ProviderTokens>();
  const calls = new Map<string, number>();
  let receiptSequence = 0;
  // Model-granular slices, keyed `${provider} ${model}` so provider+model are exact and can't
  // collide with a provider label that happens to contain the separator.
  const modelBuckets = new Map<string, ProviderModelEntry>();
  // Fix 66 — accumulate the cache-hit share (already included in inputTokens; priced cheaper at settle).
  const addCache = (cur: ProviderTokens, u: ProviderTokens): void => {
    const c = u.cacheReadInputTokens ?? 0;
    if (Number.isFinite(c) && c > 0) cur.cacheReadInputTokens = (cur.cacheReadInputTokens ?? 0) + c;
    const w = u.cacheCreationInputTokens ?? 0;
    if (Number.isFinite(w) && w > 0) cur.cacheCreationInputTokens = (cur.cacheCreationInputTokens ?? 0) + w;
  };
  const addTo = (key: string, u: ProviderTokens): void => {
    const cur = buckets.get(key) ?? { inputTokens: 0, outputTokens: 0 };
    if (Number.isFinite(u.inputTokens) && u.inputTokens > 0) cur.inputTokens += u.inputTokens;
    if (Number.isFinite(u.outputTokens) && u.outputTokens > 0) cur.outputTokens += u.outputTokens;
    addCache(cur, u);
    buckets.set(key, cur);
  };
  const addModel = (provider: string, model: string | undefined, u: ProviderTokens, opts?: AddTurnOptions): void => {
    const phase = opts?.phase && opts.phase.trim() ? opts.phase.trim() : undefined;
    // provider + model + PHASE, still NUL-separated — the separator is a byte that can appear in
    // none of the three, which is what makes the key exact. A phase SPLITS a slice rather than
    // relabelling it, and every consumer of `entries()` sums, so more rows change no total.
    // Each verified dispatch receipt stays in its own slice. Never merge verified-free and
    // unverified/paid tokens, even when the provider/model/phase labels happen to match.
    const proof = provider === 'OPENROUTER' && isVerifiedFreeProof(u.pricingProof, model) ? u.pricingProof : undefined;
    const key = sliceKey(provider, model, phase) + (proof ? `\0receipt:${++receiptSequence}` : '');
    const cur = modelBuckets.get(key)
      ?? { provider, model, ...(proof ? { pricingProof: proof } : {}), ...(phase ? { phase } : {}), usage: { inputTokens: 0, outputTokens: 0 } };
    if (Number.isFinite(u.inputTokens) && u.inputTokens > 0) cur.usage.inputTokens += u.inputTokens;
    if (Number.isFinite(u.outputTokens) && u.outputTokens > 0) cur.usage.outputTokens += u.outputTokens;
    addCache(cur.usage, u);
    // A barren turn's tokens are recorded TWICE on purpose: in `usage` (what we really paid) and in
    // `unbilled` (the part the user is not charged for). Never instead of — see unbilledTurns.ts.
    if (opts?.producedNothing) {
      const unbilled = cur.unbilled ?? { inputTokens: 0, outputTokens: 0 };
      addUnbilled(unbilled, u);
      cur.unbilled = unbilled;
    } else if (opts?.discardedOutput) {
      // Q-166 — only the OUTPUT of a cut-off reply that was thrown away; the prompt was really read.
      const out = Number.isFinite(u.outputTokens) && u.outputTokens > 0 ? u.outputTokens : 0;
      if (out > 0) {
        const unbilled = cur.unbilled ?? { inputTokens: 0, outputTokens: 0 };
        addUnbilled(unbilled, { inputTokens: 0, outputTokens: out, discardedOutputTokens: out });
        cur.unbilled = unbilled;
      }
    }
    modelBuckets.set(key, cur);
  };
  return {
    add(provider, usage, model, opts) {
      const key = provider && provider.trim() ? provider : UNATTRIBUTED_PROVIDER;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      addTo(key, usage);
      addModel(key, model && model.trim() ? model : undefined, usage, opts);
    },
    discardOutput(provider, model, outputTokens, opts) {
      const out = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
      if (out === 0) return;
      // The same key `add` used, so the discarded share lands in the slice that holds the tokens.
      const p = provider && provider.trim() ? provider : UNATTRIBUTED_PROVIDER;
      const m = model && model.trim() ? model : undefined;
      const phase = opts?.phase && opts.phase.trim() ? opts.phase.trim() : undefined;
      const key = sliceKey(p, m, phase);
      const cur = modelBuckets.get(key);
      // Proof-carrying turns stay split. Attribute a later discard to the most recent
      // matching receipts, bounded by their remaining output; never invent a new slice.
      if (!cur) {
        let remaining = out;
        for (const [receiptKey, receipt] of [...modelBuckets.entries()].reverse()) {
          if (!receiptKey.startsWith(`${key}\0receipt:`)) continue;
          const available = Math.max(0, receipt.usage.outputTokens - (receipt.unbilled?.outputTokens ?? 0));
          const discarded = Math.min(remaining, available);
          if (discarded <= 0) continue;
          const unbilled = receipt.unbilled ?? { inputTokens: 0, outputTokens: 0 };
          addUnbilled(unbilled, { inputTokens: 0, outputTokens: discarded, discardedOutputTokens: discarded });
          receipt.unbilled = unbilled;
          remaining -= discarded;
          if (remaining <= 0) break;
        }
        return;
      }
      const unbilled = cur.unbilled ?? { inputTokens: 0, outputTokens: 0 };
      addUnbilled(unbilled, { inputTokens: 0, outputTokens: out, discardedOutputTokens: out });
      cur.unbilled = unbilled;
    },
    callsByProvider() {
      return Object.fromEntries(calls);
    },
    byProvider() {
      const out: Record<string, ProviderTokens> = {};
      for (const [k, v] of buckets) out[k] = { ...v };
      return out;
    },
    entries() {
      return [...modelBuckets.values()].map((e) => ({
        provider: e.provider,
        model: e.model,
        ...(e.pricingProof ? { pricingProof: e.pricingProof } : {}),
        ...(e.phase ? { phase: e.phase } : {}),
        usage: { ...e.usage },
        ...(e.unbilled ? { unbilled: { ...e.unbilled } } : {}),
      }));
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

/**
 * Per-(provider, MODEL) tokens for the cost telemetry, keyed `PROVIDER|model`.
 *
 * WHY THE MODEL AND NOT JUST THE PROVIDER: one vendor holds several rungs at wildly different
 * prices, so the provider alone cannot say what a build cost. On Weak/Normal 'GLM' is both
 * `glm-4.7-flashx` ($0.07/MTok in) and `glm-5.3` ($1.40) — a 20x spread under one key — and 'KIMI'
 * is both `kimi-k2.7-code` ($0.95) and `kimi-k3` ($3.00). The admin usage report priced every one of
 * them at Sonnet's $3.00/$15.00 until 2026-09-23 and called the result a margin.
 *
 * Slices are keyed by provider + model + PHASE in the ledger, so several entries routinely share one
 * (provider, model) pair; they are SUMMED here rather than overwriting each other.
 *
 * ⚠️ REPORTS THE FULL FIGURES, including `unbilled` turns — the same rule `realProviderCostUsd`
 * follows, and for the same reason: a turn that produced nothing still cost us money, and this view
 * exists to say what we SPENT, never what we charged. A model the runner never named is stored with
 * an empty model half rather than being folded into a real rung's row.
 *
 * PURE — no I/O.
 */
export function modelUsageFromEntries(
  entries: ProviderModelEntry[],
): Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }> {
  const out: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }> = {};
  for (const e of entries) {
    const key = `${e.provider}|${e.model ?? ''}`;
    const slot = out[key] ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
    slot.inputTokens += Number.isFinite(e.usage?.inputTokens) ? e.usage.inputTokens : 0;
    slot.outputTokens += Number.isFinite(e.usage?.outputTokens) ? e.usage.outputTokens : 0;
    slot.cacheReadInputTokens = (slot.cacheReadInputTokens ?? 0)
      + (Number.isFinite(e.usage?.cacheReadInputTokens) ? (e.usage.cacheReadInputTokens as number) : 0);
    // Q-343 — the cache-WRITE share, present only on rows that wrote a cache, so older rows read as before.
    const w = e.usage?.cacheCreationInputTokens;
    if (Number.isFinite(w) && (w as number) > 0) slot.cacheCreationInputTokens = (slot.cacheCreationInputTokens ?? 0) + (w as number);
    out[key] = slot;
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
