import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDiagnostic, type DiagnosticDependencies } from './providerDiagnosticRunner';
import { DiagnosticAdmissionError, type DiagnosticRunRecord } from './providerDiagnosticStore';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
const input = { provider: 'surplus' as const, idempotencyKey: '11111111-1111-4111-8111-111111111111', prompt: 'private prompt' };
const record = { runId: input.idempotencyKey, provider: 'surplus', model: 'test', startedAt: 1000, state: 'reserved' } as DiagnosticRunRecord;
function setup() {
  const call = vi.fn().mockResolvedValue({ text: 'hello', usage: { inputTokens: 3, outputTokens: 2, cachedTokens: null }, amount: '0.000001' });
  const deps: DiagnosticDependencies = { store: { read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue({ mayDispatch: true, run: record }), finish: vi.fn().mockResolvedValue(undefined) }, adapter: vi.fn(() => ({ model: 'test', call })), verifyEvidence: vi.fn().mockResolvedValue(undefined) };
  return { deps, call };
}
afterEach(() => vi.useRealTimers());
describe('single provider diagnostics', () => {
  it.each(['surplus', 'cheaperinference'] as const)('dispatches only %s once and settles exact supplier cost', async provider => {
    const { deps, call } = setup(); const r = await runDiagnostic({ ...input, provider }, deps);
    expect(deps.adapter).toHaveBeenCalledExactlyOnceWith(provider); expect(call).toHaveBeenCalledOnce();
    expect(r.text).toBe('hello'); expect(r.supplierCost).toEqual({ status: 'reported', amount: '0.000001', currency: 'USD' });
    expect(deps.store.finish).toHaveBeenCalledWith(input.idempotencyKey, record.runId, 1000);
    expect(r.firstTokenMs).toBeNull(); expect(r.outputTokensPerSecond).toBeNull(); expect(r.retryCount).toBe(0);
  });
  it('does not dispatch a replay even with expired evidence', async () => {
    const { deps, call } = setup(); vi.mocked(deps.store.read).mockResolvedValue(record);
    const r = await runDiagnostic(input, deps); expect(r.replayed).toBe(true); expect(r.runId).toBe(record.runId); expect(r.text).toBeNull();
    expect(call).not.toHaveBeenCalled(); expect(deps.verifyEvidence).not.toHaveBeenCalled();
  });
  it('honors atomic admission replay', async () => {
    const { deps, call } = setup(); vi.mocked(deps.store.reserve).mockResolvedValue({ mayDispatch: false, run: record });
    expect((await runDiagnostic(input, deps)).replayed).toBe(true); expect(call).not.toHaveBeenCalled();
  });
  it('blocks missing evidence before reservation or network', async () => {
    const { deps, call } = setup(); vi.mocked(deps.verifyEvidence).mockRejectedValue(new DiagnosticAdmissionError('budget_evidence_unavailable'));
    expect((await runDiagnostic(input, deps)).timeline[0].reason).toBe('budget_evidence_unavailable');
    expect(deps.store.reserve).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it.each([['AUTH', 401, 'authentication_rejected'], ['RATE_LIMIT', 429, 'rate_limited'], ['NETWORK', undefined, 'network_error'], ['SERVER', 503, 'provider_error'], ['EMPTY_RESPONSE', undefined, 'malformed_response']] as const)('reports evidenced %s safely', async (code, status, reason) => {
    const { deps, call } = setup(); call.mockRejectedValue(new FreeChainProviderError(code, { status }));
    const r = await runDiagnostic(input, deps); expect(r.timeline[0]).toMatchObject({ reason });
    expect(r.supplierCost.status).toBe('unavailable'); expect(r.accounting).toBe('unknown_liability'); expect(call).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toContain(input.prompt); expect(deps.store.finish).toHaveBeenCalledWith(input.idempotencyKey, record.runId, null);
  });
  it('bounds an unresponsive adapter and retains unknown liability', async () => {
    vi.useFakeTimers(); const { deps, call } = setup(); call.mockImplementation(() => new Promise(() => {}));
    const pending = runDiagnostic(input, deps); await vi.advanceTimersByTimeAsync(30001); const r = await pending;
    expect(r.timeline[0].reason).toBe('timeout'); expect(call).toHaveBeenCalledOnce(); expect(r.accounting).toBe('unknown_liability');
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
