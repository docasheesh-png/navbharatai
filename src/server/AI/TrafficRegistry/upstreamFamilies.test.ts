/**
 * P1 (owner-approved 2026-11-17): "Two resellers using the same upstream must not be treated as independent
 * fallbacks." These tests lock the CLASS: no provider enters the registry unclassified, and independence is
 * never claimed without evidence.
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';
import { RESELLER_GATEWAY_IDS } from '../../lib/resellerGateways';
import { independentRoutes, modelMaker, PROVIDER_UPSTREAM, routeDependencies, UNKNOWN } from './upstreamFamilies';

describe('every kill-switch provider has an upstream classification (census)', () => {
  it('the classified set is exactly the kill-switch family set', () => {
    expect(Object.keys(PROVIDER_UPSTREAM).sort()).toEqual(PROVIDER_FAMILIES.map(f => f.id).sort());
  });
  it('every reseller gateway is classified as a reseller', () => {
    for (const id of RESELLER_GATEWAY_IDS) expect(PROVIDER_UPSTREAM[id]?.kind).toBe('reseller');
  });
  it('a reseller is its own outage domain, never its upstream\'s name', () => {
    for (const [id, up] of Object.entries(PROVIDER_UPSTREAM)) {
      if (up.kind === 'reseller') expect(up.family).toBe(`reseller:${id}`);
      else expect(up.family.startsWith('reseller:')).toBe(false);
    }
  });
  it('an unclassified provider throws instead of being called independent', () => {
    expect(() => routeDependencies('brand-new-reseller', 'deepseek-v4')).toThrow(/no upstream classification/);
  });
});

describe('model makers are read from the model id', () => {
  it.each([
    ['glm-4.7-flashx', 'zhipu'], ['kimi-k2.7-code', 'moonshot'], ['deepseek-ai/DeepSeek-V4-Flash-0731', 'deepseek'],
    ['gpt-5-nano', 'openai'], ['openai/gpt-oss-120b', 'openai'], ['gemini-2.5-flash-lite', 'google'],
    ['sonnet', 'anthropic'], ['haiku', 'anthropic'], ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'meta'],
    ['nvidia/nemotron-3-nano-30b-a3b', 'nvidia'], ['Qwen/Qwen3-32B', 'alibaba'], ['beam', UNKNOWN], ['default', UNKNOWN],
  ])('%s → %s', (model, maker) => expect(modelMaker(model)).toBe(maker));
});

describe('shared upstreams are never independent fallbacks', () => {
  const dep = (p: string, m: string) => routeDependencies(p, m).dependsOn;
  it('the same DeepSeek model direct and through two resellers: none independent of another', () => {
    const direct = dep('deepseek', 'deepseek-flash');
    const viaOpenRouter = dep('openrouter', 'deepseek/deepseek-v4');
    const viaCheaper = dep('cheaperinference', 'deepseek-v4');
    expect(independentRoutes(direct, viaOpenRouter)).toBe(false);
    expect(independentRoutes(direct, viaCheaper)).toBe(false);
    expect(independentRoutes(viaOpenRouter, viaCheaper)).toBe(false);
  });
  it('two DeepInfra models share DeepInfra; Requesty routing to DeepInfra shares it too', () => {
    expect(independentRoutes(dep('deepinfra', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'), dep('deepinfra', 'deepseek-ai/DeepSeek-V4-Flash-0731'))).toBe(false);
    const viaRequesty = routeDependencies('requesty', 'deepinfra/nvidia/Nemotron-3-Nano-30B-A3B');
    expect(viaRequesty.evidence).toBe('model-route');
    expect(independentRoutes(viaRequesty.dependsOn, dep('deepinfra', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'))).toBe(false);
  });
  it('Gemini and Vertex are one Google domain', () => {
    expect(independentRoutes(dep('gemini', 'gemini-2.5-flash-lite'), dep('vertex', 'gemini-2.5-pro'))).toBe(false);
  });
  it('an unknown maker behind a reseller is independent of nothing', () => {
    const beam = dep('cheaperinference', 'beam');
    expect(beam).toContain(UNKNOWN);
    expect(independentRoutes(beam, dep('groq', 'openai/gpt-oss-120b'))).toBe(false);
  });
  it('genuinely separate direct providers ARE independent, and the relation is symmetric', () => {
    const glm = dep('glm', 'glm-4.7-flashx'); const groq = dep('groq', 'openai/gpt-oss-120b');
    expect(independentRoutes(glm, groq)).toBe(true);
    expect(independentRoutes(groq, glm)).toBe(true);
  });
  it('a reseller of OpenAI models is not independent of direct OpenAI', () => {
    expect(independentRoutes(dep('discountedtokens', 'gpt-6-sol'), dep('openai', 'gpt-5-nano'))).toBe(false);
  });
});
