// Owner 2026-11-17 ("apke sabhi suggestion approved"): Qubax is the third Pro Weak engine —
// Surplus → Router One → Qubax → BluesMinds → Moyi → the tier ladder. Normal and Strong do not change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurnRunner } from '../src/server/routes/agentv3';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { OFF_LADDER_PROVIDERS } from '../src/server/AgentV3/ladderDepth';

beforeEach(() => {
  vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-test-key');
  vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
  vi.stubEnv('ROUTER_ONE_ENABLED', 'on');
  vi.stubEnv('QUBAX_API_KEY', 'synthetic-qubax-key');
  vi.stubEnv('PRO_CHAIN_V2_QUBAX', '');
  vi.stubEnv('QUBAX_BUILDER_MODELS', 'glm-5.3');
  vi.stubEnv('FREE_CHAIN_BLUESMINDS_API_KEY', 'synthetic-bm-key');
  vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', '');
  vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
  vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
  vi.stubEnv('AGENTV3_LADDER_WEAK', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code,GLM:glm-5.3');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":[]}', { status: 200 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const chain = (opts: Partial<Parameters<typeof buildTurnRunner>[0]> = {}) => {
  let names: string[] = [];
  buildTurnRunner({ tier: 'weak', ...opts, onChain: (rungs) => { names = rungs.map((r) => r.name); } });
  return names;
};

describe('Weak: Router One → Qubax → BluesMinds → ladder', () => {
  it.each([{}, { heal: true }, { plan: true }, { complex: true }])('Qubax is third in lane %j', (opts) => {
    expect(chain(opts).slice(0, 3)).toEqual(['ENGINE_R1', 'ENGINE_QX', 'ENGINE_BM']);
  });
  it('without its key, or with its switch off, the old order stands', () => {
    vi.stubEnv('QUBAX_API_KEY', '');
    expect(chain().slice(0, 2)).toEqual(['ENGINE_R1', 'ENGINE_BM']);
    vi.stubEnv('QUBAX_API_KEY', 'synthetic-qubax-key');
    vi.stubEnv('PRO_CHAIN_V2_QUBAX', 'off');
    expect(chain()).not.toContain('ENGINE_QX');
  });
  it('Normal and Strong do not get it', () => {
    let names: string[] = [];
    for (const tier of ['off', 'mini']) {
      buildTurnRunner({ tier, onChain: (rungs) => { names = rungs.map((r) => r.name); } });
      expect(names).not.toContain('ENGINE_QX');
    }
  });
  it('is billed at its own price or a labelled estimate (never the Sonnet fallback), and is off-ladder for the report', () => {
    expect(OFF_LADDER_PROVIDERS).toContain('ENGINE_QX');
    const rate = realRateFor('ENGINE_QX', 'glm-5.3');
    expect(rate).not.toEqual(realRateFor('ANTHROPIC', 'sonnet'));
  });
});
