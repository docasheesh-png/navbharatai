// AgentV3 pricing — multi-model billing (admin model, updated 2026-07-05).
//
// The user NEVER sees which provider actually answered. Billing is by the ACTUAL model TIER that did
// the work, always priced against Claude rates:
//   • CHEAP tier (Haiku / GLM / Grok / Gemini / Vertex — anything below Sonnet) → Sonnet-equivalent × 1.2
//   • SONNET (Sonnet actually ran)                                             → Sonnet-equivalent × 3
//   • OPUS   (power mode — Opus 4.8 runs 100%)                                 → REAL Opus cost    × 2
//
// The effort selector (mini/medium/max) only changes how many real tokens Opus spends → the bill scales
// naturally; the multiplier stays 2× at EVERY power level. Margin is structurally positive in every tier
// (billed ≥ real cost). Rates are env-overridable so ops can track live Anthropic prices without a deploy.
//
// Mode → tier mapping (admin tier→model redefinition 2026-07-13): billedAmountUsd() maps
// weak/off → CHEAP, 'mini' (Strong, pins Sonnet 100%) → SONNET (× 3), and 'medium'/'max'
// (the real Opus tiers) → OPUS (× 2). Billing always follows the model the tier pins.

/** CHEAP/normal-tier markup: Sonnet-equivalent cost × 1.2 (Haiku/GLM/Grok/Gemini/Vertex work). */
export const NORMAL_MULTIPLIER = 1.2;
/** SONNET-tier markup: Sonnet-equivalent cost × 3 (when Sonnet actually did the work). */
export const SONNET_MULTIPLIER = 3;
/** OPUS/power-tier markup: REAL Opus 4.8 cost × 2 — flat at EVERY power level (mini/medium/max). */
export const OPUS_MULTIPLIER = 2;
/** @deprecated Back-compat alias — power billing is now a flat OPUS_MULTIPLIER (× 2) at every level. */
export const POWER_MULTIPLIER = OPUS_MULTIPLIER;

/** The model tier that actually did the work — the axis billing is charged on. */
export type BillingTier = 'cheap' | 'sonnet' | 'opus';

/** A power level for billing. 'weak' and 'off' both bill at the cheap tier (× 1.2). */
export type BillingPowerLevel = 'weak' | 'off' | 'mini' | 'medium' | 'max';

function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface TokenRate {
  inputPerMTok: number;
  outputPerMTok: number;
  /** USD per 1M CACHE-HIT input tokens (providers price a prefix-cache hit far below a fresh input
   *  token — Moonshot/Z.ai ≈ 25% of the input rate). OPTIONAL and margin-safe by construction: when
   *  absent, cache-read tokens are priced at the FULL inputPerMTok (i.e. no discount), so an unknown
   *  provider can never be under-billed. Only the Fix-66 real-cost path reads this field. */
  cacheReadPerMTok?: number;
  /** USD per 1M CACHE-WRITE input tokens — Anthropic bills writing a prompt-cache entry at 1.25× input
   *  (Q-343). OPTIONAL and margin-safe the same way: absent ⇒ priced at the full inputPerMTok. */
  cacheWritePerMTok?: number;
}

/**
 * Anthropic's prompt-cache prices, as multiples of the input rate: a cache READ is 0.1× and a cache WRITE
 * is 1.25× (Q-343, admin 2026-10-11: price Claude's cache tokens at their real cost). Applied to every
 * Claude rate below, so one place says what Anthropic charges.
 */
export const CLAUDE_CACHE_READ_FACTOR = 0.1;
export const CLAUDE_CACHE_WRITE_FACTOR = 1.25;

/** A Claude rate with its prompt-cache lines derived from the input rate. */
export function withClaudeCacheLines(inputPerMTok: number, outputPerMTok: number): TokenRate {
  return {
    inputPerMTok,
    outputPerMTok,
    // divided rather than multiplied, so $3 reads as $0.30 and not 0.30000000000000004
    cacheReadPerMTok: inputPerMTok / (1 / CLAUDE_CACHE_READ_FACTOR),
    cacheWritePerMTok: inputPerMTok * CLAUDE_CACHE_WRITE_FACTOR,
  };
}

