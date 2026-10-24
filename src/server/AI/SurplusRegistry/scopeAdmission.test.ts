import { describe, expect, it, vi } from 'vitest';
import { createSurplusScopeAsk, SURPLUS_SCOPE_PURPOSE } from './scopeAdmission';
import type { SurplusBuildSession } from './buildSession';
import type { TurnResult } from '../../AgentV3/ClaudeClient';
import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import { evaluateSurplusReceipt, isSurplusReceiptDecision } from './receiptPolicy';

const receipt = evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding: {} as never,
  disposition: 'unknown', receipt: null, tariff: null, now: 1 });
function outcome(): TurnResult {
  return { text: 'PRIVATE_RESPONSE', rawContent: ['PRIVATE_RAW_CONTENT'], toolUses: [], stopReason: 'end_turn', model: 'synthetic-model',
    usage: { inputTokens: 123, outputTokens: 4, surplusReceipt: receipt } };
}
function harness(mode: 'success' | 'failure' | 'after-usage' | 'factory-failure' = 'success') {
  const turns: TurnResult[] = [], records: Omit<LlmCallRecord, 'ts'>[] = [];
  const observe = vi.fn();
  const run = vi.fn();
  const runner = vi.fn((callbacks?: Parameters<SurplusBuildSession['runner']>[0]) => {
    if (mode === 'factory-failure') throw new Error('PRIVATE_FACTORY_ERROR');
    return { runTurn: async (params: unknown) => {
      run(params);
      if (mode === 'failure') throw new Error('PRIVATE_PROVIDER_ERROR');
      const turn = outcome(); callbacks?.onTurnComplete?.(turn, 'SURPLUS');
      if (mode === 'after-usage') throw new Error('PRIVATE_POST_USAGE_ERROR');
      return turn;
    } };
  });
  const session = { model: 'synthetic-model', runner } as unknown as SurplusBuildSession;
  return { turns, records, observe, run, runner, session };
}

describe('recorded Surplus scope admission', () => {
  it('OFF returns the original optional-default path without side effects', () => {
    const h = harness();
    expect(createSurplusScopeAsk(undefined, h.turns, h.records, h.observe)).toBeUndefined();
    expect(h.records).toEqual([]); expect(h.turns).toEqual([]); expect(h.observe).not.toHaveBeenCalled(); expect(h.runner).not.toHaveBeenCalled();
  });
  it('records success, exact response length and measured usage, without retaining prompt or response', async () => {
    const h = harness(), signal = new AbortController().signal;
    const ask = createSurplusScopeAsk(h.session, h.turns, h.records, h.observe)!;
    expect(await ask('PRIVATE_SYSTEM', 'PRIVATE_USER', signal)).toEqual({ text: 'PRIVATE_RESPONSE' });
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ signal, maxTokens: 8, tools: [], model: 'synthetic-model' }));
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ ok: true, provider: 'SURPLUS', model: 'synthetic-model', promptPreview: SURPLUS_SCOPE_PURPOSE,
      promptChars: 26, responsePreview: '', responseChars: 16, inputTokens: 123, outputTokens: 4 });
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]).toMatchObject({ text: '', rawContent: [], toolUses: [] });
    expect(h.turns[0].usage.surplusReceipt).toBe(receipt);
    expect(isSurplusReceiptDecision(h.turns[0].usage.surplusReceipt)).toBe(true);
    expect(JSON.stringify([h.records, h.turns, h.observe.mock.calls])).not.toContain('PRIVATE_');
    expect(h.observe).toHaveBeenCalledTimes(1);
  });
  it.each(['failure', 'after-usage', 'factory-failure'] as const)('records and audits %s even with no later build report, then rethrows', async mode => {
    const h = harness(mode);
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe)!('PRIVATE_SYSTEM', 'PRIVATE_USER')).rejects.toThrow('PRIVATE_');
    expect(h.records).toHaveLength(1); expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.records[0]).toMatchObject({ ok: false, responsePreview: '', error: 'Build scope classification failed' });
    expect(JSON.stringify([h.records, h.turns, h.observe.mock.calls])).not.toContain('PRIVATE_');
    expect(h.turns).toHaveLength(mode === 'after-usage' ? 1 : 0);
    if (mode === 'after-usage') expect(h.records[0]).toMatchObject({ inputTokens: 123, outputTokens: 4, responseChars: 16 });
  });
  it('an audit failure cannot lose the receipt or prevent the classifier answer', async () => {
    const h = harness(); h.observe.mockImplementation(() => { throw new Error('audit unavailable'); });
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe)!('system', 'user')).resolves.toEqual({ text: 'PRIVATE_RESPONSE' });
    expect(h.records).toHaveLength(1); expect(h.turns[0].usage.surplusReceipt).toBe(receipt);
  });
});
