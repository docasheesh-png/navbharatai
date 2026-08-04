// AgentV3 — REAL provider rate cards + tiered-markup billing (admin model, 2026-07-14).
//
// WHY THIS EXISTS: the original billing (pricing.ts) prices EVERY non-Opus build against Sonnet
// rates × a small multiplier ("Sonnet-equivalent × 1.2"). But the work is actually done by
// ultra-cheap providers (GLM/Kimi ≈ 1/20th of Sonnet), so that "×1.2 markup" was really ~21× the
// real cost on a cheap-led build — and it billed a FAILED build ₹811. The admin verified the real
// provider deductions on the GLM (Z.ai) + Kimi (Moonshot) dashboards and redefined billing:
//
//   bill = tieredMarkup( REAL provider cost )        // real cost = exact per-provider/model tokens
//                                                    //             × each provider's own rate card
//   tieredMarkup(C):  C ≤ $1  → C × 4                // small builds: 4×
//                     C  > $1 → $4 + (C − $1) × 3    // first $1 at 4×, the excess at 3× (big builds
//                                                    //   don't run away — marginal markup eases to 3×)
//
// SCOPE (admin 2026-07-14): this real-cost + tiered-markup model applies to EVERY tier where Opus
// does NOT run — Weak, Normal, Strong. The two Opus tiers (Powerful = medium, Full Team = max) keep
// the existing "real Opus × 2" model untouched (see pricing.ts / billedForTier 'opus').
//
// HONESTY (rule 5): cache-hit input tokens are NOT tracked separately (the ledger only sees
// input/output), so cached input is priced at the full cache-MISS rate → the real cost is a slight
// OVER-estimate. That is deliberately margin-safe (we can only ever over-state our own cost, never
// under-state it) and honest-conservative; a later slice can capture `cache_read` usage to bill even
// lower. Unknown models fall back to a conservative rate (Sonnet) so an untracked model never
// under-bills. All rates are USD per 1,000,000 tokens and env-overridable (track live prices without
// a deploy).

import { sonnetRate, type TokenRate, type BilledUsage } from './pricing';

function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  // 0 is a VALID rate here (GLM/Kimi flash rungs are genuinely free), so accept >= 0.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The real provider rate cards (USD per 1M tokens, input/output). Confirmed against the official
 * July-2026 price pages (Z.ai / Moonshot / Anthropic / Google) and the admin's live dashboard
 * deductions. Keyed by a normalized model-id matcher so the ACTUAL model that ran is priced (a GLM
 * turn on glm-4.7-flash is free; on glm-5.2 it is the flagship rate) — not one blended provider rate.
 */
export function realRateCard(): Record<string, TokenRate> {
  return {
    // ── GLM (Z.ai) ──────────────────────────────────────────────────────────────────────────────
    // cacheReadPerMTok (Fix 66 billing slice): both Z.ai and Moonshot price a prefix-cache HIT at
    // ≈25% of the fresh-input rate (their published cache-hit lines). Env-tunable like every rate;
    // providers WITHOUT a cache line (Gemini/Grok/Claude rows below) omit it → full input rate
    // (no discount) by construction, so nothing can be under-billed.
    'glm-flash': { inputPerMTok: envRate('RATE_GLM_FLASH_IN', 0), outputPerMTok: envRate('RATE_GLM_FLASH_OUT', 0) },
    'glm-5': { inputPerMTok: envRate('RATE_GLM5_IN', 1.4), outputPerMTok: envRate('RATE_GLM5_OUT', 4.4), cacheReadPerMTok: envRate('RATE_GLM5_CACHE', 0.35) },
    'glm': { inputPerMTok: envRate('RATE_GLM_IN', 0.6), outputPerMTok: envRate('RATE_GLM_OUT', 2.2), cacheReadPerMTok: envRate('RATE_GLM_CACHE', 0.15) }, // glm-4.x coder
    // ── Kimi (Moonshot) ─────────────────────────────────────────────────────────────────────────
    'kimi-k2.7': { inputPerMTok: envRate('RATE_KIMI27_IN', 0.95), outputPerMTok: envRate('RATE_KIMI27_OUT', 4.0), cacheReadPerMTok: envRate('RATE_KIMI27_CACHE', 0.24) },
    // kimi-k3 (admin 2026-07-28, prepended to the PAID ladder). Its published price is NOT known here,
    // so the default deliberately mirrors k2.7 — the highest Kimi rate we can actually verify — rather
    // than an invented number. ⚠️ SET `RATE_KIMI3_IN`/`_OUT`/`_CACHE` to the real published rate once
    // it is known: until then a genuinely pricier K3 is billed at the k2.7 rate, which UNDER-states our
    // real cost (margin risk, never a user over-charge). Recorded as an open item in PROGRESS.md.
    'kimi-k3': { inputPerMTok: envRate('RATE_KIMI3_IN', 0.95), outputPerMTok: envRate('RATE_KIMI3_OUT', 4.0), cacheReadPerMTok: envRate('RATE_KIMI3_CACHE', 0.24) },
    'kimi': { inputPerMTok: envRate('RATE_KIMI_IN', 0.6), outputPerMTok: envRate('RATE_KIMI_OUT', 2.5), cacheReadPerMTok: envRate('RATE_KIMI_CACHE', 0.15) }, // k2.5/k2.6
    // ── Google (Vertex / Gemini) ──────────────────────────────────────────────────────────────────
    'gemini-pro': { inputPerMTok: envRate('RATE_GEMINI_PRO_IN', 1.25), outputPerMTok: envRate('RATE_GEMINI_PRO_OUT', 10) },
    'gemini': { inputPerMTok: envRate('RATE_GEMINI_IN', 0.3), outputPerMTok: envRate('RATE_GEMINI_OUT', 2.5) }, // flash-class
    // ── xAI (Grok) ────────────────────────────────────────────────────────────────────────────────
    'grok': { inputPerMTok: envRate('RATE_GROK_IN', 3), outputPerMTok: envRate('RATE_GROK_OUT', 15) },
    // ── Anthropic (Claude) ────────────────────────────────────────────────────────────────────────
    'haiku': { inputPerMTok: envRate('RATE_HAIKU_IN', 1), outputPerMTok: envRate('RATE_HAIKU_OUT', 5) },
    'sonnet': sonnetRate(),
  };
}

