import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDiagnostic, type DiagnosticDependencies } from './providerDiagnosticRunner';
import { DiagnosticAdmissionError, type DiagnosticRunRecord } from './providerDiagnosticStore';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
const input = { provider: 'surplus' as const, idempotencyKey: '11111111-1111-4111-8111-111111111111', prompt: 'private prompt' };
const record = { runId: input.idempotencyKey, provider: 'surplus', model: 'test', startedAt: 1000, state: 'reserved' } as DiagnosticRunRecord;
function setup() {
  const call = vi.fn().mockResolvedValue({ text: 'hello', usage: { inputTokens: 3, outputTokens: 2, cachedTokens: null }, amount: '0.000001' });
  const deps: DiagnosticDependencies = { store: { claimDispatch: vi.fn().mockResolvedValue(true), read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue({ mayDispatch: true, run: record }), finish: vi.fn().mockResolvedValue(undefined) }, adapter: vi.fn(() => ({ model: 'test', call })), verifyAdmission: vi.fn().mockResolvedValue(undefined) };
  return { deps, call };
}
afterEach(() => vi.useRealTimers());
describe('single provider diagnostics', () => {
  it.each(['surplus', 'cheaperinference'] as const)('dispatches only %s once and settles exact supplier cost', async provider => {
    const { deps, call } = setup(); const r = await runDiagnostic({ ...input, provider }, deps);
    expect(deps.adapter).toHaveBeenCalledExactlyOnceWith(provider, undefined); expect(call).toHaveBeenCalledOnce();
    expect(r.text).toBe('hello'); expect(r.supplierCost).toEqual({ status: 'reported', amount: '0.000001', currency: 'USD' });
    expect(deps.store.finish).toHaveBeenCalledWith(input.idempotencyKey, record.runId, 1000);
    expect(r.firstTokenMs).toBeNull(); expect(r.outputTokensPerSecond).toBeNull(); expect(r.retryCount).toBe(0);
  });
  it('does not dispatch a replay even with expired evidence', async () => {
    const { deps, call } = setup(); vi.mocked(deps.store.read).mockResolvedValue(record);
    const r = await runDiagnostic(input, deps); expect(r.replayed).toBe(true); expect(r.runId).toBe(record.runId); expect(r.text).toBeNull();
    expect(call).not.toHaveBeenCalled(); expect(deps.verifyAdmission).not.toHaveBeenCalled();
  });
  it('honors atomic admission replay', async () => {
    const { deps, call } = setup(); vi.mocked(deps.store.reserve).mockResolvedValue({ mayDispatch: false, run: record });
    expect((await runDiagnostic(input, deps)).replayed).toBe(true); expect(call).not.toHaveBeenCalled();
  });
  it('blocks missing evidence before reservation or network', async () => {
    const { deps, call } = setup(); vi.mocked(deps.verifyAdmission).mockRejectedValue(new DiagnosticAdmissionError('budget_evidence_unavailable'));
    expect((await runDiagnostic(input, deps)).timeline[0].reason).toBe('budget_evidence_unavailable');
    expect(deps.store.reserve).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it.each([['AUTH', 401, 'authentication_rejected'], ['RATE_LIMIT', 429, 'rate_limited'], ['NETWORK', undefined, 'network_error'], ['SERVER', 503, 'provider_error'], ['EMPTY_RESPONSE', undefined, 'malformed_response']] as const)('reports evidenced %s safely', async (code, status, reason) => {
    const { deps, call } = setup(); call.mockRejectedValue(new FreeChainProviderError(code, { status }));
    const r = await runDiagnostic(input, deps); expect(r.timeline[0]).toMatchObject({ reason });
    expect(r.supplierCost.status).toBe('unavailable'); expect(r.accounting).toBe('unknown_liability'); expect(call).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain(input.prompt); expect(deps.store.finish).toHaveBeenCalledWith(input.idempotencyKey, record.runId, null);
  });
  it('does not impose a diagnostic deadline or retry a slow request', async () => {
    vi.useFakeTimers(); const { deps, call } = setup();
    let resolve!: (value: unknown) => void;
    call.mockImplementation(() => new Promise(r => { resolve = r; }));
    let finished = false;
    const pending = runDiagnostic(input, deps).then(r => { finished = true; return r; });
    await vi.advanceTimersByTimeAsync(60001); expect(finished).toBe(false);
    resolve({ text: 'late reply', usage: { inputTokens: null, outputTokens: null, cachedTokens: null }, amount: null });
    const r = await pending; expect(r.text).toBe('late reply'); expect(call).toHaveBeenCalledOnce();
  });
  it('never exposes raw errors or fabricates zero cost', async () => {
    const { deps, call } = setup(); call.mockRejectedValue(new Error('Bearer secret private prompt'));
    const r = await runDiagnostic(input, deps); expect(JSON.stringify(r)).not.toMatch(/secret|Bearer|private prompt/); expect(r.supplierCost.status).toBe('unavailable');
  });
  it('retains uncertainty when accounting acknowledgement is lost', async () => {
    const { deps } = setup(); vi.mocked(deps.store.finish).mockRejectedValue(new Error('secret'));
    const r = await runDiagnostic(input, deps); expect(r.accounting).toBe('unknown_liability'); expect(r.timeline.at(-1)?.reason).toBe('accounting_failed');
  });
});
it('preserves recovery requirement after uncertain reservation acknowledgement', async () => {
  const { deps, call } = setup(); vi.mocked(deps.store.reserve).mockRejectedValue(new Error('lost acknowledgement'));
  const r = await runDiagnostic(input, deps); expect(r.accounting).toBe('unknown_liability'); expect(call).not.toHaveBeenCalled();
});

it('uses the explicitly submitted manual prompt', async () => {
  const { deps, call } = setup();
  await runDiagnostic(input, deps);
  expect(call).toHaveBeenCalledExactlyOnceWith(input.prompt, expect.any(AbortSignal));
});

it('Surplus diagnostics use configured endpoint without catalog, discount, or output cap', async () => {
  const { diagnosticAdapter } = await import('./providerDiagnosticRunner');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { buyer_cost_micro: 1 } }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const env = { SURPLUS_API_KEY: 'mock-only', SURPLUS_BASE_URL: 'https://api.surplusintelligence.ai/v1' };
    await diagnosticAdapter('surplus', env).call('Reply with exactly: OK', new AbortController().signal);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.surplusintelligence.ai/v1/chat/completions');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('max_tokens');
    await diagnosticAdapter('surplus', env).call('ordinary', new AbortController().signal);
    expect(String(fetcher.mock.calls[1][0])).toBe('https://api.surplusintelligence.ai/v1/chat/completions');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});

it('CheaperInference sends one direct request without pricing or output constraints', async () => {
  const { diagnosticAdapter } = await import('./providerDiagnosticRunner');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 }, billing: { status: 'settled', currency: 'USD', billed_cost_usd: '0.000001' } }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    await diagnosticAdapter('cheaperinference', { CHEAPERINFERENCE_API_KEY: 'mock-only', CHEAPERINFERENCE_MODEL: 'beam' }, true).call('Reply with exactly: OK', new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent).not.toHaveProperty('max_tokens'); expect(sent).not.toHaveProperty('min_discount_percent');
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.cheaperinference.com/v1/chat/completions');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: 'beam', reasoning: { effort: 'none' }, stream: false });
  } finally { vi.unstubAllGlobals(); }
});

