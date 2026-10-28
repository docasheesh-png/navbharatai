import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDiagnosticCatalog } from './providerDiagnosticPreflight';

const model = 'test-model';
const env = { CHEAPERINFERENCE_API_KEY: 'mock-secret-not-a-real-key' };
const catalog = () => new Response(JSON.stringify({ data: [{ id: model, pricing: {
  currency: 'USD', input_per_million: '0.15', output_per_million: '0.60',
}, private_metadata: 'must-not-escape' }] }));
afterEach(() => vi.useRealTimers());
describe('read-only diagnostic catalog evidence', () => {
  it('uses only the named provider, with no redirects or retries, and projects safe fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(catalog());
    const result = await readDiagnosticCatalog('cheaperinference', model, env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.cheaperinference.com/v1/models');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: {
      Accept: 'application/json', Authorization: `Bearer ${env.CHEAPERINFERENCE_API_KEY}`,
    } });
    expect(result).toMatchObject({ status: 'observed', estimatedInputUsdPerMillion: '0.15', estimatedOutputUsdPerMillion: '0.60' });
    expect(JSON.stringify(result)).not.toMatch(/mock-secret|must-not-escape|receipt|dispatchReady/);
  });
  it('does not transmit any key to the public Surplus catalog or guess its price units', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(catalog());
    const result = await readDiagnosticCatalog('surplus', model, env, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.surplusintelligence.ai/v1/models');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
    expect(result).toMatchObject({ status: 'observed', estimatedInputUsdPerMillion: null, estimatedOutputUsdPerMillion: null });
  });
  it('distinguishes missing configuration without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await readDiagnosticCatalog('cheaperinference', model, {}, fetcher)).toMatchObject({ reason: 'config_missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'authentication_rejected'], [403, 'authentication_rejected'], [429, 'rate_limited'], [500, 'provider_error']])('reports HTTP %s evidence without raw body or retry', async (httpStatus, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private response', { status: Number(httpStatus) }));
    const result = await readDiagnosticCatalog('surplus', model, {}, fetcher);
    expect(result).toMatchObject({ status: 'unavailable', httpStatus, reason });
    expect(JSON.stringify(result)).not.toContain('private response');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not call a network failure a malformed response or wrong key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private credentials'));
    const result = await readDiagnosticCatalog('surplus', model, {}, fetcher);
    expect(result).toMatchObject({ reason: 'network_error' });
    expect(result.httpStatus).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private credentials');
  });
  it('times out a stalled fetch at five seconds without retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = readDiagnosticCatalog('surplus', model, {}, fetcher);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ reason: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['not-json', JSON.stringify({ data: 'invalid' }), 'x'.repeat(2_000_001)])('rejects malformed or oversized catalogs safely', async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    expect(await readDiagnosticCatalog('surplus', model, {}, fetcher)).toMatchObject({ reason: 'malformed_catalog' });
  });
  it('never treats a missing model or a wrong-currency price as zero cost', async () => {
    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[]}'));
    expect(await readDiagnosticCatalog('surplus', model, {}, missing)).toMatchObject({ reason: 'model_not_listed' });
    const wrongCurrency = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: model, pricing: { currency: 'INR', input_per_million: 1 } }] })));
    expect(await readDiagnosticCatalog('cheaperinference', model, env, wrongCurrency)).toMatchObject({ estimatedInputUsdPerMillion: null, estimatedOutputUsdPerMillion: null });
  });
});
