/** The shared model rule (admin 2026-11-18): strong family for the request → fit (tools for coding) → cheapest. */
import { describe, expect, it } from 'vitest';
import { blendedPrice, chooseModels, CODING_FAMILIES, familyRank, TEXT_FAMILIES } from './modelChoice';
import { rankForCoding } from '../AI/RouterOne/routerOneCatalog';
import { rankChatModels } from './providerModelPicker';
import { strongOffersOnly } from '../AI/SurplusRegistry/strongOffers';

describe('the families', () => {
  it('are exactly ten for each purpose', () => {
    expect(CODING_FAMILIES).toHaveLength(10);
    expect(TEXT_FAMILIES).toHaveLength(10);
  });
  it('recognise the ids gateways really serve, and keep gpt-oss apart from gpt-5/6', () => {
    for (const id of ['openai/gpt-6-sol', 'gpt-5.1-codex', 'moonshotai/kimi-k2.6', 'z-ai/glm-5.3', 'deepseek-v4.1-flash', 'qwen/qwen3-coder', 'grok-4.7', 'minimax-m2', 'openai/gpt-oss-120b', 'gemini-2.5-pro']) {
      expect(familyRank(id, 'coding'), id).toBeGreaterThanOrEqual(0);
    }
    expect(CODING_FAMILIES[familyRank('openai/gpt-oss-20b', 'coding')].name).toBe('gpt-oss');
    expect(familyRank('llama-3.1-8b-instant', 'coding')).toBe(-1);
    expect(familyRank('text-embedding-4', 'text')).toBe(-1);
    expect(familyRank('llama-3.3-70b-versatile', 'text')).toBeGreaterThanOrEqual(0);
  });
});

describe('the rule', () => {
  const cands = [
    { id: 'llama-3.1-8b', inputPerMTok: 0.01, outputPerMTok: 0.02 },           // cheapest, but not strong
    { id: 'kimi-k2.7-code', inputPerMTok: 0.6, outputPerMTok: 2.5 },
    { id: 'deepseek-v4.1-flash', inputPerMTok: 0.14, outputPerMTok: 0.28 },
    { id: 'qwen3-coder', inputPerMTok: 0.3, outputPerMTok: 1.2, tools: false },  // strong, but cannot call tools
    { id: 'claude-sonnet-4-6', inputPerMTok: 3, outputPerMTok: 15 },
    { id: 'gpt-6-sol' },                                                         // strong, price unknown
    { id: 'dall-e-4', inputPerMTok: 0.001, outputPerMTok: 0.001 },
  ];
  it('coding: strong + tools, cheapest first, unknown prices last, weak and non-chat never', () => {
    expect(chooseModels(cands, { purpose: 'coding', max: 5 })).toEqual({ basis: 'strong', models: ['deepseek-v4.1-flash', 'kimi-k2.7-code', 'claude-sonnet-4-6', 'gpt-6-sol'] });
  });
  it('a Weak build never receives Sonnet or Opus', () => {
    expect(chooseModels(cands, { purpose: 'coding', max: 5, noClaude: true }).models).not.toContain('claude-sonnet-4-6');
  });
  it('text weighs the answer, not the prompt', () => {
    expect(blendedPrice({ id: 'x', inputPerMTok: 1, outputPerMTok: 9 }, 'text')).toBeGreaterThan(blendedPrice({ id: 'x', inputPerMTok: 1, outputPerMTok: 9 }, 'coding'));
  });
  it('never empty: a gateway with no strong model keeps its own order', () => {
    expect(chooseModels([{ id: 'llama-3.1-8b' }, { id: 'phi-4' }], { purpose: 'coding' })).toEqual({ basis: 'fallback', models: ['llama-3.1-8b', 'phi-4'] });
  });
  it('MODEL_CHOICE=off is the kill switch', () => {
    expect(chooseModels(cands, { purpose: 'coding', max: 2, env: { MODEL_CHOICE: 'off' } }).basis).toBe('fallback');
  });
});

describe('every gateway asks the same rule', () => {
  it('Router One: a strong coding model leads even when a weak one is cheaper; the weak stays behind', () => {
    const ranked = rankForCoding([
      { id: 'llama-3.1-8b', inPerM: 0.02, outPerM: 0.05, tools: true, ctx: null },
      { id: 'deepseek-v4.1-flash', inPerM: 0.14, outPerM: 0.28, tools: true, ctx: null },
      { id: 'kimi-k2.7-code', inPerM: 0.6, outPerM: 2.5, tools: true, ctx: null },
    ], {});
    expect(ranked.map((e) => e.id)).toEqual(['deepseek-v4.1-flash', 'kimi-k2.7-code', 'llama-3.1-8b']);
  });
  it('key lists (BluesMinds, MirAPI, the Test Chat Bot): strong families first for the purpose', () => {
    expect(rankChatModels(['phi-4', 'llama-3.1-8b', 'moonshotai/kimi-k2.6', 'openai/gpt-oss-20b'], null, 'coding').slice(0, 2)).toEqual(['moonshotai/kimi-k2.6', 'openai/gpt-oss-20b']);
  });
  it('Surplus: only strong offers while one is eligible, and never none', () => {
    expect(strongOffersOnly([{ model: 'llama-3.1-8b' }, { model: 'deepseek-v4.1-flash' }], {}).map((o) => o.model)).toEqual(['deepseek-v4.1-flash']);
    expect(strongOffersOnly([{ model: 'llama-3.1-8b' }], {}).map((o) => o.model)).toEqual(['llama-3.1-8b']);
  });
});

describe('the builder gateways with prices', () => {
  it('Qubax with no owner list chooses from its whole catalogue by the rule', async () => {
    const { refreshQubaxBuilderCatalog, qubaxBuilderModels } = await import('../AgentV3/proChainV2/qubaxBuilder');
    const entry = (id: string, prompt: number, completion: number, tools = true) => ({ id, ready: true, context_length: 200000, capabilities: { tools }, pricing: [{ label: 'token', prompt: String(prompt / 1e6), completion: String(completion / 1e6) }] });
    const body = { data: [entry('llama-3.1-8b', 0.02, 0.05), entry('glm-5.3', 1.4, 4.4), entry('deepseek-v4.1-flash', 0.14, 0.28), entry('kimi-k2.7-code', 0.6, 2.5), entry('qwen3-coder', 0.1, 0.4, false)] };
    await refreshQubaxBuilderCatalog((async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch, Date.now());
    const { models } = qubaxBuilderModels({ QUBAX_API_KEY: 'k' } as never);
    expect(models[0]).toBe('deepseek-v4.1-flash');
    expect(models).not.toContain('llama-3.1-8b');
    expect(models).not.toContain('qwen3-coder');
    expect(qubaxBuilderModels({ QUBAX_API_KEY: 'k', QUBAX_BUILDER_MODELS: 'glm-5.3' } as never).models).toEqual(['glm-5.3']); // the owner's list wins
  });
});
