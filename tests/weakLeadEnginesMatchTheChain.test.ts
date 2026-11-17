/**
 * The admin page's list of engines in front of the Weak ladder (weakLeadEngines.ts) is computed from the same
 * predicates the build chain uses, but in a separate module, because the admin route may not load the build route.
 * This builds the REAL chain and fails if the two ever disagree, in any combination of switches and keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurnRunner } from '../src/server/routes/agentv3';
import { weakLeadEngines } from '../src/server/AgentV3/weakLeadEngines';
import { __resetMoyiModelList } from '../src/server/AgentV3/moyiBuilder';

const chainLeads = () => {
  let names: string[] = [];
  buildTurnRunner({ tier: 'weak', onChain: rungs => { names = rungs.map(r => r.name); } });
  const leads = names.filter(n => /^ENGINE_/.test(n)).map(n => n.replace(/#\d+$/, ''));
  return [...new Set(leads)];
};

beforeEach(() => {
  vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
  vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
  vi.stubEnv('AGENTV3_LADDER_WEAK', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code');
});
afterEach(() => { vi.unstubAllEnvs(); __resetMoyiModelList(); });

describe('🔒 weakLeadEngines names exactly the leads the build chain puts in front of the Weak ladder', () => {
  const combos = [
    { r1: 'on', bm: 'on', moyi: true },
    { r1: 'on', bm: 'off', moyi: true },
    { r1: 'off', bm: 'on', moyi: false },
    { r1: 'off', bm: 'off', moyi: false },
    { r1: 'on', bm: 'on', moyi: false },
  ];
  it.each(combos)('Router One %s', ({ r1, bm, moyi }) => {
    vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-r1-key');
    vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
    vi.stubEnv('ROUTER_ONE_ENABLED', r1);
    vi.stubEnv('FREE_CHAIN_BLUESMINDS_API_KEY', 'synthetic-bm-key');
    vi.stubEnv('BLUESMINDS_BUILDER_ENABLED', bm);
    vi.stubEnv('MOYI_API_KEY', moyi ? 'synthetic-moyi-key' : '');
    vi.stubEnv('MOYI_BUILDER_MODEL', moyi ? 'grok-4.7' : '');
    vi.stubEnv('SURPLUS_API_KEY', '');
    const listed = weakLeadEngines().map(e => e.name).filter(n => n !== 'SURPLUS');
    expect(listed).toEqual(chainLeads());
  });
});
