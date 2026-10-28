import { describe, expect, it, vi } from 'vitest';
import { readDiagnosticCatalog } from './providerDiagnosticPreflight';
import { diagnosticPairAuthority } from './providerDiagnosticPair';

// DOCUMENTED-contract fixtures, not claimed live captures. API reads from this
// execution environment were proxy-denied; fixtures are grounded in these primary sources:
// https://www.surplusintelligence.ai/docs/api-reference/models
// https://api-docs.deepseek.com/api/create-chat-completion/
// https://www.cheaperinference.com/api/openapi.json (PublicModel)
// https://www.cheaperinference.com/models/beam
const surplus = { data: [{ id: 'deepseek-v4.1-flash', context_length: 1048576,
  pricing: { prompt: '0.00000014', completion: '0.00000042' },
  top_provider: { max_completion_tokens: 393216 } }] };
const beam = { id: 'beam', model_type: 'text', context_length: 1048576, max_output_tokens: 131072,
  endpoint: '/v1/chat/completions', supported_endpoints: ['/v1/chat/completions', '/v1/messages', '/v1/responses'],
  discount_percent: '0.00', input_per_million: '0.222170', output_per_million: '0.876156', cache_read_per_million: '0.210899' };
const fetchJson = (value: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value)));
const env = { CHEAPERINFERENCE_API_KEY: 'mock-only-not-real' };
describe('official metadata contracts and omitted optional limits', () => {
  it('reads nested Surplus output cap and documented exact-model text capability', async () => {
    const r = await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson(surplus));
    expect(r).toMatchObject({ status: 'observed', maxCompletionTokens: 393216, textOutput: true, contextTokens: 1048576, limitsSource: 'catalog_and_model_documentation' });
  });
  it('fills only absent or null optional limits for the exact documented live model', async () => {
    const r = await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ id: 'deepseek-v4.1-flash', context_length: null, max_completion_tokens: null }] }));
    expect(r).toMatchObject({ status: 'observed', maxCompletionTokens: 393216, contextTokens: 1048576, textOutput: true });
  });
  it('does not fabricate a live listing from documentation', async () => {
    expect(await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [] }))).toMatchObject({ reason: 'model_not_listed' });
  });
  it('does not apply known-model defaults to an arbitrary model', async () => {
    const r = await readDiagnosticCatalog('surplus', 'other', {}, fetchJson({ data: [{ id: 'other' }] }));
    expect(r.maxCompletionTokens).toBeUndefined(); expect(r.textOutput).toBeUndefined();
  });
  it('preserves explicitly incompatible output and modality rather than overriding them', async () => {
    const r = await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ ...surplus.data[0], max_completion_tokens: 128, architecture: { output_modalities: ['image'] } }] }));
    expect(r).toMatchObject({ maxCompletionTokens: 128, textOutput: false });
  });
  it.each([0, -1, '393216', 1.5])('rejects malformed present limits %s rather than using documentation', async max_completion_tokens => {
    expect(await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ ...surplus.data[0], max_completion_tokens }] }))).toMatchObject({ reason: 'catalog_limits_invalid' });
  });
  it('reads the direct PublicModel schema without authorization or a data envelope', async () => {
    const fetcher = fetchJson(beam), r = await readDiagnosticCatalog('cheaperinference', 'beam', env, fetcher);
    expect(r).toMatchObject({ status: 'observed', contextTokens: 1048576, maxCompletionTokens: 131072, textOutput: true, chatCompletions: true, estimatedInputUsdPerMillion: '0.222170' });
    expect(fetcher).toHaveBeenCalledWith('https://api.cheaperinference.com/public/models/beam', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });
  it('requires the exact returned ID and distinguishes a wrong envelope', async () => {
    expect(await readDiagnosticCatalog('cheaperinference', 'beam', env, fetchJson({ ...beam, id: 'beam-1.0-501b-a23b' }))).toMatchObject({ reason: 'model_not_listed' });
    expect(await readDiagnosticCatalog('cheaperinference', 'beam', env, fetchJson({ data: [beam] }))).toMatchObject({ reason: 'catalog_shape_unexpected' });
  });
  it('single-model metadata plus authenticated supply reaches a real prepared reservation', async () => {
    const now = Date.now();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => new Response(JSON.stringify(String(url).includes('/public/models/') ? beam : {
      model: 'beam', min_discount_percent: 0, max_input_per_million: '0.222170', max_output_per_million: '0.876156', candidate_count: 1,
    })));
    const authority = diagnosticPairAuthority(env, { catalog: readDiagnosticCatalog, fetcher, now: () => now,
      fx: () => ({ rate: 90, updatedAt: now, heldCandidate: null, lastRefusal: '', refusalsInARow: 0 }) });
    expect((await authority.review('cheaperinference', 'beam')).totalBudgetPaise).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${env.CHEAPERINFERENCE_API_KEY}` });
  });
});

it('the Beam fixture conforms to the published response-schema projection', async () => {
  const { readFileSync } = await import('node:fs');
  const schema = JSON.parse(readFileSync(new URL('./__fixtures__/cheaper-public-model.contract.json', import.meta.url), 'utf8'));
  const value: Record<string, unknown> = beam;
  for (const key of schema.required) expect(key in value, `official required field ${key}`).toBe(true);
  for (const [key, spec] of Object.entries(schema.properties) as [string, { type: string | string[]; enum?: string[] }][]) {
    if (!(key in value)) continue;
    const v = value[key], type = v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
    expect(Array.isArray(spec.type) ? spec.type : [spec.type], key).toContain(type);
    if (spec.enum) expect(spec.enum, key).toContain(v);
    if (Array.isArray(v)) expect(v.every(item => typeof item === 'string')).toBe(true);
  }
});
it.each([{ architecture: 'invalid' }, { top_provider: [] }, { architecture: false }])('malformed present metadata never falls back to documentation %#', async extra => {
  expect(await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ ...surplus.data[0], ...extra }] }))).toMatchObject({ reason: 'catalog_shape_unexpected' });
});
it('uses the smaller stated output cap when root and provider limits differ', async () => {
  expect(await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ ...surplus.data[0], max_completion_tokens: 393216, top_provider: { max_completion_tokens: 128 } }] }))).toMatchObject({ maxCompletionTokens: 128 });
});
it('schema diagnostics project only sizes/types, never raw values or field names', async () => {
  const r = await readDiagnosticCatalog('surplus', 'deepseek-v4.1-flash', {}, fetchJson({ data: [{ ...surplus.data[0], architecture: 'Bearer private', private_field: 'credential' }] }));
  expect(r.schemaEvidence).toMatchObject({ rootType: 'object', modelMatches: 1, contextType: 'number' });
  expect(JSON.stringify(r)).not.toMatch(/Bearer|private_field|credential/);
});