/**
 * Claude Opus token rates, USD per 1,000,000 tokens. Override via env.
 *
 * 🔴 Q-880 (billing audit 2026-10-12). The default was $15 / $75 — Opus 4 / 4.1's price. The Opus this
 * code calls is `claude-opus-4-8` (`models.ts`), and Anthropic's price for it, verified on
 * claude.com/pricing on 2026-10-12, is $5 input / $25 output (cache read $0.50, 5-minute cache write
 * $6.25 — the lines `withClaudeCacheLines` derives). Opus 4.7 is the same price. A provider cost three
 * times too high was then marked up, so a Strong build that reached its Opus rung was billed on it.
 * `tests/claudeRatesMatchVerifiedPrices.test.ts` holds the verified table and fails when a default
 * Claude model id has no verified price, or when this number drifts from it.
 */
export function opusRate(): TokenRate {
  return withClaudeCacheLines(envRate('OPUS_INPUT_PER_MTOK', 5), envRate('OPUS_OUTPUT_PER_MTOK', 25));
}

/** Claude Sonnet token rates, USD per 1,000,000 tokens. Override via env. */
export function sonnetRate(): TokenRate {
  return withClaudeCacheLines(envRate('SONNET_INPUT_PER_MTOK', 3), envRate('SONNET_OUTPUT_PER_MTOK', 15));
}

/**
 * Tokens to bill. `inputTokens` is the TOTAL input, and the two cache counts are SHARES of it — never
 * additional. That is the one meaning every provider adapter now reports (Q-343: Claude's raw
 * `input_tokens` excludes its cache, so `ClaudeClient.parseMessage` adds the cache back in).
 */
export interface BilledUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * THE ONE TOKEN-COST FORMULA (Q-343). Both the per-tier bill (`costUsd` below) and the real-cost bill
 * (`usageCostUsd` in providerRates.ts) price through this, so they cannot drift apart. The cache shares
 * are clamped to the input they belong to (a provider never cache-serves more than it received), and a
 * rate without a cache line prices that share at the full input rate — identical to the old formula.
 */
export function tokenCostUsd(usage: BilledUsage, rate: TokenRate): number {
  const input = Math.max(0, usage.inputTokens || 0);
  const read = Math.min(input, Math.max(0, usage.cacheReadInputTokens ?? 0));
  const write = Math.min(input - read, Math.max(0, usage.cacheCreationInputTokens ?? 0));
  return (
    ((input - read - write) / 1_000_000) * rate.inputPerMTok +
    (read / 1_000_000) * (rate.cacheReadPerMTok ?? rate.inputPerMTok) +
    (write / 1_000_000) * (rate.cacheWritePerMTok ?? rate.inputPerMTok) +
    (Math.max(0, usage.outputTokens || 0) / 1_000_000) * rate.outputPerMTok
  );
}

function costUsd(usage: BilledUsage, rate: TokenRate): number {
  return tokenCostUsd(usage, rate);
}

/** Real Opus 4.8 cost (USD) for the usage — the POWER-mode billing base. */
export function opusEquivalentUsd(usage: BilledUsage): number {
  return costUsd(usage, opusRate());
}

/** Sonnet-equivalent cost (USD) for the usage — the NORMAL-mode billing base. */
export function sonnetEquivalentUsd(usage: BilledUsage): number {
  return costUsd(usage, sonnetRate());
}

/**
 * The USD amount to bill for work done by a KNOWN model tier (the admin billing model, 2026-07-05):
 * - 'cheap'  (Haiku/GLM/Grok/Gemini/Vertex) → Sonnet-equivalent cost × 1.2
 * - 'sonnet' (Sonnet actually ran)          → Sonnet-equivalent cost × 3
 * - 'opus'   (power mode, real Opus 4.8)    → real Opus cost × 2
 */
export function billedForTier(usage: BilledUsage, tier: BillingTier): number {
  if (tier === 'opus') return opusEquivalentUsd(usage) * OPUS_MULTIPLIER;
  return sonnetEquivalentUsd(usage) * (tier === 'sonnet' ? SONNET_MULTIPLIER : NORMAL_MULTIPLIER);
}