it('passes chosen output limit into both provider adapter and durable admission', async () => {
  const { deps } = setup();
  await runDiagnostic({ ...input, maxOutputTokens: 1024 }, deps);
  expect(deps.adapter).toHaveBeenCalledWith('surplus', 1024);
  expect(deps.verifyAdmission).toHaveBeenCalledWith('surplus', 'test', 1024);
  expect(deps.store.reserve).toHaveBeenCalledWith(input.idempotencyKey, 'surplus', 'test', 1024);
});

it('a disable after reservation blocks dispatch and preserves the hold without a fake receipt', async () => {
  const { deps, call } = setup(); vi.mocked(deps.store.claimDispatch).mockResolvedValue(false);
  const r = await runDiagnostic(input, deps);
  expect(r.timeline.at(-1)).toMatchObject({ stage: 'dispatch', reason: 'diagnostics_disabled' });
  expect(call).not.toHaveBeenCalled(); expect(deps.store.finish).not.toHaveBeenCalled();
  expect(r.accounting).toBe('reserved'); expect(r.supplierCost.status).toBe('unavailable');
});
it('an unavailable final control read never dispatches or releases the hold', async () => {
  const { deps, call } = setup(); vi.mocked(deps.store.claimDispatch).mockRejectedValue(new Error('unavailable'));
  const r = await runDiagnostic(input, deps);
  expect(call).not.toHaveBeenCalled(); expect(deps.store.finish).not.toHaveBeenCalled();
  expect(r.timeline.at(-1)?.reason).toBe('accounting_failed');
});

