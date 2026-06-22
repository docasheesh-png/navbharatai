// AgentV3 pricing (D5/D6).
//
// The user is billed at the Claude **Opus-equivalent** token rate × a multiplier,
// regardless of which model actually ran (Sonnet / Opus / Vertex). NavBharatAI
// pays the real provider cost and keeps the spread → margin is structurally
// positive (billed ≥ real cost, since the real model price ≤ Opus price).
//
// IMPORTANT: the Opus rates below are the billing source-of-truth and MUST be
// kept in sync with Anthropic's current Opus pricing. They are overridable via
// env so ops can update them without a code change. Admin should confirm the
// live Opus price before GA.

/** Standard markup: user pays Opus-equivalent × 2.5 (D5). */
export const STANDARD_MULTIPLIER = 2.5;
/** "Only Opus" super toggle: user pays Opus-equivalent × 5 (D6). */
export const ONLY_OPUS_MULTIPLIER = 5.0;

function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Claude Opus token rates, USD per 1,000,000 tokens. Override via env. */
export function opusRate(): { inputPerMTok: number; outputPerMTok: number } {
  return {
    inputPerMTok: envRate('OPUS_INPUT_PER_MTOK', 15),
    outputPerMTok: envRate('OPUS_OUTPUT_PER_MTOK', 75),
  };
}

export interface BilledUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Raw Opus-equivalent cost (USD) for the given token usage — before the markup. */
export function opusEquivalentUsd(usage: BilledUsage): number {
  const rate = opusRate();
  return (
    (Math.max(0, usage.inputTokens) / 1_000_000) * rate.inputPerMTok +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputPerMTok
  );
}

/**
 * The amount (USD) to bill the user for this usage. Standard mode applies the
 * 2.5× markup; the "Only Opus" super toggle applies 5× (D6).
 */
export function billedAmountUsd(usage: BilledUsage, onlyOpus = false): number {
  const multiplier = onlyOpus ? ONLY_OPUS_MULTIPLIER : STANDARD_MULTIPLIER;
  return opusEquivalentUsd(usage) * multiplier;
}