/**
 * Resolve the real rate for a turn, by the ACTUAL model id when known (most exact), falling back to
 * the provider label, then to a conservative Sonnet default (never under-bill an unknown model).
 * `provider` is the ledger's normalized label ('GLM'|'KIMI'|'CLAUDE'|'CLAUDE_HAIKU'|'VERTEX'|
 * 'GEMINI'|'GROK'|'other'); `model` is TurnResult.model (may be undefined for aux calls).
 */
export function realRateFor(provider: string, model?: string): TokenRate {
  const card = realRateCard();
  const m = (model ?? '').toLowerCase();
  const p = (provider ?? '').toUpperCase();

  // Model-id first — the exact rung that ran.
  if (m) {
    if (m.includes('opus')) return { inputPerMTok: 15, outputPerMTok: 75 }; // completeness; opus tiers bill elsewhere
    if (m.includes('sonnet')) return card.sonnet;
    if (m.includes('haiku')) return card.haiku;
    // NEWER-MODEL SAFETY (autopsy 2026-07-28): these branches used to send ANY unrecognized id in the
    // family to the CHEAPEST rung — so the moment a newer flagship shipped (kimi-k3, a future glm-6) we
    // would pay flagship price and bill the k2.5/glm-4.x price, losing money on every build, silently.
    // That directly contradicted this function's own stated contract ("never under-bill an unknown
    // model"). Now: known-cheap ids are matched EXPLICITLY, and anything else in the family bills at the
    // most expensive rate we know — so an unrecognized model can only ever over-state cost, never
    // under-state it. Adding a real rate line for a new id (see 'kimi-k3') makes it exact.
    if (m.includes('glm')) {
      if (m.includes('flash')) return card['glm-flash'];
      if (/glm-?4/.test(m)) return card.glm;              // the known cheap 4.x coder
      return card['glm-5'];                                // 5.x and anything newer/unknown
    }
    if (m.includes('kimi')) {
      if (m.includes('k3')) return card['kimi-k3'];
      if (/k2[.\-]?[56]/.test(m)) return card.kimi;        // the known cheap k2.5 / k2.6
      return card['kimi-k2.7'];                            // k2.7 and anything newer/unknown
    }
    if (m.includes('gemini')) return m.includes('pro') ? card['gemini-pro'] : card.gemini;
    if (m.includes('grok')) return card.grok;
  }

  // Provider label fallback (aux calls without a model id, or unrecognized model strings).
  switch (p) {
    case 'GLM': return card.glm;
    case 'KIMI': return card.kimi;
    case 'CLAUDE_HAIKU': return card.haiku;
    case 'CLAUDE': return card.sonnet;
    case 'VERTEX':
    case 'GEMINI': return card.gemini;
    case 'GROK': return card.grok;
    default: return card.sonnet; // 'other'/unknown → conservative upper bound (never under-bill)
  }
}