it('reports expired final claim as budget evidence failure without dispatch or hold release', async () => {
  const { deps, call } = setup();
  vi.mocked(deps.store.claimDispatch).mockRejectedValue(new DiagnosticAdmissionError('budget_evidence_unavailable'));
  const r = await runDiagnostic(input, deps);
  expect(r.timeline.at(-1)).toMatchObject({ stage: 'dispatch', reason: 'budget_evidence_unavailable' });
  expect(call).not.toHaveBeenCalled(); expect(deps.store.finish).not.toHaveBeenCalled();
});

it('a delayed final claim acknowledgement cannot dispatch after pricing expiry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const { deps, call } = setup();
  vi.mocked(deps.store.reserve).mockResolvedValue({ mayDispatch: true, run: { ...record, dispatchBefore: 2000 } });
  vi.mocked(deps.store.claimDispatch).mockImplementation(async () => { vi.setSystemTime(2001); return true; });
  const r = await runDiagnostic(input, deps);
  expect(r.timeline.at(-1)).toMatchObject({ stage: 'dispatch', reason: 'budget_evidence_unavailable' });
  expect(call).not.toHaveBeenCalled(); expect(deps.store.finish).not.toHaveBeenCalled();
});

it.each(['surplus', 'cheaperinference'] as const)('honors an explicit legacy output setting for %s without imposing a default', async provider => {
  const { diagnosticAdapter } = await import('./providerDiagnosticRunner');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    await diagnosticAdapter(provider, { SURPLUS_API_KEY: 'mock-only', CHEAPERINFERENCE_API_KEY: 'mock-only' }, false, 10000).call('x'.repeat(70000), new AbortController().signal);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).max_tokens).toBe(10000);
  } finally { vi.unstubAllGlobals(); }
});


