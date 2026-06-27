// AgentV3 pricing — multi-model billing (admin model, 2026-06-24).
//
// NORMAL mode (Power OFF): whichever provider actually answered (Gemini/Vertex/Haiku/
// Sonnet — the user never knows), the engine bills AS IF SONNET ran — it prices the real
// token usage at Sonnet's rate and applies the NORMAL markup (× 3.5). Opus is power-only,
// so normal-mode billing is flat & predictable and never surprises the user.
//
// POWER mode (Power ON): the user is on Opus 4.8; bill the REAL Opus cost × the POWER
// markup (× 2.5). The effort selector (mini/medium/max) only changes how many real tokens
// are spent → the bill scales naturally; the multiplier stays 2.5×.
//
// The customer-facing amount is shown in INR: billedAmountInr() = billedAmountUsd() × the
// (real-time) USD→INR rate. Margin is structurally positive in both modes (billed ≥ real
// cost). Rates are env-overridable so ops can track live Anthropic prices without a deploy.

/** Normal-mode markup: Sonnet-equivalent × 3.5. */
export const NORMAL_MULTIPLIER = 3.5;
/**
 * Legacy power-mode markup (real Opus 4.8 cost × 2.5). Retained for the boolean
 * `billedAmountUsd(usage, true)` path so existing callers/tests are unchanged.
 * New code uses the three power-level multipliers below (admin override 2026-06-27).
 */
export const POWER_MULTIPLIER = 2.5;

/**
 * Admin-authorized power-level markups (aashishcpmt09, 2026-06-27), applied to the
 * real Opus-equivalent token cost: 5× (mini) / 10× (medium) / 20× (max/ultracode).
 */
export const POWER_MULTIPLIERS = { mini: 5, medium: 10, max: 20 } as const;

/** A power level for billing. 'off' bills at the normal Sonnet rate. */
export type BillingPowerLevel = 'off' | 'mini' | 'medium' | 'max';

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
 * The USD amount to bill the user.
 * - Power level 'mini'/'medium'/'max' → real Opus 4.8 cost × 5 / 10 / 20
 * - Power level 'off' → Sonnet-equivalent cost × 3.5
 * - Legacy boolean: `true` → real Opus 4.8 cost × 2.5 (the old POWER_MULTIPLIER);
 *   `false` → normal. Kept so existing callers/tests behave exactly as before.
 */
export function billedAmountUsd(usage: BilledUsage, power: BillingPowerLevel | boolean = false): number {
  if (power === true) return opusEquivalentUsd(usage) * POWER_MULTIPLIER;
  if (power === false || power === 'off') return sonnetEquivalentUsd(usage) * NORMAL_MULTIPLIER;
  return opusEquivalentUsd(usage) * POWER_MULTIPLIERS[power];
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
