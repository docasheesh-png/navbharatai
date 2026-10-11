// THE TOTAL INPUT OF AN ANTHROPIC CALL (Q-343).
//
// Anthropic's `input_tokens` is only the UNCACHED part of the prompt; a cache read and a cache write are
// reported BESIDE it (`cache_read_input_tokens`, `cache_creation_input_tokens`). Every OpenAI-compatible
// provider reports the opposite shape: `prompt_tokens` already includes its cached share. Every place in
// NavBharatAI that holds a token count means the TOTAL input, so an Anthropic count read as-is drops the
// whole cache — which is how every Claude build turn's cache went unpriced until 2026-10-11.
//
// This is the one place that reads Anthropic's field. `tests/claudeCacheIsPricedAtItsRealRate.test.ts`
// fails when another file in src/server reads `input_tokens` itself.

export interface AnthropicUsageLike {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** The cache shares of an Anthropic call. Both are PARTS of `anthropicTotalInput`, never additional. */
export function anthropicCacheShares(u: AnthropicUsageLike | null | undefined): { cacheReadInputTokens: number; cacheCreationInputTokens: number } {
  return { cacheReadInputTokens: count(u?.cache_read_input_tokens), cacheCreationInputTokens: count(u?.cache_creation_input_tokens) };
}

/** The whole prompt the call sent: uncached + cache read + cache write. */
export function anthropicTotalInput(u: AnthropicUsageLike | null | undefined): number {
  const s = anthropicCacheShares(u);
  return count(u?.input_tokens) + s.cacheReadInputTokens + s.cacheCreationInputTokens;
}
