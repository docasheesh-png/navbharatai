import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlmScopeAsk, SCOPE_PURPOSE } from './scopeAdmission';
import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import { weakAdmissionForTurn, weakForceContinueDecision, recordWeakAdmissionUsage } from '../../AgentV3/weakBuildPreflight';
import { runWithSurplusBuild, runWithInferenceScope, assertLegacyInferenceAllowed } from '../inferencePolicy';
import { createProviderUsageLedger } from '../../AgentV3/ProviderUsageLedger';
import { WEAK_SCOPE_MODEL, admitWeakBuild } from '../../AgentV3/weakBuildAdmission';

const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mock.create } }; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });
function harness(text = 'simple', usage: unknown = { prompt_tokens: 123, completion_tokens: 4 }) {
  vi.stubEnv('GLM_API_KEY', 'synthetic-key');
  vi.stubEnv('AGENTV3_WEAK_SCOPE_POLICY', 'on');
  vi.stubEnv('AGENTV3_GOLDEN_SCAFFOLD', 'off');
  mock.create.mockResolvedValue({ choices: [{ message: { content: text } }], usage });
  const records: Omit<LlmCallRecord, 'ts'>[] = [], observe = vi.fn();
  const ask = createGlmScopeAsk(records, observe);
  const classify = () => weakAdmissionForTurn({ prompt: 'PRIVATE_REQUEST', intent: 'new_build', importing: false, tier: 'weak' }, ask);
  return { records, observe, ask, classify };
}
describe('independent GLM scope recording', () => {
  it.each(['simple', 'complex', 'strong', 'PRIVATE_INVALID'])('records %s accurately and preserves coding policy', async text => {
    const h = harness(text);
    await runWithSurplusBuild(true, async () => {
      const result = await h.classify();
      expect(result).toMatchObject({ scope: text === 'PRIVATE_INVALID' ? null : text, usage: { inputTokens: 123, outputTokens: 4 } });
      expect(weakForceContinueDecision(false, 'weak', result).blocked).toBe(['strong', 'PRIVATE_INVALID'].includes(text));
      expect(weakForceContinueDecision(true, 'weak', result).blocked).toBe(false);
      expect(() => assertLegacyInferenceAllowed('glm')).toThrow();
      const ledger = createProviderUsageLedger();
      recordWeakAdmissionUsage(result, usage => ledger.add('GLM', usage, WEAK_SCOPE_MODEL));
      expect(ledger.byProvider()).toEqual({ GLM: { inputTokens: 123, outputTokens: 4 } });
    });
    expect(h.records).toMatchObject([{ provider: 'GLM', model: WEAK_SCOPE_MODEL, ok: true, inputTokens: 123, outputTokens: 4, promptPreview: SCOPE_PURPOSE, responsePreview: '' }]);
    expect(JSON.stringify(h.records)).not.toContain('PRIVATE');
    expect(h.observe).toHaveBeenCalledOnce();
  });
  it('retains a truncated answer finish reason and measured usage without admitting invalid scope', async () => {
    const h = harness();
    mock.create.mockResolvedValue({ choices: [{ message: { content: 'This request is' }, finish_reason: 'length' }], usage: { prompt_tokens: 123, completion_tokens: 8 } });
    const result = await runWithSurplusBuild(true, h.classify);
    expect(result).toMatchObject({ scope: null, failure: { reason: 'invalid_scope' }, usage: { inputTokens: 123, outputTokens: 8 } });
    expect(h.records).toMatchObject([{ ok: true, finishReason: 'length', inputTokens: 123, outputTokens: 8 }]);
    expect(weakForceContinueDecision(false, 'weak', result).blocked).toBe(true);
  });
  it('fails closed without recovering or naming a Surplus failure', async () => {
    const h = harness();
    mock.create.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'));
    const result = await runWithSurplusBuild(true, h.classify);
    expect(result).toMatchObject({ scope: null, source: 'unavailable', failure: { stage: 'classification', reason: 'classifier_failed' } });
    expect(weakForceContinueDecision(false, 'weak', result).blocked).toBe(true);
    expect(weakForceContinueDecision('true', 'weak', result).blocked).toBe(true);
    expect(h.records).toMatchObject([{ ok: false, provider: 'unknown', error: 'Build scope classification failed' }]);
    expect(h.records[0].inputTokens).toBeUndefined();
    expect(JSON.stringify(h.observe.mock.calls)).not.toMatch(/PRIVATE|SURPLUS/);
  });
  it('does not invent measured usage or permit a throwing audit to change the verdict', async () => {
    const h = harness('complex', null);
    h.observe.mockImplementation(() => { throw new Error('audit unavailable'); });
    expect(await h.classify()).toMatchObject({ scope: 'complex' });
    expect(h.records[0].inputTokens).toBeUndefined();
    expect(h.records[0].outputTokens).toBeUndefined();
  });
  it('keeps strict-free fences in force even when Surplus is admitted', async () => {
    const h = harness();
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true');
    const result = await runWithInferenceScope('free-modules', () => runWithSurplusBuild(true, h.classify));
    expect(result?.scope).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('retains the bounded deadline and unavailable outcome', async () => {
    vi.useFakeTimers();
    const h = harness();
    mock.create.mockImplementation((_params, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = runWithSurplusBuild(true, () => admitWeakBuild('request', h.ask));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ scope: null, failure: { stage: 'deadline', reason: 'scope_timeout' } });
    expect(h.records).toMatchObject([{ ok: false }]);
    expect(mock.create).toHaveBeenCalledOnce();
  });
  it.each([
    { intent: 'chat', importing: false, tier: 'weak' },
    { intent: 'new_build', importing: true, tier: 'weak' },
    { intent: 'new_build', importing: false, tier: 'mini' },
  ])('keeps non-classified turns unchanged: %j', async input => {
    const h = harness();
    expect(await weakAdmissionForTurn({ prompt: 'request', ...input }, h.ask)).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
    expect(h.records).toEqual([]);
  });
});
