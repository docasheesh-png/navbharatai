// AgentV3 model resolution (D5/D6 + multi-model ladder).
//
// Standard mode runs on Sonnet under the hood (cheaper real cost, still billed at
// the Opus-equivalent × 2.5 → healthy margin). The "Only Opus" super toggle (D6)
// forces Opus and bills × 5.
//
// The multi-model cost ladder (low → high) is: Gemini/Vertex → Haiku → Sonnet →
// Opus 4.7 (normal escalation ceiling). POWER mode runs everything on Opus 4.8.
// Gemini/Vertex model ids live with their runners (non-Anthropic); the Anthropic
// ladder ids are resolved here.
//
// Model ids are env-overridable so ops can point at the exact current Anthropic
// model without a code change. The defaults are valid Anthropic ids; admin should
// bump them to the latest at GA.
const DEFAULT_HAIKU = 'claude-haiku-4-5-20251001';
const DEFAULT_SONNET = 'claude-sonnet-4-6';
const DEFAULT_OPUS_NORMAL = 'claude-opus-4-7';
const DEFAULT_OPUS = 'claude-opus-4-8';

export function haikuModel(): string {
  return process.env.AGENTV3_HAIKU_MODEL || DEFAULT_HAIKU;
}

export function sonnetModel(): string {
  return process.env.AGENTV3_SONNET_MODEL || DEFAULT_SONNET;
}

/** Normal-mode escalation ceiling (Opus 4.7). POWER mode uses opusModel() (4.8). */
export function opusNormalModel(): string {
  return process.env.AGENTV3_OPUS_NORMAL_MODEL || DEFAULT_OPUS_NORMAL;
}

/**
 * Model for the FAST lane (Simple Builder + OneShot) per-file generation. Defaults to SONNET, not
 * Haiku: each file is generated in its own isolated call, so the model must keep contracts
 * consistent ACROSS files (a hook's return shape must match what its consumer destructures). Haiku
 * frequently disagreed across those isolated calls → the app didn't compile. Sonnet is far more
 * consistent, which (with the verify+repair gate) makes simple apps build first-try. Env-overridable.
 */
export function fastBuildModel(): string {
  return process.env.AGENTV3_FAST_BUILD_MODEL || DEFAULT_SONNET;
}

/** POWER mode / "Only Opus" model — the premium Opus 4.8. */
export function opusModel(): string {
  return process.env.AGENTV3_OPUS_MODEL || DEFAULT_OPUS;
}

/**
 * Resolve the model to run with. Any power-on level (boolean true, or a
 * 'mini'/'medium'/'max' power level) → Opus; normal mode (false / 'off') → Sonnet.
 * The Opus reasoning EFFORT for each power level lives in powerLevel.ts.
 */
export function resolveModel(power: boolean | 'off' | 'mini' | 'medium' | 'max'): string {
  const isPowerOn = power === true || power === 'mini' || power === 'medium' || power === 'max';
  return isPowerOn ? opusModel() : sonnetModel();
}

/** The Anthropic ladder tiers, low → high cost (excludes the Gemini/Vertex base). */
export type ClaudeLadderTier = 'haiku' | 'sonnet' | 'opus';

/** Resolve the Anthropic model id for a normal-mode ladder tier. */
export function ladderModel(tier: ClaudeLadderTier): string {
  switch (tier) {
    case 'haiku':
      return haikuModel();
    case 'sonnet':
      return sonnetModel();
    case 'opus':
      return opusNormalModel();
  }
}

