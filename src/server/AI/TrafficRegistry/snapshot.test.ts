/**
 * P1 (owner-approved 2026-11-17): the registry snapshot is complete, read from the real sources, and changes no
 * routing. The census tests fail when a provider or model is used somewhere and missing here.
 */
import { describe, expect, it } from 'vitest';
import { FREE_CHAIN_RUNG_PROVIDER, DIRECTORY_ONLY, buildRegistrySnapshot, ladderProviderAccount } from './snapshot';
import { PROVIDER_IDS, freeChainConfig } from '../FreeChain/config';
import { TIER_LADDERS, PLAN_RUNG, tierLadder } from '../../AgentV3/tierLadder';
import { API_PROVIDERS } from '../../lib/apiProviderDirectory';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';
import { independentRoutes } from './upstreamFamilies';

const ENV = {} as NodeJS.ProcessEnv;
const snap = buildRegistrySnapshot(ENV);
const providerIds = new Set(snap.providers.map(p => p.id));
const modelKeys = new Set(snap.models.map(m => m.key));

describe('census: nothing NavBharatAI calls is missing from the registry', () => {
  it('every kill-switch family is a provider record', () => {
    expect([...providerIds].sort()).toEqual(PROVIDER_FAMILIES.map(f => f.id).sort());
  });
  it('every AI or registered directory row is a provider, or a reasoned directory-only exemption', () => {
    for (const row of API_PROVIDERS.filter(p => p.group !== 'service')) {
      expect(providerIds.has(row.id) || row.id in DIRECTORY_ONLY, `${row.id} is in the API directory but not the registry`).toBe(true);
    }
    for (const id of Object.keys(DIRECTORY_ONLY)) expect(providerIds.has(id)).toBe(false);
  });
  it('every Free Chat rung maps to a registered provider account, and every rung with a model is a model record', () => {
    expect(Object.keys(FREE_CHAIN_RUNG_PROVIDER).sort()).toEqual([...PROVIDER_IDS].sort());
    for (const rung of freeChainConfig(ENV).rungs) {
      const account = FREE_CHAIN_RUNG_PROVIDER[rung.id];
      expect(providerIds.has(account), `${rung.id} → ${account}`).toBe(true);
      if (rung.model) expect(modelKeys.has(`${account}/${rung.model}`), `${rung.id} model`).toBe(true);
    }
  });
  it('every builder rung of every tier, plus each plan rung, is a model record on the builder surface', () => {
    for (const level of Object.keys(TIER_LADDERS) as (keyof typeof TIER_LADDERS)[]) {
      for (const rung of [...tierLadder(level, ENV).rungs, PLAN_RUNG[level]]) {
        const key = `${ladderProviderAccount(rung.provider, ENV)}/${rung.model}`;
        const record = snap.models.find(m => m.key === key);
        expect(record, key).toBeDefined();
        expect(record!.surfaces).toContain('builder');
      }
    }
  });
});

describe('the snapshot reads its sources; it does not copy them', () => {
  it('a builder env override is reflected (the ladder in force, not the code default)', () => {
    const overridden = buildRegistrySnapshot({ AGENTV3_LADDER_WEAK: 'GLM:glm-4.7-flashx,KIMI:kimi-k3' } as NodeJS.ProcessEnv);
    expect(tierLadder('weak', { AGENTV3_LADDER_WEAK: 'GLM:glm-4.7-flashx,KIMI:kimi-k3' } as NodeJS.ProcessEnv).source).toBe('env');
    // kimi-k3 is on the Strong ladder by default; the override puts it on Weak too, so it must still be a builder model,
    // and the Weak defaults the override REPLACED (kimi-k2.7-code) must be gone unless another tier still uses them.
    expect(overridden.models.some(m => m.key === 'kimi/kimi-k3' && m.surfaces.includes('builder'))).toBe(true);
    expect(overridden.models.some(m => m.key === 'kimi/kimi-k2.7-code')).toBe(false);
  });
  it('the NEMOTRON builder rung is attributed to the host it really calls (OpenRouter by default)', () => {
    expect(ladderProviderAccount('NEMOTRON', {} as NodeJS.ProcessEnv)).toBe('openrouter');
    expect(ladderProviderAccount('NEMOTRON', { NEMOTRON_BASE_URL: 'https://integrate.api.nvidia.com/v1' } as NodeJS.ProcessEnv)).toBe('nvidia');
  });
  it('Free Chat prices come from the chain config, one offer per rung, never merged', () => {
    for (const rung of freeChainConfig(ENV).rungs.filter(r => r.model)) {
      const record = snap.models.find(m => m.key === `${FREE_CHAIN_RUNG_PROVIDER[rung.id]}/${rung.model}`)!;
      expect(record.offers).toContainEqual({ via: `free-chain:${rung.id}`, inPerM: rung.priceIn, outPerM: rung.priceOut, source: 'free-chain-config' });
    }
    // The free and the paid Gemini rung are the same model bought on different terms: both prices survive.
    const flashLite = snap.models.find(m => m.key === 'gemini/gemini-2.5-flash-lite')!;
    expect(flashLite.offers.map(o => o.via).sort()).toEqual(['free-chain:gemini', 'free-chain:geminipaid']);
  });
  it('is deterministic and holds no secret: building twice gives the same JSON, and no key-shaped value appears', () => {
    const withKeys = { GLM_API_KEY: 'sk-test-secret-value-123', FREE_CHAIN_GROQ_API_KEY: 'gsk_test_secret_456' } as NodeJS.ProcessEnv;
    const a = JSON.stringify(buildRegistrySnapshot(withKeys));
    expect(a).toBe(JSON.stringify(buildRegistrySnapshot(withKeys)));
    expect(a).not.toContain('sk-test-secret-value-123');
    expect(a).not.toContain('gsk_test_secret_456');
  });
});

describe('every model route carries its dependencies', () => {
  it('each model depends on at least its provider\'s own domain', () => {
    for (const m of snap.models) {
      const provider = snap.providers.find(p => p.id === m.providerId)!;
      expect(m.dependsOn).toContain(provider.family);
    }
  });
  it('the Free Chat paid fallbacks that share DeepInfra are flagged as one domain', () => {
    const llama = snap.models.find(m => m.key === 'deepinfra/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo')!;
    const dsv4 = snap.models.find(m => m.key === 'deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731')!;
    expect(independentRoutes(llama.dependsOn, dsv4.dependsOn)).toBe(false);
  });
});
