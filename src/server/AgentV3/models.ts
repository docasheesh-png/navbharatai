// AgentV3 model resolution (D5/D6).
//
// Standard mode runs on Sonnet under the hood (cheaper real cost, still billed at
// the Opus-equivalent × 2.5 → healthy margin). The "Only Opus" super toggle (D6)
// forces Opus and bills × 5.
//
// Model ids are env-overridable so ops can point at the exact current Anthropic
// model without a code change. The defaults are valid Anthropic ids; admin should
// bump them to the latest Sonnet/Opus at GA.
const DEFAULT_SONNET = 'claude-3-5-sonnet-20241022';
const DEFAULT_OPUS = 'claude-3-opus-20240229';

export function sonnetModel(): string {
  return process.env.AGENTV3_SONNET_MODEL || DEFAULT_SONNET;
}

export function opusModel(): string {
  return process.env.AGENTV3_OPUS_MODEL || DEFAULT_OPUS;
}

/** Resolve the model to run with. Only-Opus (super toggle) → Opus, else Sonnet. */
export function resolveModel(onlyOpus: boolean): string {
  return onlyOpus ? opusModel() : sonnetModel();
}
