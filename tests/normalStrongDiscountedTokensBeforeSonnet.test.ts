// Owner 2026-11-17 ("apke sabhi suggestion approved"): DiscountedTokens on NORMAL and STRONG, right before the first
// Sonnet/Opus rung, trying up to three of its own models (cheapest good first), then the chain moves on. Never Weak.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTierEngineAvailable, buildTurnRunner } from '../src/server/routes/agentv3';
import {
  beforeFirstClaudeRung, discountedTokensBuilderEnabled, discountedTokensBuilderMissing, discountedTokensBuilderModels,
  discountedTokensBuilderRungs, neutraliseDiscountedTokensName,
} from '../src/server/AgentV3/discountedTokensBuilder';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { OFF_LADDER_PROVIDERS } from '../src/server/AgentV3/ladderDepth';
import { hasProviderLeak, redactProviderError } from '../src/server/lib/providerRedaction';
import { scrubVendorBrandsInPayload } from '../src/shared/brandScrub';

const READY = { DISCOUNTEDTOKENS_API_KEY: 'synthetic-dt-key', DISCOUNTEDTOKENS_BUILDER_RATE_IN: '0.8', DISCOUNTEDTOKENS_BUILDER_RATE_OUT: '3.2', DISCOUNTEDTOKENS_MODEL: 'gpt-6-luna,gpt-6-sol' };
beforeEach(() => {
  for (const [k, v] of Object.entries(READY)) vi.stubEnv(k, v);
  vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_ENABLED', '');
  vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
  vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-anthropic-key');
  vi.stubEnv('AGENTV3_LADDER_NORMAL', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code-highspeed,CLAUDE:sonnet');
  vi.stubEnv('AGENTV3_LADDER_STRONG', 'GLM:glm-5.3,KIMI:kimi-k3,CLAUDE:sonnet,CLAUDE_OPUS:opus');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-6-sol' }, { id: 'gpt-6-astra' }] }), { status: 200 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const chain = (tier: string) => {
  let names: string[] = [];
  buildTurnRunner({ tier, onChain: (rungs) => { names = rungs.map((r) => r.name); } });
  return names;
};

describe('where it sits', () => {
  it('admits Normal and Strong when their only configured engine is DiscountedTokens', () => {
    for (const key of ['GLM_API_KEY', 'KIMI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NEMOTRON_API_KEY', 'ROUTER_ONE_API_KEY', 'QUBAX_API_KEY', 'FREE_CHAIN_BLUESMINDS_API_KEY', 'MOYI_API_KEY']) vi.stubEnv(key, '');
    for (const tier of ['off', 'mini'] as const) {
      expect(chain(tier).every(name => name.startsWith('ENGINE_DT'))).toBe(true);
      expect(chain(tier).length).toBeGreaterThan(0);
      expect(buildTierEngineAvailable(tier)).toBe(true);
    }
    expect(buildTierEngineAvailable('weak')).toBe(false);
    vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_ENABLED', 'off');
    expect(buildTierEngineAvailable('off')).toBe(false);
    expect(buildTierEngineAvailable('mini')).toBe(false);
    vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_ENABLED', '');
    // 2026-11-18: published prices price gpt-6-sol, so no owner rate is needed — but a list naming only unpriced models
    // with no owner rate leaves no runnable model, and the tier is not admitted on it.
    vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_RATE_IN', '');
    expect(buildTierEngineAvailable('off')).toBe(true);
    vi.stubEnv('DISCOUNTEDTOKENS_MODEL', 'gpt-6-luna');
    expect(buildTierEngineAvailable('off')).toBe(false);
    expect(buildTierEngineAvailable('mini')).toBe(false);
  });
  it('Normal and Strong: right before the first Sonnet/Opus rung', () => {
    for (const tier of ['off', 'mini']) {
      const names = chain(tier);
      const dt = names.findIndex((n) => n.startsWith('ENGINE_DT'));
      const claude = names.findIndex((n) => /CLAUDE|ANTHROPIC|SONNET/i.test(n));
      expect(dt, `${tier}: ${names.join(' → ')}`).toBeGreaterThan(0);
      expect(dt).toBeLessThan(claude);
      expect(names.slice(0, dt).some((n) => /KIMI/.test(n))).toBe(true);
    }
  });
  it('never on Weak', () => {
    expect(chain('weak').some((n) => n.startsWith('ENGINE_DT'))).toBe(false);
  });
  it('a ladder without Claude gets it at the end; the position helper is pure', () => {
    expect(beforeFirstClaudeRung([{ provider: 'GLM', model: 'a' }, { provider: 'CLAUDE', model: 'sonnet' }])).toBe(1);
    expect(beforeFirstClaudeRung([{ provider: 'GLM', model: 'a' }])).toBe(1);
  });
});

describe("its own three-model fallback", () => {
  it("the owner's models first (their rate prices them), at most three; one runner per model", () => {
    // Never a model from the key's list — only a model with a known price (published, or the owner's rate).
    expect(discountedTokensBuilderModels({ ...READY, DISCOUNTEDTOKENS_MODEL: 'a,b,c,d' } as never)).toEqual(['a', 'b', 'c']);
    expect(discountedTokensBuilderModels({ DISCOUNTEDTOKENS_API_KEY: 'k', DISCOUNTEDTOKENS_MODEL: 'gpt-6-luna,gpt-5.5' } as never)).toEqual(['gpt-5.5']);
    expect(discountedTokensBuilderModels(READY as never)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    const seen: string[][] = [];
    discountedTokensBuilderRungs((_l, _k, _b, models) => { seen.push(models); return []; }, READY as never);
    expect(seen[0].slice(0, 2)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
  });
  it('with no owner list, the shared rule over its own published prices: strong coding family, cheapest first', () => {
    // From the owner-supplied rates page (2026-11-18): gpt-6-sol and gpt-6.1-sol $0.10/$0.50, gpt-5.6-terra $0.10/$0.60.
    expect(discountedTokensBuilderModels({ DISCOUNTEDTOKENS_API_KEY: 'k' } as never)).toEqual(['gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6-terra']);
  });
});

describe('no invented price, no leaked name', () => {
  it('a key alone is enough (published prices); a list of only unpriced models is not, and says why', () => {
    expect(discountedTokensBuilderEnabled({ DISCOUNTEDTOKENS_API_KEY: 'k' } as never)).toBe(true);
    const env = { DISCOUNTEDTOKENS_API_KEY: 'k', DISCOUNTEDTOKENS_MODEL: 'gpt-6-luna' } as never;
    expect(discountedTokensBuilderEnabled(env)).toBe(false);
    expect(discountedTokensBuilderMissing(env)[0]).toMatch(/priced model/);
    expect(discountedTokensBuilderEnabled({ ...READY, DISCOUNTEDTOKENS_BUILDER_ENABLED: 'off' } as never)).toBe(false);
  });
  it("is billed at the owner's rate when set, else DiscountedTokens' own price — never the Sonnet card", () => {
    expect(realRateFor('ENGINE_DT', 'gpt-6-luna')).toEqual({ inputPerMTok: 0.8, outputPerMTok: 3.2 });
    vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_RATE_IN', '');
    vi.stubEnv('DISCOUNTEDTOKENS_BUILDER_RATE_OUT', '');
    expect(realRateFor('ENGINE_DT', 'gpt-6-astra')).toEqual({ inputPerMTok: 0.5, outputPerMTok: 2.5 });
    expect(OFF_LADDER_PROVIDERS).toContain('ENGINE_DT');
  });
  it('the supplier name and host never reach a user', () => {
    const err = new Error('429 from api.discountedtokens.com (DiscountedTokens quota)');
    neutraliseDiscountedTokensName(err);
    expect(err.message).toBe('429 from ENGINE_DT (ENGINE_DT quota)');
    expect(hasProviderLeak('ENGINE_DT failed')).toBe(true);
    expect(redactProviderError('DiscountedTokens refused the call')).not.toMatch(/discounted/i);
    expect(JSON.stringify(scrubVendorBrandsInPayload({ error: 'ENGINE_DT and DiscountedTokens and moyi-api.com failed' }))).not.toMatch(/ENGINE_DT|discounted|moyi/i);
  });
});
