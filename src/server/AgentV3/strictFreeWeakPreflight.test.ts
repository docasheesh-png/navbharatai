import { describe, expect, it, vi } from 'vitest';
import { createFreeOutputLimitRecorder, weakAwareEngineReady, engineUnavailableReply } from './strictFreeWeakPreflight';
describe('Weak metadata-only engine preflight', () => {
  it('checks the registry instead of legacy paid availability for strict Weak', async () => {
    const deps = { strictWeakEnabled: () => true, assertFreeTools: vi.fn(async () => {}), legacyAvailable: vi.fn(() => true) };
    expect(await weakAwareEngineReady('weak', deps)).toBe(true);
    expect(deps.assertFreeTools).toHaveBeenCalledWith(32768); expect(deps.legacyAvailable).not.toHaveBeenCalled();
  });
  it('fails closed without consulting the paid ladder', async () => {
    const deps = { strictWeakEnabled: () => true, assertFreeTools: vi.fn(async () => { throw Error('stale'); }), legacyAvailable: vi.fn(() => true) };
    expect(await weakAwareEngineReady('weak', deps)).toBe(false); expect(deps.legacyAvailable).not.toHaveBeenCalled();
  });
  it.each([['weak', false], ['off', true], ['mini', true]] as const)('preserves legacy %s when strict flag=%s', async (tier, flag) => {
    const deps = { strictWeakEnabled: () => flag, assertFreeTools: vi.fn(async () => {}), legacyAvailable: vi.fn(() => false) };
    expect(await weakAwareEngineReady(tier, deps)).toBe(false); expect(deps.legacyAvailable).toHaveBeenCalledWith(tier); expect(deps.assertFreeTools).not.toHaveBeenCalled();
  });
});
describe('per-build output limit observation', () => {
  it('records changes only, ignoring missing, zero and invalid ceilings', () => {
    const record = vi.fn(); const observe = createFreeOutputLimitRecorder(record);
    for (const selectedMaxOutputTokens of [undefined, 0, NaN, 1.5, 4096, 4096, 8192]) observe({ selectedMaxOutputTokens });
    expect(record).toHaveBeenCalledTimes(2); expect(record.mock.calls[0][0].message).toContain('4096'); expect(record.mock.calls[1][0].message).toContain('8192');
  });
  it('has independent request state and isolates observation failures', () => {
    const record = vi.fn(() => { throw Error('log'); });
    const first = createFreeOutputLimitRecorder(record); const second = createFreeOutputLimitRecorder(record);
    expect(() => { first({ selectedMaxOutputTokens: 4096 }); first({ selectedMaxOutputTokens: 4096 }); second({ selectedMaxOutputTokens: 4096 }); }).not.toThrow();
    expect(record).toHaveBeenCalledTimes(2);
  });
});

describe('engine-unavailable response compatibility', () => {
  it('strict Weak refuses without suggesting paid fallback', () => {
    expect(engineUnavailableReply('Weak', true)).toEqual({ code: 'WEAK_ENGINE_UNAVAILABLE', error: 'The free engine is temporarily unavailable. Please try again shortly. No paid fallback was used.' });
  });
  it('legacy Weak keeps its existing response', () => {
    expect(engineUnavailableReply('Weak', false)).toEqual({ code: 'WEAK_ENGINE_UNAVAILABLE', error: 'The free engine is temporarily unavailable. Please try again shortly, or add credits to build on the full engine.' });
  });
  it('Normal and Strong do not depend on the Weak flag', () => {
    for (const tier of ['Normal', 'Strong']) {
      expect(engineUnavailableReply(tier, true)).toEqual(engineUnavailableReply(tier, false));
      expect(engineUnavailableReply(tier, true).code).toBe('ENGINE_UNAVAILABLE');
    }
  });
});
