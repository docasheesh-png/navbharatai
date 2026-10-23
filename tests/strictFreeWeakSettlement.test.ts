import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { buildTurnRunner, decideBuildBilledUsd } from '../src/server/routes/agentv3';
import { registryConfig } from '../src/server/AI/LiveRegistry/runtime';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Pro App Builder is restored independently of Free rollout', () => {
  it.each(['weak', 'off', 'mini'] as const)('retired flag cannot alter %s billing', tier => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'off');
    const ledger = createProviderUsageLedger(); const usage = { inputTokens: 1000, outputTokens: 100 };
    ledger.add('GLM', usage, 'glm-4.7');
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'false'); const before = decideBuildBilledUsd(ledger, usage, tier, undefined, undefined, 0.25);
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); const after = decideBuildBilledUsd(ledger, usage, tier, undefined, undefined, 0.25);
    expect(after).toEqual(before); expect(after.sandboxUsd).toBe(0.25);
  });
  it.each([{ tier: 'weak' }, { tier: 'weak', plan: true }, { tier: 'weak', heal: true }, { tier: 'weak', complex: true }, { tier: 'off' }, { tier: 'mini' }])('preserves old runner class and chain for %j', opts => {
    const beforeChain = vi.fn(); const afterChain = vi.fn();
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'false'); const before = buildTurnRunner({ ...opts, onChain: beforeChain });
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); const after = buildTurnRunner({ ...opts, onChain: afterChain });
    expect(after.constructor).toBe(before.constructor); expect(afterChain.mock.calls).toEqual(beforeChain.mock.calls);
  });
  it('ignores retired flag even when every Free rollout is enabled', () => {
    vi.stubEnv('LIVE_MODEL_REGISTRY_ENABLED', 'true'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    expect(registryConfig()).toMatchObject({ enabled: true, strictFreeModulesEnabled: true, strictFreeWeakEnabled: false });
  });
  it('has no free-registry builder branch and preserves owner earliest-render proof', () => {
    const source = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    for (const removed of ['strictFreeWeakEnabled', 'VerifiedFreeToolRunner', 'assertStrictFreeToolAvailable', 'strictFreeText']) expect(source).not.toContain(removed);
    expect(source).toContain('earliestRenderProof(billingCtx.appFirstRenderedAt, inBuildGreenAt)');
    expect(source).toContain('earliestRenderProof(billingCtx.appFirstRenderedAt)');
  });
});
