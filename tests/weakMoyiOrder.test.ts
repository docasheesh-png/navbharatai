import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurnRunner, buildChainOpensPastOpener } from '../src/server/routes/agentv3';
import {
  moyiBuilderEnabled, moyiBuilderMissing, moyiBuilderModels, moyiBuilderRate, moyiBuilderRungs, neutraliseMoyiName,
} from '../src/server/AgentV3/moyiBuilder';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { OFF_LADDER_PROVIDERS } from '../src/server/AgentV3/ladderDepth';
import { hasProviderLeak, redactProviderError } from '../src/server/lib/providerRedaction';
import { scrubVendorBrandsInPayload } from '../src/shared/brandScrub';

// Owner 2026-11-17: "moyi api ko bhi bluesminds ke baad lagao". Weak = Surplus → Router One → BluesMinds → Moyi → ladder.
const READY = { MOYI_API_KEY: 'synthetic-moyi-key', MOYI_BUILDER_MODEL: 'grok-4.7', MOYI_BUILDER_RATE_IN: '0.3', MOYI_BUILDER_RATE_OUT: '0.9' };
beforeEach(() => {
  vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-test-key');
  vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
  vi.stubEnv('ROUTER_ONE_ENABLED', 'on');
  vi.stubEnv('FREE_CHAIN_BLUESMINDS_API_KEY', 'synthetic-bm-key');
  vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', '');
  vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
  vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
  vi.stubEnv('AGENTV3_LADDER_WEAK', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code,GLM:glm-5.3');
  for (const [k, v] of Object.entries(READY)) vi.stubEnv(k, v);
  vi.stubEnv('MOYI_BUILDER_ENABLED', '');
  vi.stubEnv('MOYI_BASE_URL', '');
});
afterEach(() => vi.unstubAllEnvs());
const chain = (opts: Partial<Parameters<typeof buildTurnRunner>[0]> = {}) => {
  let names: string[] = [];
  buildTurnRunner({ tier: 'weak', ...opts, onChain: rungs => { names = rungs.map(r => r.name); } });
  return names;
};

describe('Weak: Router One → BluesMinds → Moyi → ladder', () => {
  it.each([{}, { heal: true }, { plan: true }, { complex: true }])('Moyi sits right after BluesMinds in lane %j', opts => {
    expect(chain(opts).slice(0, 4)).toEqual(['ENGINE_R1', 'ENGINE_BM', 'ENGINE_MY', 'GLM']);
  });
  it('the rung calls Moyi’s OpenAI-format endpoint with the configured model', () => {
    const calls: unknown[][] = [];
    moyiBuilderRungs((...args) => { calls.push(args); return []; }, READY as never);
    expect(calls).toEqual([['ENGINE_MY', 'synthetic-moyi-key', 'https://api.moyi-api.com/v1', ['grok-4.7']]]);
  });
  it.each([
    ['MOYI_API_KEY', 'MOYI_API_KEY is not set'],
    ['MOYI_BUILDER_MODEL', 'MOYI_BUILDER_MODEL is not set'],
    ['MOYI_BUILDER_RATE_IN', 'MOYI_BUILDER_RATE_IN and MOYI_BUILDER_RATE_OUT are not set'],
    ['MOYI_BUILDER_RATE_OUT', 'MOYI_BUILDER_RATE_IN and MOYI_BUILDER_RATE_OUT are not set'],
  ])('without %s there is no rung, and the chain is exactly what it was before', (key, reason) => {
    vi.stubEnv(key, '');
    expect(moyiBuilderEnabled()).toBe(false);
    expect(moyiBuilderMissing()).toContain(reason);
    expect(chain()).toEqual(['ENGINE_R1', 'ENGINE_BM', 'GLM', 'KIMI', 'GLM']);
  });
  it('is on by default once configured, and only an explicit off removes it', () => {
    expect(moyiBuilderEnabled(READY as never)).toBe(true);
    expect(moyiBuilderEnabled({ ...READY, MOYI_BUILDER_ENABLED: 'off' } as never)).toBe(false);
  });
  it('a base URL off Moyi’s own domain removes the rung instead of sending the key elsewhere', () => {
    vi.stubEnv('MOYI_BASE_URL', 'https://api.moyi-api.com.evil.example/v1');
    expect(chain()).not.toContain('ENGINE_MY');
  });
  it('alone (no Router One, no BluesMinds) it still leads the ladder and counts as an available engine', () => {
    vi.stubEnv('ROUTER_ONE_ENABLED', 'off');
    vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', 'off');
    expect(chain()).toEqual(['ENGINE_MY', 'GLM', 'KIMI', 'GLM']);
    expect(buildChainOpensPastOpener('weak', true)).toBe(false);
  });
  it('Normal and Strong ladders are unchanged', () => {
    expect(chain({ tier: 'mini' })).not.toContain('ENGINE_MY');
    expect(chain({ tier: 'off' })).not.toContain('ENGINE_MY');
  });
  it('is an off-ladder engine for the ladder-depth report', () => {
    expect(OFF_LADDER_PROVIDERS).toContain('ENGINE_MY');
  });
});

describe('🔒 no Claude through Moyi, and never on Weak', () => {
  it.each(['claude-opus-5-5', 'anthropic/claude-sonnet-5.5', 'claude-haiku-5-5', 'Claude-Fable-5.2', 'opus-5', 'sonnet'])(
    'drops %s from the model list', model => {
      expect(moyiBuilderModels({ MOYI_BUILDER_MODEL: `${model},grok-4.7` } as never)).toEqual(['grok-4.7']);
    });
  it('a list of only Claude models leaves no rung at all', () => {
    vi.stubEnv('MOYI_BUILDER_MODEL', 'claude-opus-5-5,claude-sonnet-5-5');
    expect(moyiBuilderEnabled()).toBe(false);
    expect(chain()).not.toContain('ENGINE_MY');
  });
});

describe('Moyi billing and brand', () => {
  it('bills at the owner’s configured real rate, never an invented one', () => {
    expect(realRateFor('ENGINE_MY', 'grok-4.7')).toEqual({ inputPerMTok: 0.3, outputPerMTok: 0.9 });
    expect(realRateFor('ENGINE_MY#2', 'grok-4.7')).toEqual({ inputPerMTok: 0.3, outputPerMTok: 0.9 });
    expect(moyiBuilderRate({ MOYI_BUILDER_RATE_IN: '0', MOYI_BUILDER_RATE_OUT: '0' } as never)).toBeNull();
    expect(moyiBuilderRate({ MOYI_BUILDER_RATE_IN: 'abc', MOYI_BUILDER_RATE_OUT: '1' } as never)).toBeNull();
  });
  it('swaps the supplier name and host in an error for the neutral label', () => {
    const err = new Error('429 rate limit from api.moyi-api.com (Moyi quota), see moyi-api.com');
    neutraliseMoyiName(err);
    expect(err.message).toBe('429 rate limit from ENGINE_MY (ENGINE_MY quota), see ENGINE_MY');
  });
  it('a failing rung throws a brand-neutral error so the chain can fall through', async () => {
    const runner = { plannedModel: 'm', runTurn: async () => { throw new Error('Moyi upstream timeout'); } };
    const [rung] = moyiBuilderRungs(() => [{ name: 'ENGINE_MY', runner: runner as never }], READY as never);
    expect((rung.runner as unknown as { plannedModel: string }).plannedModel).toBe('m');
    await expect(rung.runner.runTurn({} as never)).rejects.toThrow('ENGINE_MY upstream timeout');
  });
  it('a user never sees the label, the name or the host', () => {
    for (const text of ['ENGINE_MY failed', 'Moyi API returned 503', 'error from api.moyi-api.com']) {
      expect(hasProviderLeak(text)).toBe(true);
      expect(redactProviderError(text)).not.toMatch(/ENGINE_MY|moyi/i);
    }
    expect(JSON.stringify(scrubVendorBrandsInPayload({ error: 'ENGINE_MY failed', provider: 'ENGINE_MY' }))).not.toMatch(/ENGINE_MY/);
  });
});
