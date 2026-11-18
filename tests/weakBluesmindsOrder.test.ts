import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurnRunner, buildChainOpensPastOpener } from '../src/server/routes/agentv3';
import {
  BLUESMINDS_ESTIMATED_RATE, bluesmindsBuilderEnabled, bluesmindsBuilderRate, bluesmindsBuilderRungs, neutraliseBluesmindsName,
} from '../src/server/AgentV3/bluesmindsBuilder';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { OFF_LADDER_PROVIDERS } from '../src/server/AgentV3/ladderDepth';

// Owner t357u + t359u (2026-11-16): Pro Weak = Surplus → Router One → BluesMinds → the tier ladder, default on.
beforeEach(() => {
  vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-test-key');
  vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
  vi.stubEnv('ROUTER_ONE_ENABLED', 'on');
  vi.stubEnv('FREE_CHAIN_BLUESMINDS_API_KEY', 'synthetic-bm-key');
  vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', '');
  vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
  vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
  vi.stubEnv('AGENTV3_LADDER_WEAK', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code,GLM:glm-5.3');
});
afterEach(() => vi.unstubAllEnvs());
const chain = (opts: Partial<Parameters<typeof buildTurnRunner>[0]> = {}) => {
  let names: string[] = [];
  buildTurnRunner({ tier: 'weak', ...opts, onChain: rungs => { names = rungs.map(r => r.name); } });
  return names;
};

describe('Weak: Router One → BluesMinds → ladder', () => {
  it.each([{}, { heal: true }, { plan: true }, { complex: true }])('BluesMinds sits right after Router One in lane %j', opts => {
    expect(chain(opts).slice(0, 3)).toEqual(['ENGINE_R1', 'ENGINE_BM', 'GLM']);
  });
  it('is on by default (switch unset) and only an explicit off or a missing key removes it', () => {
    expect(bluesmindsBuilderEnabled({ FREE_CHAIN_BLUESMINDS_API_KEY: 'k' })).toBe(true);
    expect(bluesmindsBuilderEnabled({ FREE_CHAIN_BLUESMINDS_API_KEY: 'k', BLUESMINDS_BUILDER_ENABLED: 'off' })).toBe(false);
    expect(bluesmindsBuilderEnabled({})).toBe(false);
    vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', 'off');
    expect(chain()).toEqual(['ENGINE_R1', 'GLM', 'KIMI', 'GLM']);
  });
  it('without Router One it still leads the ladder, and the opener is not the ladder', () => {
    vi.stubEnv('ROUTER_ONE_ENABLED', 'off');
    expect(chain()).toEqual(['ENGINE_BM', 'GLM', 'KIMI', 'GLM']);
    expect(buildChainOpensPastOpener('weak', true)).toBe(false);
  });
  it('Normal and Strong ladders are unchanged', () => {
    expect(chain({ tier: 'mini' })).not.toContain('ENGINE_BM');
    expect(chain({ tier: 'off' })).not.toContain('ENGINE_BM');
  });
  it('is an off-ladder engine for the ladder-depth report', () => {
    expect(OFF_LADDER_PROVIDERS).toContain('ENGINE_BM');
  });
});

describe('BluesMinds billing and brand', () => {
  it('bills at the labelled published-ratio estimate, never the Sonnet fallback; owner rate wins', () => {
    expect(realRateFor('ENGINE_BM', 'openai/gpt-oss-20b')).toEqual(BLUESMINDS_ESTIMATED_RATE);
    expect(realRateFor('ENGINE_BM#2', 'openai/gpt-oss-20b')).toEqual(BLUESMINDS_ESTIMATED_RATE);
    expect(bluesmindsBuilderRate({ BLUESMINDS_BUILDER_RATE_IN: '0.05', BLUESMINDS_BUILDER_RATE_OUT: '0.2' }))
      .toEqual({ rate: { inputPerMTok: 0.05, outputPerMTok: 0.2 }, source: 'configured' });
  });
  it('swaps the supplier name in an error for the neutral label, keeping status words', () => {
    const err = new Error('429 rate limit from api.bluesminds.com (BluesMinds quota)');
    neutraliseBluesmindsName(err);
    expect(err.message).toBe('429 rate limit from ENGINE_BM (ENGINE_BM quota)');
  });
  it('a failing rung throws a brand-neutral error so the chain can fall through', async () => {
    const runner = { plannedModel: 'm', runTurn: async () => { throw new Error('bluesminds upstream timeout'); } };
    const [rung] = bluesmindsBuilderRungs(() => [{ name: 'ENGINE_BM', runner: runner as never }], { FREE_CHAIN_BLUESMINDS_API_KEY: 'k' } as never);
    expect((rung.runner as unknown as { plannedModel: string }).plannedModel).toBe('m');
    await expect(rung.runner.runTurn({} as never)).rejects.toThrow('ENGINE_BM upstream timeout');
  });
});
