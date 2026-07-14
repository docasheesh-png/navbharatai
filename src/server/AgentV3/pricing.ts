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
}

/** Claude Opus token rates, USD per 1,000,000 tokens. Override via env. */
export function opusRate(): TokenRate {
  return {
    inputPerMTok: envRate('OPUS_INPUT_PER_MTOK', 15),
    outputPerMTok: envRate('OPUS_OUTPUT_PER_MTOK', 75),
  };
}

/** Claude Sonnet token rates, USD per 1,000,000 tokens. Override via env. */
export function sonnetRate(): TokenRate {
  return {
    inputPerMTok: envRate('SONNET_INPUT_PER_MTOK', 3),
    outputPerMTok: envRate('SONNET_OUTPUT_PER_MTOK', 15),
  };
}

export interface BilledUsage {
  inputTokens: number;
  outputTokens: number;
}

function costUsd(usage: BilledUsage, rate: TokenRate): number {
  return (
    (Math.max(0, usage.inputTokens) / 1_000_000) * rate.inputPerMTok +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputPerMTok
  );
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