/** The real USD cost of one usage bucket at a given rate. Pure; negatives clamp to 0. */
export function usageCostUsd(usage: BilledUsage & { cacheReadInputTokens?: number }, rate: TokenRate): number {
  const input = Math.max(0, usage.inputTokens);
  // Fix 66 billing slice — price the CACHE-HIT share of the input at the provider's (far cheaper)
  // cache-read rate. cacheRead is clamped to the input total (a provider can never cache-serve more
  // than it received), and when the rate card has no cache line the cache rate DEFAULTS to the full
  // input rate — i.e. exactly the old formula, so unknown providers/models keep the margin-safe price.
  const cacheRead = Math.min(input, Math.max(0, usage.cacheReadInputTokens ?? 0));
  const cacheRate = rate.cacheReadPerMTok ?? rate.inputPerMTok;
  return (
    ((input - cacheRead) / 1_000_000) * rate.inputPerMTok +
    (cacheRead / 1_000_000) * cacheRate +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputPerMTok
  );
}

/** One attributed slice of a build's token spend: which provider/model, and how many tokens. */
export interface ProviderCostEntry {
  provider: string;
  model?: string;
  usage: BilledUsage;
}

/**
 * The REAL provider cost (USD) of a build = Σ (each attributed slice's tokens × its real rate)
 * + the unattributed remainder priced conservatively at Sonnet rates. The remainder is the aux
 * calls (blueprint/plan/judge) the ledger never saw; pricing it at the highest cheap-fleet rate
 * keeps the total a safe upper bound so we never under-bill. Pure.
 */
export function realProviderCostUsd(entries: ProviderCostEntry[], remainder: BilledUsage = { inputTokens: 0, outputTokens: 0 }): number {
  let total = 0;
  for (const e of entries) total += usageCostUsd(e.usage, realRateFor(e.provider, e.model));
  total += usageCostUsd(remainder, sonnetRate()); // conservative: aux calls at Sonnet rate
  return total;
}

/** Small-build markup (real cost ≤ threshold). Admin default 4×. Env-tunable. */
export function markupSmall(): number {
  const n = Number(process.env.AGENTV3_MARKUP_SMALL);
  return Number.isFinite(n) && n > 0 ? n : 4;
}
/** Large-build marginal markup (on the real-cost portion ABOVE the threshold). Admin default 3×. */
export function markupLarge(): number {
  const n = Number(process.env.AGENTV3_MARKUP_LARGE);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
/** The real-cost threshold (USD) where the markup steps down from `markupSmall` to `markupLarge`. */
export function markupThresholdUsd(): number {
  const n = Number(process.env.AGENTV3_MARKUP_THRESHOLD_USD);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The admin's tiered markup applied to a REAL provider cost (USD):
 *   realCost ≤ threshold  → realCost × small           (default: ≤ $1 → × 4)
 *   realCost > threshold   → threshold × small + (realCost − threshold) × large
 *                            (default: first $1 × 4, the excess × 3)
 * Monotonic and continuous at the threshold. Pure; negative input clamps to 0.
 */
export function tieredMarkupUsd(realCostUsd: number): number {
  const c = Math.max(0, realCostUsd);
  const t = markupThresholdUsd();
  const small = markupSmall();
  const large = markupLarge();
  if (c <= t) return c * small;
  return t * small + (c - t) * large;
}

/**
 * The full, honest breakdown behind a real-cost + tiered-markup build charge (the transparency the
 * admin's cost card shows). billedUsd here EQUALS tieredMarkupUsd(realCostUsd), so the explanation can
 * never diverge from the amount charged. Pure.
 */
export interface RealCostBreakdown {
  realCostUsd: number;
  markupSmall: number;
  markupLarge: number;
  thresholdUsd: number;
  billedUsd: number;
  billedInr: number;
  usdInrRate: number;
  perProvider: { provider: string; costUsd: number }[];
}

export function explainRealCostBuild(
  entries: ProviderCostEntry[],
  remainder: BilledUsage,
  usdInrRate: number,
): RealCostBreakdown {
  const perProviderMap = new Map<string, number>();
  for (const e of entries) {
    const cost = usageCostUsd(e.usage, realRateFor(e.provider, e.model));
    perProviderMap.set(e.provider, (perProviderMap.get(e.provider) ?? 0) + cost);
  }
  const remCost = usageCostUsd(remainder, sonnetRate());
  if (remCost > 0) perProviderMap.set('other', (perProviderMap.get('other') ?? 0) + remCost);
  const realCostUsd = realProviderCostUsd(entries, remainder);
  const billedUsd = tieredMarkupUsd(realCostUsd);
  const rate = Math.max(0, usdInrRate);
  return {
    realCostUsd,
    markupSmall: markupSmall(),
    markupLarge: markupLarge(),
    thresholdUsd: markupThresholdUsd(),
    billedUsd,
    billedInr: billedUsd * rate,
    usdInrRate: rate,
    perProvider: [...perProviderMap.entries()].map(([provider, costUsd]) => ({ provider, costUsd })),
  };
}
