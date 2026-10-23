import { describe, expect, it } from 'vitest';
import { realProviderCostUsd, realRateCard, realRateFor, usageCostUsd } from '../src/server/AgentV3/providerRates';
import { allowedOnFreeTier, chatCostIndex, freeTierCeiling } from '../src/server/AI/freeTierCostCeiling';

const peakFlashRate = { inputPerMTok: 0.3, outputPerMTok: 1.2, cacheReadPerMTok: 0.006 };
const unknownRate = () => ({ inputPerMTok: realRateCard().sonnet.inputPerMTok, outputPerMTok: realRateCard().sonnet.outputPerMTok });

describe('FreeChain direct-provider rate compatibility', () => {
  it('recognizes only the verified direct DeepSeek Flash peak tariff', () => {
    // Official source, checked 2026-10-23: https://api-docs.deepseek.com/quick_start/pricing/
    // Off-peak is cheaper. This central admission rate is a peak upper bound, not an invoice.
    expect(realRateCard()['deepseek-flash']).toEqual(peakFlashRate);
    expect(realRateFor('DEEPSEEK', 'deepseek-flash')).toEqual(peakFlashRate);
    expect(realRateFor('deepseek', 'DEEPSEEK-FLASH')).toEqual(peakFlashRate);
  });

  it.each([undefined, '', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash:free', 'glm-4.7-flash', 'gpt-5-nano'])(
    'does not infer a cheap tariff for an unverified DeepSeek model (%s)', model => {
      expect(realRateFor('DEEPSEEK', model)).toEqual(unknownRate());
      expect(allowedOnFreeTier('DEEPSEEK', model)).toBe(false);
    },
  );

  it.each(['OPENROUTER', 'GLM', 'OPENAI', 'GROQ', 'CLOUDFLARE', 'other'])(
    'never copies the direct tariff to a different host (%s)', provider => {
      expect(realRateFor(provider, 'deepseek-flash')).toEqual(unknownRate());
      expect(allowedOnFreeTier(provider, 'deepseek-flash')).toBe(false);
    },
  );

  it('does not accept a namespaced or suffixed model as an exact direct-provider SKU', () => {
    expect(realRateFor('OPENROUTER', 'deepseek/deepseek-flash')).toEqual(unknownRate());
    expect(realRateFor('DEEPSEEK', 'deepseek/deepseek-flash')).toEqual(unknownRate());
    expect(realRateFor('DEEPSEEK', 'deepseek-flash-unknown')).toEqual(unknownRate());
  });

  it('admits the verified rate without moving the existing Kimi ceiling', () => {
    expect(chatCostIndex('DEEPSEEK', 'deepseek-flash')).toBeCloseTo(3.6, 12);
    expect(freeTierCeiling()).toBeCloseTo(11.6, 12);
    expect(freeTierCeiling()).toBe(chatCostIndex('KIMI', 'kimi-k2.7'));
    expect(allowedOnFreeTier('DEEPSEEK', 'deepseek-flash')).toBe(true);
  });

  it('prices a reported cache share as a subset of total input, never extra tokens', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadInputTokens: 800_000 };
    // 200k misses × $0.30/M + 800k hits × $0.006/M + 500k output × $1.20/M.
    expect(usageCostUsd(usage, realRateFor('DEEPSEEK', 'deepseek-flash'))).toBeCloseTo(0.6648, 12);
    expect(realProviderCostUsd([{ provider: 'DEEPSEEK', model: 'deepseek-flash', usage }])).toBeCloseTo(0.6648, 12);
    expect(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, peakFlashRate)).toBeCloseTo(0.9, 12);
  });

  it('does not turn account-level free-plan declarations into universal zero-price rates', () => {
    expect(realRateFor('GROQ', 'openai/gpt-oss-120b')).toEqual(unknownRate());
    expect(realRateFor('CLOUDFLARE', '@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toEqual(unknownRate());
    expect(realRateFor('GEMINI', 'gemini-2.5-flash')).toEqual({ inputPerMTok: 0.3, outputPerMTok: 2.5 });
  });

  it('preserves the existing funded-builder model rates and conservative unknown fallback', () => {
    expect(realRateFor('GLM', 'glm-4.7-flashx')).toEqual({ inputPerMTok: 0.07, outputPerMTok: 0.4, cacheReadPerMTok: 0.01 });
    expect(realRateFor('KIMI', 'kimi-k2.7-code-highspeed')).toEqual({ inputPerMTok: 1.9, outputPerMTok: 8, cacheReadPerMTok: 0.38 });
    expect(realRateFor('CLAUDE', 'claude-sonnet-4-6')).toEqual(realRateCard().sonnet);
    expect(realRateFor('other', 'untracked-model')).toEqual(unknownRate());
  });
});
