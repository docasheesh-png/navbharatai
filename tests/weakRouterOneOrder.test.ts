import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTurnRunner, buildChainOpensPastOpener, weakGlmFirst } from '../src/server/routes/agentv3';
import { routerOneWeakFallbackEnabled, routerOnePinnedForTier } from '../src/server/AI/RouterOne/routerOne';
import { surplusFallbackDisabledForTier } from '../src/server/AI/SurplusRegistry/surplusNoFallback';
import { weakScopeAsk } from '../src/server/AI/RouterOne/admission';
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../src/server/lib/buildEngineError';
import type { SurplusBuildSession } from '../src/server/AI/SurplusRegistry/buildSession';
import { CanarySpendBlocked } from '../src/server/AgentV3/reliability/canarySpendGuard';

beforeEach(() => {
  vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-test-key');
  vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
  vi.stubEnv('ROUTER_ONE_ENABLED', 'on');
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
describe('Weak Surplus → Router One → GLM → existing tail', () => {
  it.each([{}, { heal: true }, { plan: true }, { complex: true }])('does not bypass prefix in lane %j', opts => {
    const names = chain(opts);
    expect(names[0]).toBe('ENGINE_R1');
    expect(buildChainOpensPastOpener('weak', true)).toBe(false);
    expect(names[1]).toBe('GLM');
    expect(names.filter(n => n === 'ENGINE_R1')).toHaveLength(1);
  });
  it('preserves existing tail and distinct GLM models without duplicating the opener', () => {
    expect(weakGlmFirst([{ provider: 'KIMI', model: 'k' }, { provider: 'GLM', model: 'g' }, { provider: 'GLM', model: 'g' }, { provider: 'GLM', model: 'g2' }]))
      .toEqual([{ provider: 'GLM', model: 'g' }, { provider: 'KIMI', model: 'k' }, { provider: 'GLM', model: 'g2' }]);
    expect(chain()).toEqual(['ENGINE_R1', 'GLM', 'KIMI', 'GLM']);
    vi.stubEnv('AGENTV3_LADDER_WEAK', 'KIMI:kimi-k2.7-code');
    expect(chain()).toEqual(['ENGINE_R1', 'GLM', 'KIMI']);
  });
  it('keeps Normal/Strong routing unchanged and honors explicit disable/missing key', () => {
    expect(chain({ tier: 'off' })).not.toContain('ENGINE_R1');
    expect(chain({ tier: 'mini' })).not.toContain('ENGINE_R1');
    expect(routerOneWeakFallbackEnabled({ ROUTER_ONE_API_KEY: 'key' })).toBe(true);
    expect(routerOneWeakFallbackEnabled({ ROUTER_ONE_API_KEY: 'key', ROUTER_ONE_ENABLED: 'off' })).toBe(false);
    expect(routerOneWeakFallbackEnabled({})).toBe(false);
    vi.stubEnv('ROUTER_ONE_ENABLED', 'off');
    expect(chain()[0]).toBe('GLM');
  });
  it('retired profile pins stay retired in every band', () => {
    expect(routerOnePinnedForTier('weak', 'z@gmail.com')).toBe(false);
    expect(surplusFallbackDisabledForTier('weak', 'z@gmail.com')).toBe(false);
    expect(routerOnePinnedForTier('off', 'z@gmail.com')).toBe(false);
    expect(surplusFallbackDisabledForTier('off', 'z@gmail.com')).toBe(false);
    expect(chain({ surplusPreWriteFailOpen: { state: { dropped: false }, userFilesWritten: () => 0, routerOneOnly: true } })).toEqual(['ENGINE_R1', 'GLM', 'KIMI', 'GLM']);
  });
  it('admitted Surplus stays first and constructs no fallback on success', async () => {
    const result = { text: 'ok', toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } };
    const runTurn = vi.fn().mockResolvedValue(result), onChain = vi.fn();
    const session = { runner: () => ({ runTurn }) } as unknown as SurplusBuildSession;
    const runner = buildTurnRunner({ tier: 'weak', surplusSession: session, onChain,
      surplusPreWriteFailOpen: { state: { dropped: false }, userFilesWritten: () => 0 } });
    expect(await runner.runTurn({} as never)).toBe(result);
    expect(onChain).not.toHaveBeenCalled();
  });
  it('Surplus failure constructs the guarded Router One/GLM chain, and abort prevents dispatch', async () => {
    const controller = new AbortController();
    const session = { runner: () => ({ runTurn: async () => { throw new PublicBuildEngineError(); } }) } as unknown as SurplusBuildSession;
    const names: string[][] = [];
    const state = { dropped: false };
    const runner = buildTurnRunner({ tier: 'weak', surplusSession: session,
      surplusPreWriteFailOpen: { state, userFilesWritten: () => 2 },
      onChain: rungs => { names.push(rungs.map(r => r.name)); controller.abort(); } });
    await expect(runner.runTurn({ signal: controller.signal } as never)).rejects.toThrow();
    expect(state.dropped).toBe(true);
    expect(names).toEqual([['ENGINE_R1', 'GLM', 'KIMI', 'GLM']]);
  });
  it('classification falls through eligible errors in order and stops on guard refusal', async () => {
    const order: string[] = [];
    const surplus = vi.fn(async () => { order.push('surplus'); throw new PublicBuildEngineError(PUBLIC_BUILD_ENGINE_UNAVAILABLE); });
    const router = vi.fn(async () => { order.push('router'); throw new Error('unavailable'); });
    const glm = vi.fn(async () => { order.push('glm'); return { text: 'simple' }; });
    const drop = vi.fn();
    await expect(weakScopeAsk(surplus, router, glm, drop)('s', 'u', new AbortController().signal)).resolves.toEqual({ text: 'simple' });
    expect(order).toEqual(['surplus', 'router', 'glm']); expect(drop).toHaveBeenCalledOnce();
    glm.mockClear();
    const blocked = vi.fn(async () => { throw new CanarySpendBlocked('test'); });
    await expect(weakScopeAsk(undefined, blocked, glm, drop)('s', 'u', new AbortController().signal)).rejects.toThrow();
    expect(glm).not.toHaveBeenCalled();
  });
});
