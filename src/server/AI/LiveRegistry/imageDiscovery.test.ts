import { describe, expect, it, vi } from 'vitest';
import { discoverImageModels, imageEndpointUrl, IMAGE_CATALOG_URL, IMAGE_DISCOVERY_TTL_MS } from './imageDiscovery';
const model = (id = 'test/image') => ({ id, name: 'Image', architecture: { output_modalities: ['image'] } });
const price = (cost_usd: unknown, variant?: string) => ({ billable: 'output_image', unit: 'image', cost_usd, ...(variant ? { variant } : {}) });
function fixture(pricing: unknown = [price(0.02)]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    return Response.json(url === IMAGE_CATALOG_URL ? { data: [model()] } : { id: 'test/image', endpoints: [{ provider_tag: 'test', pricing }] });
  }) as unknown as typeof fetch;
}
describe('dedicated image metadata discovery', () => {
  it('classifies actual image output fees, never text token prices', async () => {
    const s = await discoverImageModels(fixture([price(0.0184), { billable: 'input_image', unit: 'image', cost_usd: 0 }]), () => 100);
    expect(s.models[0].eligibilityStatus).toBe('PAID');
    expect(s.models[0].endpoints[0].pricing[0].costUsd).toBe('0.0184');
    expect(s.expiresAt).toBe(100 + IMAGE_DISCOVERY_TTL_MS);
  });
  it.each([[], undefined, [price('not-money')], [price(-1)], [price(null)], [price('')], [price(Infinity)]])('missing or malformed charges are UNKNOWN (%j)', async pricing => {
    const s = await discoverImageModels(fixture(pricing === undefined ? null : pricing), () => 100);
    expect(s.models[0].eligibilityStatus).toBe('UNKNOWN');
  });
  it.each([[price(0)], [price('0.000')], [price('0e-12')], [price(0, '1k'), price(0.02, '4k')]])('zero or mixed tiers are only candidates, never authorized (%j)', async pricing => {
    const s = await discoverImageModels(fixture(pricing), () => 100);
    expect(s.models[0].eligibilityStatus).toBe('UNKNOWN');
    expect(s.models.some(m => m.eligibilityStatus === 'VERIFIED_FREE')).toBe(false);
  });
  it('retains exponent-form positive prices without arithmetic', async () => {
    const s = await discoverImageModels(fixture([price('1e-999')]), () => 100);
    expect(s.models[0].eligibilityStatus).toBe('PAID');
  });
  it('does not rescan endpoints until hourly expiry, then detects price change', async () => {
    const previous = await discoverImageModels(fixture(), () => 100);
    const fetcher = fixture([price(0)]);
    expect(await discoverImageModels(fetcher, () => 200, previous)).toBe(previous);
    expect(fetcher).not.toHaveBeenCalled();
    const next = await discoverImageModels(fetcher, () => previous.expiresAt, previous);
    expect(next.models[0].eligibilityStatus).toBe('UNKNOWN');
    expect(previous.models[0].eligibilityStatus).toBe('PAID');
  });
  it.each(['../image', 'test/../image', 'https://evil.test/x', 'test/image?url=x', 'test/image#x', 'test/%2e'])('rejects unsafe ID %s', id => {
    expect(() => imageEndpointUrl(id)).toThrow();
  });
  it.each([{ data: [] }, { data: [model(), model()] }, { data: [model()], total_count: 2 }, { data: [model()], links: { next: 'https://evil.test' } }])('rejects partial or malformed catalogs without publishing', async payload => {
    await expect(discoverImageModels(vi.fn(async () => Response.json(payload)), () => 100)).rejects.toThrow();
  });
  it('ignores arbitrary advertised endpoint links and preserves exact free suffix', async () => {
    const calls: string[] = [];
    await discoverImageModels(vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json(String(url) === IMAGE_CATALOG_URL ? { data: [{ ...model('test/image:free'), endpoints: 'https://evil.test' }] } : { id: 'test/image:free', endpoints: [] });
    }) as typeof fetch, () => 100);
    expect(calls).toEqual([IMAGE_CATALOG_URL, `${IMAGE_CATALOG_URL}/test/image:free/endpoints`]);
  });
  it('fails the entire scan if any endpoint fails and leaves previous untouched', async () => {
    const previous = await discoverImageModels(fixture(), () => 100);
    const before = JSON.stringify(previous);
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url) === IMAGE_CATALOG_URL ? Response.json({ data: [model()] }) : new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(discoverImageModels(fetcher as typeof fetch, () => previous.expiresAt, previous)).rejects.toMatchObject({ status: 429, retryAfter: '60' });
    expect(JSON.stringify(previous)).toBe(before);
  });
  it('removes disappeared models only on a complete successful scan', async () => {
    const previous = await discoverImageModels(fixture(), () => 100);
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url) === IMAGE_CATALOG_URL ? { data: [model('test/new')] } : { id: 'test/new', endpoints: [] }));
    const next = await discoverImageModels(fetcher as typeof fetch, () => previous.expiresAt, previous);
    expect(next.models.map(m => m.exactModelId)).toEqual(['test/new']);
  });
  it('rejects oversized declared bodies', async () => {
    await expect(discoverImageModels(vi.fn(async () => new Response('{}', { headers: { 'content-length': '4000001' } })), () => 100)).rejects.toThrow('body');
  });
  it('rejects mismatched endpoint model identities', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url) === IMAGE_CATALOG_URL ? { data: [model()] } : { id: 'test/other', endpoints: [] }));
    await expect(discoverImageModels(fetcher as typeof fetch, () => 100)).rejects.toThrow('endpoint');
  });
});
