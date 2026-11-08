import { AsyncLocalStorage } from 'node:async_hooks';
/** Requested order is preference only: never authority for privacy, capability or spend. */
export const FIXED_TEXT_CHAIN = ['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter', 'mitrify', 'cheapinf', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid'] as const;
export const FIXED_TEXT_CHAIN_MAX_ATTEMPTS = 12;
export function fixedTextChainEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const policy = env.TEXT_CHAIN_POLICY?.trim() || 'legacy';
  if (policy !== 'legacy' && policy !== 'fixed-v1') throw new Error('TEXT_CHAIN_POLICY configuration is invalid.');
  return policy === 'fixed-v1';
}
export function fixedTextChainScope(surface: string, capability: string): boolean {
  return ['chat', 'professional', 'doctor', 'sda'].includes(surface) && capability === 'text';
}
/** Exact models requested by the owner; this mapping asserts no capability, price or approval. */
export function fixedTextChainRank(profile: { providerId: string; modelId: string; charging: string }): number | undefined {
  const provider = profile.providerId; const model = profile.modelId;
  if (profile.charging === 'verified-free-no-overage') {
    if (provider === 'GLM' && model === 'glm-4.5-flash') return 0;
    if (provider === 'GLM' && model === 'glm-4.7-flash') return 1;
    if (provider === 'GROQ' && model === 'openai/gpt-oss-120b') return 2;
    if (provider === 'CLOUDFLARE' && model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast') return 3;
    if (provider === 'OPENROUTER') return 4;
  }
  // Mitrify (position 5) has no complete-payload provenance or monetary admission bridge.
  // It must never be inferred free or dispatched through a generic OpenAI adapter.
  if (profile.charging !== 'metered') return undefined;
  if (provider === 'CHEAPERINFERENCE' && ['beam', 'beam-1.0-501b-a23b'].includes(model)) return 6;
  if (provider === 'DEEPINFRA' && model === 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo') return 7;
  if (provider === 'DEEPINFRA' && model === 'deepseek-ai/DeepSeek-V4-Flash-0731') return 8;
  if (provider === 'OPENAI' && model === 'gpt-5-nano') return 9;
  if (provider === 'GLM' && model === 'glm-4.7-flashx') return 10;
  if (provider === 'GEMINI' && model === 'gemini-2.5-flash-lite') return 11;
  return undefined;
}

const scopes = new AsyncLocalStorage<boolean>();
/** Only explicit server-owned ingress may select this policy; exclusions cannot be relaxed by descendants. */
export function withFixedTextChainScope<T>(surface: string, capability: string, run: () => T): T {
  const selected = scopes.getStore() !== false && fixedTextChainEnabled() && fixedTextChainScope(surface, capability);
  return scopes.run(selected, run);
}
export function fixedTextChainSelected(): boolean { return scopes.getStore() === true; }

/** Explicit non-text/Pro/Builder scopes veto enrollment by nested issuers. */
export function fixedTextChainScopeAllowed(): boolean { return scopes.getStore() !== false; }
