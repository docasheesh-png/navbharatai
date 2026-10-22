import { afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}) }));
vi.mock('../../AI/LiveRegistry/runtime', () => ({ strictFreeToolTurn: vi.fn() }));
import { VerifiedFreeToolRunner } from './VerifiedFreeToolRunner';
import { issueVerifiedFreeProof } from '../../AI/LiveRegistry/proof';
import type { FreeToolRequest } from '../../AI/LiveRegistry/dispatcher';
import type { RunTurnParams } from '../ClaudeClient';
const params: RunTurnParams = { system: 'system', messages: [{ role: 'user', content: 'Make a page' }], tools: [{ name: 'write_file', description: 'write', input_schema: { type: 'object', properties: {} } }], maxTokens: 32768 };
const receipt = issueVerifiedFreeProof({ modelId: 'v/test:free', inputTokens: 10, outputTokens: 20, registryVersion: 'v1', verifiedAt: 1, basis: 'explicit-zero-fees', estimatedInferenceUsd: '0', reportedCost: '0' });
const answer = () => ({ content: 'Here', toolCalls: [{ id: 'call1', name: 'write_file', arguments: '{"path":"a.ts"}' }], finishReason: 'tool_calls' as const, selectedMaxOutputTokens: 4096, model: 'v/test:free', provider: 'OPENROUTER' as const, usage: { inputTokens: 10, outputTokens: 20 }, pricingProof: receipt });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('VerifiedFreeToolRunner', () => {
  it('adapts real tool history and preserves exact model/proof and max output', async () => {
    const dispatch = vi.fn(async (_input: FreeToolRequest) => answer()); const observed = vi.fn(); const text = vi.fn();
    const runner = new VerifiedFreeToolRunner({ onTurnComplete: observed }, dispatch);
    const result = await runner.runTurn({ ...params, onText: text });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 32768, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'Make a page' }], tools: [{ type: 'function', function: { name: 'write_file' } }] });
    expect(result.selectedMaxOutputTokens).toBe(4096);
    expect(result.usage.selectedMaxOutputTokens).toBe(4096);
    expect(result.model).toBe('v/test:free'); expect(result.usage.pricingProof).toBe(receipt);
    expect(result.toolUses[0]).toMatchObject({ id: 'call1', name: 'write_file', input: { path: 'a.ts' } });
    expect(observed.mock.calls[0][1].pricingProof).toBe(receipt); expect(text).toHaveBeenCalledWith('Here');
  });
  it.each(['true', 'false'])('preserves truncation without making partial content executable (resume=%s)', async enabled => {
    vi.stubEnv('AGENTV3_RESUME_TRUNCATED', enabled);
    const dispatch = vi.fn(async () => ({ ...answer(), finishReason: 'length' as const, toolCalls: [{ id: 'cut', name: 'write_file', arguments: '{"path":"a.ts","content":"unfinished' }] }));
    const result = await new VerifiedFreeToolRunner({}, dispatch).runTurn(params);
    expect(result.truncated).toBe(true); expect(result.toolUses[0].input).toMatchObject({ path: 'a.ts' });
    expect(result.toolUses[0].input).not.toHaveProperty('content'); expect(dispatch).toHaveBeenCalledOnce();
  });
  it('does not retry when observation callbacks throw', async () => {
    const dispatch = vi.fn(async () => answer()); const fail = () => { throw Error('observer'); };
    const result = await new VerifiedFreeToolRunner({ onProviderUsed: fail, onTurnComplete: fail }, dispatch).runTurn(params);
    expect(result.text).toBe('Here'); expect(dispatch).toHaveBeenCalledOnce();
  });
  it('does not use a paid fallback when registry dispatch fails', async () => {
    const dispatch = vi.fn(async () => { throw Error('NO_VERIFIED_FREE_MODEL'); });
    await expect(new VerifiedFreeToolRunner({}, dispatch).runTurn(params)).rejects.toThrow('NO_VERIFIED_FREE_MODEL');
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('does not dispatch after the deadline', async () => {
    const dispatch = vi.fn(async () => answer());
    await expect(new VerifiedFreeToolRunner({}, dispatch).runTurn({ ...params, deadlineAt: Date.now() - 1 })).rejects.toThrow('deadline');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('does not dispatch an already cancelled request', async () => {
    const dispatch = vi.fn(async () => answer()); const signal = AbortSignal.abort();
    await expect(new VerifiedFreeToolRunner({}, dispatch).runTurn({ ...params, signal })).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