/**
 * The USD amount to bill the user, keyed by the request's power LEVEL (what the engine currently
 * reports). Admin tier→model redefinition (2026-07-13) — billing follows the model the tier actually
 * PINS, never a different model's rates:
 *   'weak'/'off'/false → CHEAP tier (Sonnet-equivalent × 1.2 — normal builds run on cheap-floor models)
 *   'mini' (Strong)    → SONNET tier (Sonnet-equivalent × 3 — Strong pins Sonnet 100%, so charging the
 *                        old "real Opus × 2" would bill Opus rates for Sonnet work: dishonest + ~3×
 *                        overcharge on input tokens)
 *   'medium'/'max'/true → OPUS tier (real Opus × 2, flat — effort only changes real tokens spent)
 */
export function powerToTier(power: BillingPowerLevel | boolean): BillingTier {
  return (power === false || power === 'off' || power === 'weak') ? 'cheap'
    : power === 'mini' ? 'sonnet'
    : 'opus';
}

export function billedAmountUsd(usage: BilledUsage, power: BillingPowerLevel | boolean = false): number {
  return billedForTier(usage, powerToTier(power));
}

/**
 * The INR amount to bill the user = billedAmountUsd × the (real-time) USD→INR rate.
 * The rate is passed in (resolved from UsdInrRate) so this stays pure/testable.
 */
export function billedAmountInr(
  usage: BilledUsage,
  power: BillingPowerLevel | boolean,
  usdInrRate: number,
): number {
  return billedAmountUsd(usage, power) * Math.max(0, usdInrRate);
}

/** The per-tier markup that billedForTier applies. Single source shared with explainBuildCost (rule 4). */
export function tierMultiplier(tier: BillingTier): number {
  return tier === 'opus' ? OPUS_MULTIPLIER : tier === 'sonnet' ? SONNET_MULTIPLIER : NORMAL_MULTIPLIER;
}

const TIER_LABEL: Record<BillingTier, string> = { cheap: 'Cheap', sonnet: 'Sonnet', opus: 'Opus' };

/** T1-cost-transparency — the full, honest breakdown behind a build's ₹ charge. */
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  tier: BillingTier;
  /** Human tier label ("Cheap" / "Sonnet" / "Opus"). */
  tierLabel: string;
  /** What the base cost is measured against ("Sonnet-equivalent" / "real Opus"). */
  baseModel: string;
  /** The pre-markup base cost (USD). */
  baseUsd: number;
  /** The per-tier markup multiplier (×1.2 / ×3 / ×2). */
  multiplier: number;
  billedUsd: number;
  billedInr: number;
  usdInrRate: number;
}

/**
 * Explain WHY a build costs what it does: the input/output token split, the tier that ran, the base
 * (Sonnet-equivalent or real-Opus) cost, the markup applied, and the final USD + INR. Uses the SAME
 * tier mapping + multiplier as billedAmountUsd/billedForTier, so the breakdown can never diverge from
 * the amount actually charged (its billedUsd equals billedAmountUsd(usage, power)). Pure.
 */
export function explainBuildCost(
  usage: BilledUsage,
  power: BillingPowerLevel | boolean,
  usdInrRate: number,
): CostBreakdown {
  const tier = powerToTier(power);
  const baseUsd = tier === 'opus' ? opusEquivalentUsd(usage) : sonnetEquivalentUsd(usage);
  const multiplier = tierMultiplier(tier);
  const billedUsd = baseUsd * multiplier; // ≡ billedForTier(usage, tier)
  const rate = Math.max(0, usdInrRate);
  return {
    inputTokens: Math.max(0, usage.inputTokens),
    outputTokens: Math.max(0, usage.outputTokens),
    tier,
    tierLabel: TIER_LABEL[tier],
    baseModel: tier === 'opus' ? 'real Opus' : 'Sonnet-equivalent',
    baseUsd,
    multiplier,
    billedUsd,
    billedInr: billedUsd * rate,
    usdInrRate: rate,
  };
}
