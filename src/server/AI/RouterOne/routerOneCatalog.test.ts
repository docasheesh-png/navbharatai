import { describe, it, expect, beforeEach } from 'vitest';
import { parseRouterOneCatalog, rankForCoding, resolveRouterOneModels, syncRouterOneCatalog, __setRouterOneRanking } from './routerOneCatalog';

const catalog = { data: [
  { id: 'cheap-coder', pricing: { prompt: '0.0000001', completion: '0.0000004' }, supported_parameters: ['tools'], context_length: 128000 },
  { id: 'pricey-gpt', pricing: { prompt: 3, completion: 15 }, supported_parameters: ['tools'] },
  { id: 'no-tools', pricing: { prompt: 0.01, completion: 0.02 }, supported_parameters: ['temperature'] },
  { id: 'text-embedding-3', pricing: { prompt: 0.01, completion: 0 } },
  { id: 'free-x', pricing: { prompt: 0, completion: 0 }, supported_parameters: ['tools'] },
  { id: 'no-price', supported_parameters: ['tools'] },
] };

describe('Router One catalog engine', () => {
  beforeEach(() => __setRouterOneRanking(null));
  it('parses, filters tool-capable, ranks cheapest', () => {
    const r = rankForCoding(parseRouterOneCatalog(catalog), {});
    expect(r.map((e) => e.id)).toEqual(['cheap-coder', 'pricey-gpt']);
    expect(r[0].inPerM).toBeCloseTo(0.1);
  });
  it('env fallback when no ranking; synced list when ranked', () => {
    expect(resolveRouterOneModels(['m1'], {})).toEqual(['m1']);
    __setRouterOneRanking({ syncedAt: 1, total: 2, source: 'live', ranked: rankForCoding(parseRouterOneCatalog(catalog), {}) });
    expect(resolveRouterOneModels(['m1'], {}, true)).toEqual(['cheap-coder', 'pricey-gpt', 'm1', 'auto']);
    expect(resolveRouterOneModels(['m1'], { ROUTER_ONE_MODEL_MODE: 'env' })).toEqual(['m1']);
    expect(resolveRouterOneModels(['m1'], { ROUTER_ONE_MODEL_MODE: 'auto' })).toEqual(['auto']);
  });
  it('keeps last good on fetch failure', async () => {
    const env = { ROUTER_ONE_API_KEY: 'k' } as NodeJS.ProcessEnv;
    const priceSource = { snapshot: async (model: string) => ({ model, bands: [{ inputUsdPerMillion: model === 'cheap-coder' ? '0.1' : '3', outputUsdPerMillion: model === 'cheap-coder' ? '0.4' : '15' }] }) as never };
    const ok = await syncRouterOneCatalog({ env, priceSource, fetchImpl: (async () => new Response(JSON.stringify(catalog))) as typeof fetch });
    expect(ok?.ranked[0].id).toBe('cheap-coder');
    const after = await syncRouterOneCatalog({ env, fetchImpl: (async () => new Response('x', { status: 500 })) as typeof fetch });
    expect(after?.ranked[0].id).toBe('cheap-coder');
  });
});
