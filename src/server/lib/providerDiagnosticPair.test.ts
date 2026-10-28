import { describe, expect, it, vi } from 'vitest';
import { diagnosticPairAuthority, type DiagnosticPairInputs } from './providerDiagnosticPair';
const now = Date.parse('2026-10-28T15:00:00Z');
function fixture() {
  const raw = { updated_at: new Date(now).toISOString(), models: [{ model: 'flash', providers: [
    { pricing: { input: 0.14, output: 0.42, cacheRead: 0 } },
    { pricing: { input: 0.2, output: 0.8, cacheWrite: 0.3, reasoning: 0.9 } },
  ] }] };
  const inputs: DiagnosticPairInputs = {
    now: () => now,
    fx: () => ({ rate: 90, updatedAt: now - 1000, heldCandidate: null, lastRefusal: '', refusalsInARow: 0 }),
    catalog: vi.fn().mockImplementation(async (_provider, model) => ({ status: 'observed', model, observedAt: now,
      source: 'catalog', estimatedInputUsdPerMillion: '0.00001', estimatedOutputUsdPerMillion: '0.00001',
      contextTokens: 1048576, maxCompletionTokens: 4096, textOutput: true })),
    fetcher: vi.fn<typeof fetch>().mockImplementation(async url => new Response(JSON.stringify(String(url).includes('/supply')
      ? { model: 'beam', min_discount_percent: 0, max_input_per_million: '0.22217', max_output_per_million: '0.876156', candidate_count: 1 }
      : raw))),
  };
  return { inputs, raw, authority: () => diagnosticPairAuthority({ CHEAPERINFERENCE_API_KEY: 'mock-only-secret' }, inputs) };
}
describe('automatic preflight for separate two-call allowance (all reads mocked)', () => {
  it('uses undiscounted max reference dimensions, not cheapest catalog or 90% discount', async () => {
    const f = fixture(), r = await f.authority().review('surplus', 'flash');
    expect(r).toMatchObject({ totalBudgetPaise: 10000, priorCommittedPaise: 0, allInPaisePerUsdCeiling: 18000 });
    expect(r.providers.surplus).toMatchObject({ contextTokens: 1048576, inputPerMillionNanoUsd: 300000000, outputPerMillionNanoUsd: 900000000 });
    expect(f.inputs.fetcher).toHaveBeenCalledWith('https://api.surplusintelligence.ai/v1/prices', expect.objectContaining({ method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } }));
    expect(JSON.stringify(r)).not.toContain('mock-only-secret');
  });
  it('binds CheaperInference rate ceiling to configured Beam and discount0', async () => {
    const f = fixture(), r = await f.authority().review('cheaperinference', 'beam');
    expect(r.providers.cheaperinference.inputPerMillionNanoUsd).toBe(222170000);
    expect(f.inputs.fetcher).toHaveBeenCalledWith('https://api.cheaperinference.com/v1/models/supply?model=beam&min_discount_percent=0', expect.anything());
    expect(r.expiresAt).toBe(now + 30000);
  });
  it('does not fetch another model or upgrade when the configured model differs', async () => {
    const f = fixture(); await expect(f.authority().review('cheaperinference', 'other')).rejects.toMatchObject({ reason: 'budget_evidence_unavailable' });
    expect(f.inputs.fetcher).not.toHaveBeenCalled();
  });
  it('makes no repeated preflight reads within one admission composition', async () => {
    const f = fixture(), a = f.authority(); await a.review('surplus', 'flash'); await a.review('surplus', 'flash');
    expect(f.inputs.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([0, now - 7200001, now + 1])('rejects missing/stale/future FX %s rather than fallback85', async updatedAt => {
    const f = fixture(); f.inputs.fx = () => ({ rate: 85, updatedAt, heldCandidate: null, lastRefusal: '', refusalsInARow: 0 });
    await expect(f.authority().review('surplus', 'flash')).rejects.toMatchObject({ fields: [expect.stringContaining('exchangeRate')] });
  });
  it('rejects stale reference prices', async () => {
    const f = fixture(); f.raw.updated_at = new Date(now - 600001).toISOString();
    await expect(f.authority().review('surplus', 'flash')).rejects.toMatchObject({ fields: [expect.stringContaining('recent publication')] });
  });
  it('rejects missing model instead of inventing a price', async () => {
    const f = fixture(); f.raw.models = [];
    await expect(f.authority().review('surplus', 'flash')).rejects.toMatchObject({ fields: [expect.stringContaining('referencePricing')] });
  });
  it.each([401, 403, 429, 500])('reports price-read HTTP %s without raw body or retry', async status => {
    const f = fixture(); vi.mocked(f.inputs.fetcher).mockResolvedValue(new Response('private body', { status }));
    await expect(f.authority().review('surplus', 'flash')).rejects.toMatchObject({ fields: [`surplus.pricing.http_${status}`] });
    expect(f.inputs.fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched quote without exposing raw response', async () => {
    const f = fixture(); vi.mocked(f.inputs.fetcher).mockResolvedValue(new Response('{"model":"other","secret":"private"}'));
    await expect(f.authority().review('cheaperinference', 'beam')).rejects.toMatchObject({ fields: [expect.stringContaining('no valid current')] });
  });
});