describe('monotonic slow-call evidence', () => {
  function timed() {
    const fixture = setup(); let ms = 0;
    fixture.deps.monotonicNow = () => ms;
    return { ...fixture, advance: (value: number) => { ms += value; } };
  }
  it.each([9999, 10000, 10001])('marks slow only above 10000 ms (%s)', async duration => {
    const { deps, call, advance } = timed();
    call.mockImplementation(async () => { advance(duration); return { text: 'OK', usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null }, amount: null }; });
    const result = await runDiagnostic(input, deps);
    expect(result.timing).toMatchObject({ slow: duration > 10000, providerRoundTripMs: duration, totalMs: duration,
      admissionMs: 0, accountingMs: 0, dispatchStartedMs: 0, responseCompletedMs: duration,
      queueMs: null, headersMs: null, parsingMs: null, httpStatus: null, fallbackCount: 0 });
    expect(result.firstByteMs).toBeNull(); expect(result.firstTokenMs).toBeNull();
  });
  it('separates admission, provider round trip and accounting despite wall-clock jumps', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const { deps, call, advance } = timed();
    vi.mocked(deps.verifyAdmission).mockImplementation(async () => { advance(200); vi.setSystemTime(999999); });
    call.mockImplementation(async () => { advance(25000); vi.setSystemTime(1); return { text: 'OK', usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null }, amount: null }; });
    vi.mocked(deps.store.finish).mockImplementation(async () => { advance(155); return undefined as never; });
    const result = await runDiagnostic(input, deps);
    expect(result.timing).toMatchObject({ admissionMs: 200, providerRoundTripMs: 25000, accountingMs: 155,
      dispatchStartedMs: 200, responseCompletedMs: 25200, totalMs: 25355, largestMeasuredStage: 'provider_round_trip' });
    expect(result.timeline.map(e => e.elapsedMs)).toEqual([25200, 25355]);
    expect(result.elapsedMs).toBe(25355); expect(call).toHaveBeenCalledOnce();
  });
  it.each(['TIMEOUT', 'ABORTED', 'RATE_LIMIT', 'NETWORK'] as const)('retains measured failure timing and safe %s evidence', async code => {
    const { deps, call, advance } = timed();
    call.mockImplementation(async () => { advance(11000); throw new FreeChainProviderError(code, code === 'RATE_LIMIT' ? { status: 429, retryAfterMs: 2000 } : {}); });
    const result = await runDiagnostic(input, deps);
    expect(result.timing).toMatchObject({ providerRoundTripMs: 11000, slow: true, retryAfterMs: code === 'RATE_LIMIT' ? 2000 : null, httpStatus: code === 'RATE_LIMIT' ? 429 : null });
    expect(result.timeline[0].reason).toBe(code === 'ABORTED' ? 'cancelled' : code === 'TIMEOUT' ? 'timeout' : code === 'RATE_LIMIT' ? 'rate_limited' : 'network_error');
    expect(JSON.stringify(result.timing)).not.toMatch(/private|Bearer|prompt|secret/);
    expect(call).toHaveBeenCalledOnce(); expect(deps.store.finish).toHaveBeenCalledWith(input.idempotencyKey, record.runId, null);
  });
  it('identifies slow accounting without blaming the provider', async () => {
    const { deps, advance } = timed();
    vi.mocked(deps.store.finish).mockImplementation(async () => { advance(12000); throw new Error('secret raw output'); });
    const result = await runDiagnostic(input, deps);
    expect(result.timing).toMatchObject({ accountingMs: 12000, providerRoundTripMs: 0, largestMeasuredStage: 'accounting' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('reports slow failed admission without inventing dispatch or queue evidence', async () => {
    const { deps, call, advance } = timed();
    vi.mocked(deps.verifyAdmission).mockImplementation(async () => { advance(12000); throw new Error('secret'); });
    const result = await runDiagnostic(input, deps);
    expect(result.timing).toMatchObject({ admissionMs: 12000, providerRoundTripMs: null, accountingMs: null, dispatchStartedMs: null, largestMeasuredStage: 'admission' });
    expect(call).not.toHaveBeenCalled();
  });
  it('never presents recovery lookup timing as a fresh provider measurement', async () => {
    const { deps, advance } = timed();
    vi.mocked(deps.store.read).mockImplementation(async () => { advance(12000); return record; });
    const result = await runDiagnostic(input, deps);
    expect(result.replayed).toBe(true); expect(result.timing).toBeUndefined();
  });
});

it('attributes expired-admission settlement latency to accounting without dispatch', async () => {
  vi.useFakeTimers(); vi.setSystemTime(2000);
  const { deps, call } = setup(); let ms = 0; deps.monotonicNow = () => ms;
  vi.mocked(deps.store.reserve).mockImplementation(async () => { ms += 100; return { mayDispatch: true, run: { ...record, dispatchBefore: 1999 } }; });
  vi.mocked(deps.store.finish).mockImplementation(async () => { ms += 12000; throw new Error('private settlement error'); });
  const result = await runDiagnostic(input, deps);
  expect(result.timing).toMatchObject({ admissionMs: 100, accountingMs: 12000, totalMs: 12100,
    dispatchStartedMs: null, providerRoundTripMs: null, largestMeasuredStage: 'accounting' });
  expect(call).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('private settlement error');
});
