import { describe, expect, it } from 'vitest';
import { FIXED_TEXT_CHAIN, prioritizeChatSuppliers, chatTextChainRank, fixedTextChainRank } from './fixedTextChain';

describe('Chat supplier priority only', () => {
  it.each([undefined, 'chat'])('puts existing Mitrify then Qubax first for %s', surface => {
    const result = prioritizeChatSuppliers(FIXED_TEXT_CHAIN, surface);
    expect(result.slice(0, 2)).toEqual(['mitrify', 'qubax']);
    expect(result.slice(2)).toEqual(FIXED_TEXT_CHAIN.filter(id => id !== 'mitrify' && id !== 'qubax'));
    expect(new Set(result).size).toBe(FIXED_TEXT_CHAIN.length);
    expect(FIXED_TEXT_CHAIN[0]).toBe('glm45');
  });
  it.each(['professional', 'doctor', 'sda', 'developer-api', 'builder', 'image-generation'])('preserves %s', surface => {
    expect(prioritizeChatSuppliers(FIXED_TEXT_CHAIN, surface)).toEqual(FIXED_TEXT_CHAIN);
  });
  it('does not enroll suppliers omitted by existing policy', () => {
    expect(prioritizeChatSuppliers(['groq', 'cloudflare'], 'chat')).toEqual(['groq', 'cloudflare']);
    expect(prioritizeChatSuppliers(['cheapinf'], 'chat')).toEqual(['cheapinf']);
  });
  it('preserves configured fallback relative order', () => {
    expect(prioritizeChatSuppliers(['groq', 'mitrify', 'qubax', 'glm45'], 'chat')).toEqual(['mitrify', 'qubax', 'groq', 'glm45']);
  });
  it('ranks only eligible gateway Chat profiles with the same order', () => {
    const profiles = [
      { providerId: 'GLM', modelId: 'glm-4.5-flash', charging: 'verified-free-no-overage' },
      { providerId: 'GLM', modelId: 'glm-4.7-flash', charging: 'verified-free-no-overage' },
      { providerId: 'GROQ', modelId: 'openai/gpt-oss-120b', charging: 'verified-free-no-overage' },
      { providerId: 'CLOUDFLARE', modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', charging: 'verified-free-no-overage' },
      { providerId: 'OPENROUTER', modelId: 'verified', charging: 'verified-free-no-overage' },
      { providerId: 'MITRIFY', modelId: 'alias', charging: 'metered' },
      { providerId: 'QUBAX', modelId: 'approved', charging: 'metered' },
      { providerId: 'CHEAPERINFERENCE', modelId: 'beam', charging: 'metered' },
    ];
    expect(profiles.map(p => chatTextChainRank(p, 'chat'))).toEqual([2, 3, 4, 5, 6, 0, 1, 7]);
    for (const surface of ['professional', 'doctor', 'sda', 'developer-api'])
      expect(profiles.map(p => chatTextChainRank(p, surface))).toEqual(profiles.map(fixedTextChainRank));
    expect(chatTextChainRank({ providerId: 'MITRIFY', modelId: 'alias', charging: 'unverified' }, 'chat')).toBeUndefined();
  });
});
