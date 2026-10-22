import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { issueVerifiedFreeProof } from '../src/server/AI/LiveRegistry/proof';
import { buildTurnRunner, decideBuildBilledUsd, selectReviewJudge } from '../src/server/routes/agentv3';
import { VerifiedFreeToolRunner } from '../src/server/AgentV3/providers/VerifiedFreeToolRunner';
import * as runtime from '../src/server/AI/LiveRegistry/runtime';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function fixture() {
  const usage = { inputTokens: 1000, outputTokens: 100 };
  const proof = issueVerifiedFreeProof({ modelId: 'v/test:free', ...usage, registryVersion: 'v', verifiedAt: 1, basis: 'explicit-zero-fees', estimatedInferenceUsd: '0', reportedCost: '0' });
  const ledger = createProviderUsageLedger(); ledger.add('OPENROUTER', { ...usage, pricingProof: proof }, proof.modelId);
  return { ledger, usage };
}
describe('Weak strict-free settlement', () => {
  it('does not bill proven free inference at legacy Sonnet rates', () => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'off'); vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    const { ledger, usage } = fixture(); const result = decideBuildBilledUsd(ledger, usage, 'weak');
    expect(result.realCostUsd).toBe(0); expect(result.effectiveBilledUsd).toBe(0);
  });
  it('keeps sandbox charges separate and never gifts an allowance', () => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'off'); vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    const { ledger, usage } = fixture(); const result = decideBuildBilledUsd(ledger, usage, 'weak', undefined, undefined, 0.25);
    expect(result.realCostUsd).toBe(0); expect(result.sandboxUsd).toBe(0.25); expect(result.effectiveBilledUsd).toBe(1);
  });
  it.each(['off', 'mini'] as const)('does not change the %s paid tier bill', tier => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'off'); const { ledger, usage } = fixture();
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'false'); const before = decideBuildBilledUsd(ledger, usage, tier);
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); const after = decideBuildBilledUsd(ledger, usage, tier);
    expect(after).toEqual(before);
  });
});

describe('Weak runner selection has no legacy ladder', () => {
  it.each([{ tier: 'weak' }, { tier: 'weak', plan: true }, { tier: 'weak', heal: true }, { tier: 'weak', complex: true }])('uses the registry for %j', opts => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    expect(buildTurnRunner(opts)).toBeInstanceOf(VerifiedFreeToolRunner);
  });
  it.each(['off', 'mini'])('does not select the free runner for paid tier %s', tier => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    expect(buildTurnRunner({ tier })).not.toBeInstanceOf(VerifiedFreeToolRunner);
  });
  it('leaves the old Weak ladder intact when disabled', () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'false');
    expect(buildTurnRunner({ tier: 'weak' })).not.toBeInstanceOf(VerifiedFreeToolRunner);
  });
});

it('records the actual free review model and forwards its receipt without a paid judge', async () => {
  vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
  const { ledger } = fixture(); const proof = ledger.entries()[0].pricingProof!;
  const dispatch = vi.spyOn(runtime, 'strictFreeText').mockResolvedValue({ content: '{"verdict":"pass"}', model: proof.modelId, provider: 'OPENROUTER', usage: { inputTokens: 1000, outputTokens: 100 }, pricingProof: proof });
  const sink = vi.fn(); const judge = selectReviewJudge('paid', 'weak', sink);
  await judge.runTurn({ model: 'ignored-paid-model', system: 'rules', messages: [{ role: 'user', content: 'files' }], maxTokens: 2048, tools: [] });
  expect(dispatch).toHaveBeenCalledOnce(); expect(judge.chain.attempts()).toEqual([{ kind: 'openrouter', modelId: proof.modelId, ok: true }]);
  expect(sink.mock.calls[0][0].pricingProof).toBe(proof);
});

it('does not repeat a completed free review when its observer throws', async () => {
  vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); const { ledger } = fixture(); const proof = ledger.entries()[0].pricingProof!;
  const dispatch = vi.spyOn(runtime, 'strictFreeText').mockResolvedValue({ content: '{"verdict":"pass"}', model: proof.modelId, provider: 'OPENROUTER', usage: { inputTokens: 1000, outputTokens: 100 }, pricingProof: proof });
  const judge = selectReviewJudge('paid', 'weak', () => { throw Error('observation'); });
  await expect(judge.runTurn({ model: 'ignored', system: 'rules', messages: [{ role: 'user', content: 'files' }], maxTokens: 2048, tools: [] })).resolves.toEqual({ text: '{"verdict":"pass"}' });
  expect(dispatch).toHaveBeenCalledOnce();
});
