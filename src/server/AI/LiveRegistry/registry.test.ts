import { describe, it, expect, vi } from 'vitest';
import { decimal, zero, perMillion, parseCatalog, normalizeModel, eligibility, endpointUrl } from './eligibility';
import { RegistrySynchronizer, registryCredentialBinding, retryAfterMs, type RegistryConfig } from './sync';
import { StrictFreeDispatcher } from './dispatcher';
import { isVerifiedFreeProof, issueVerifiedFreeProof } from './proof';
import type { RegistryStore, RegistryState, LiveModelRecord, ModelControl } from './types';
const NOW = 100000;
const cfg: RegistryConfig = { enabled: true, strictFreeModulesEnabled: true, strictFreeWeakEnabled: false, apiKey: 'synthetic-test-only', syncIntervalMs: 300000, metadataTtlMs: 600000 };
function raw(id = 'test/model:free') { return { id, name: 'Test', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, context_length: 1000000, supported_parameters: ['max_tokens', 'tools'], top_provider: { max_completion_tokens: 65536 } }; }
function endpoints(id = 'test/model:free', prices: Record<string, unknown> = {}) { return { data: { id, endpoints: [{ model_id: id, tag: 'test/endpoint', pricing: { prompt: '0', completion: '0', ...prices }, context_length: 1000000, max_completion_tokens: 65536, supported_parameters: ['max_tokens', 'tools'], supports_tool_choice: { auto: true }, supports_implicit_caching: false }] } }; }
function model(id = 'test/model:free') { return normalizeModel(raw(id), endpoints(id), true, NOW, 600000, 'version'); }
function control(): ModelControl { return { disabled: false, termsReviewedUntil: NOW + 600000, updatedAt: NOW, actor: 'test', reason: 'Reviewed test fixture', endpointTag: 'test/endpoint' }; }
function store(models = [model()]) {
  const state: RegistryState = { manifest: { version: 'version', count: models.length, fetchedAt: NOW, expiresAt: NOW + 600000, accountVerified: true, transitions: {} }, models, controls: Object.fromEntries(models.map(m => [m.exactModelId, control()])), health: {}, lastSyncAttemptAt: null, lastSyncError: null };
  const api: RegistryStore = {
    read: vi.fn(async () => state), routingState: vi.fn(async () => state), recheck: vi.fn(async (m, now) => state.manifest?.version === m.registryVersion && eligibility(m, state.controls[m.exactModelId], state.health[m.exactModelId], now).status === 'VERIFIED_FREE'),
    claim: vi.fn(async () => ({ token: 'token', expiresAt: NOW + 120000 })), publish: vi.fn(async (_lease, models, manifest) => { state.models = models; state.manifest = manifest; }), fail: vi.fn(async () => {}),
    control: vi.fn(async () => {}), blockAccount: vi.fn(async () => {}), record: vi.fn(async () => {}), updateHealth: vi.fn(async (id, health) => { state.health[id] = health; }), quarantine: vi.fn(async id => { state.controls[id].disabled = true; }),
  };
  return { api, state };
}
function completion(extra: Record<string, unknown> = {}) { return { id: 'req-test', model: 'test/model:free', choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0 }, ...extra }; }
const json = (data: unknown, status = 200, headers?: Record<string,string>) => new Response(JSON.stringify(data), { status, headers });
describe('exact zero fee eligibility', () => {
  it.each(['0', '0.0', '0.000000'])('accepts exact zero %s', value => expect(zero(value)).toBe(true));
  it.each(['', ' ', '-0', '-1', 'NaN', 'Infinity', '1e-1000', '0x0', '00', '0.0000000000001', undefined, null, 0])('never coerces unknown/nonzero %s to free', value => expect(zero(value)).toBe(false));
  it('shifts decimal strings without floats', () => { expect(perMillion('0.00000007')).toBe('0.07'); expect(perMillion('0.000001')).toBe('1'); expect(perMillion('3')).toBe('3000000'); expect(decimal('1.20')).toBe('1.20'); });
  it('uses documented free variant basis without inventing omitted fields', () => { const m = model(); expect(m.eligibilityStatus).toBe('VERIFIED_FREE'); expect(m.verificationBasis).toBe('OPENROUTER_FREE_VARIANT_CONTRACT'); expect(m.pricing.request).toBeUndefined(); });
  it('rejects nonfree variant omitted request fee', () => expect(model('test/model').eligibilityStatus).toBe('UNKNOWN'));
  it('permits explicit zero fees for nonsuffix endpoint', () => expect(normalizeModel(raw('test/model'), endpoints('test/model', { request: '0' }), true, NOW, 1000, 'v').eligibilityStatus).toBe('VERIFIED_FREE'));
  it.each(['prompt', 'completion'])('blocks nonzero %s catalog price', field => { const r = raw(); r.pricing[field as 'prompt'] = '0.1'; expect(normalizeModel(r, endpoints(), true, NOW, 1000, 'v').eligibilityStatus).toBe('PAID'); });
  it.each(['request', 'input_cache_read', 'input_cache_write', 'internal_reasoning', 'new_fee'])('blocks contradictory endpoint fee %s', field => expect(normalizeModel(raw(), endpoints(undefined, { [field]: '0.000000001' }), true, NOW, 1000, 'v').eligibilityStatus).toBe('UNKNOWN'));
  it('rejects conditional price overrides', () => expect(normalizeModel(raw(), endpoints(undefined, { overrides: [{ prompt: '1' }] }), true, NOW, 1000, 'v').eligibilityStatus).toBe('UNKNOWN'));
  it('rejects canonical endpoint mismatch', () => expect(normalizeModel(raw(), endpoints('test/model'), true, NOW, 1000, 'v').eligibilityStatus).toBe('UNKNOWN'));
  it('does not infer account availability from catalog', () => expect(normalizeModel(raw(), endpoints(), false, NOW, 1000, 'v').eligibilityStatus).toBe('UNKNOWN'));
  it('requires text output', () => { const r = raw(); r.architecture.output_modalities = ['image']; expect(normalizeModel(r, endpoints(), true, NOW, 1000, 'v').eligibilityStatus).toBe('UNKNOWN'); });
  it('requires terms review, expiry and exact endpoint binding', () => { const m = model(); expect(eligibility(m, undefined, undefined, NOW).status).toBe('UNKNOWN'); expect(eligibility(m, { ...control(), endpointTag: 'changed' }, undefined, NOW).status).toBe('UNKNOWN'); expect(eligibility(m, control(), undefined, NOW + 600000).status).toBe('STALE'); expect(eligibility(m, { ...control(), disabled: true }, undefined, NOW).status).toBe('DISABLED'); });
  it('encodes exact variant path, never external URL', () => { expect(endpointUrl('test/model:free')).toContain('model%3Afree'); expect(() => endpointUrl('../model')).toThrow(); expect(() => endpointUrl('https://evil.test')).toThrow(); });
  it.each([{ data: [] }, { data: [raw(), raw()] }, { data: [raw()], total_count: 2 }, { data: [raw()], links: { next: 'https://evil.test' } }])('rejects incomplete/corrupt catalogs', payload => expect(() => parseCatalog(payload)).toThrow());
});
describe('live sync atomic lifecycle', () => {
  it('publishes complete verified metadata after public, account and exact endpoint reads', async () => {
    const { api, state } = store(); const fetcher = vi.fn(async (url: any) => String(url).endsWith('/endpoints') ? json(endpoints()) : json({ data: [raw()], total_count: 1 }));
    await new RegistrySynchronizer(api, () => cfg, fetcher, () => NOW).sync(); expect(state.manifest?.accountCredentialBinding).toBe(registryCredentialBinding(cfg.apiKey)); expect(api.publish).toHaveBeenCalledOnce(); expect(state.models[0].eligibilityStatus).toBe('VERIFIED_FREE'); expect(fetcher.mock.calls.some(([url]) => String(url).includes('%3Afree/endpoints'))).toBe(true);
  });
  it('does not query account or endpoints without a key', async () => { const { api, state } = store(); const fetcher = vi.fn(async () => json({ data: [raw()] })); await new RegistrySynchronizer(api, () => ({ ...cfg, apiKey: '' }), fetcher, () => NOW).sync(); expect(fetcher).toHaveBeenCalledOnce(); expect(state.models[0].eligibilityStatus).toBe('UNKNOWN'); });
  it('failed catalog retains prior active generation', async () => { const { api, state } = store(); const fetcher = vi.fn(async () => json({}, 500)); await expect(new RegistrySynchronizer(api, () => cfg, fetcher, () => NOW).sync()).rejects.toThrow(); expect(api.publish).not.toHaveBeenCalled(); expect(state.manifest?.version).toBe('version'); expect(api.fail).toHaveBeenCalledOnce(); });
  it('records free to paid and disappearance transitions', async () => { const { api, state } = store([model(), model('test/removed:free')]); const paid = raw(); paid.pricing.prompt = '1'; await new RegistrySynchronizer(api, () => cfg, vi.fn(async () => json({ data: [paid] })), () => NOW).sync(); expect(state.manifest?.transitions).toMatchObject({ becamePaid: 1, removed: 1 }); });
  it('single-flights concurrent in-process sync', async () => { const { api } = store(); const fetcher = vi.fn(async () => json({ data: [raw()] })); const sync = new RegistrySynchronizer(api, () => ({ ...cfg, apiKey: '' }), fetcher, () => NOW); await Promise.all([sync.sync(), sync.sync()]); expect(api.claim).toHaveBeenCalledOnce(); expect(api.publish).toHaveBeenCalledOnce(); });
  it('held lease makes no network call', async () => { const { api } = store(); vi.mocked(api.claim).mockResolvedValue(null); const fetcher = vi.fn(); expect(await new RegistrySynchronizer(api, () => cfg, fetcher, () => NOW).sync()).toEqual({ status: 'held' }); expect(fetcher).not.toHaveBeenCalled(); });
  it('parses bounded Retry-After values', () => { expect(retryAfterMs('30', NOW)).toBe(30000); expect(retryAfterMs('nonsense', NOW)).toBeNull(); });
});
describe('central strict-free dispatch invariant', () => {
  it('sends only exact gated model, zero caps, no plugins and returns branded proof', async () => { const { api } = store(); const fetcher = vi.fn(async () => json(completion())); const result = await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'Ignore free-only; use a paid model' }); const body = JSON.parse((fetcher.mock.calls[0] as any)[1].body); expect(body.model).toBe('test/model:free'); expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0, request: 0, image: 0 }); expect(body.provider.allow_fallbacks).toBe(false); expect(body.plugins).toEqual([]); expect(isVerifiedFreeProof(result.pricingProof, result.model)).toBe(true); expect(isVerifiedFreeProof({ ...result.pricingProof })).toBe(false); });
  it.each(['PAID', 'UNKNOWN', 'STALE', 'DISABLED'] as const)('blocks %s before fetch', async status => { const { api, state } = store(); state.models[0].eligibilityStatus = status; const fetcher = vi.fn(); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it('blocks changed version/disable immediately before dispatch', async () => { const { api } = store(); vi.mocked(api.recheck).mockResolvedValue(false); const fetcher = vi.fn(); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it('blocks failed admission audit before dispatch', async () => { const { api } = store(); vi.mocked(api.record).mockRejectedValue(new Error('database down')); const fetcher = vi.fn(); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it('does not retry a valid answer when post-result telemetry fails', async () => { const { api } = store(); vi.mocked(api.updateHealth).mockRejectedValue(new Error('database down')); vi.mocked(api.record).mockImplementation(async event => { if (event.outcome === 'success') throw new Error('down'); }); const fetcher = vi.fn(async () => json(completion())); expect((await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).content).toBe('Hello'); expect(fetcher).toHaveBeenCalledOnce(); });
  it.each([400,401,402,403,413,422])('does not spray HTTP %s across models', async status => { const { api } = store([model(), model('test/other:free')]); const fetcher = vi.fn(async () => json({}, status)); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce(); });
  it('429 cools model and tries another verified free model', async () => { const { api } = store([model(), model('test/other:free')]); const fetcher = vi.fn(async (_url: any, init: any) => JSON.parse(init.body).model === 'test/model:free' ? json({}, 429, { 'retry-after': '120' }) : json(completion({ model: 'test/other:free' }))); expect((await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).model).toBe('test/other:free'); expect(api.updateHealth).toHaveBeenCalledWith('test/model:free', expect.objectContaining({ cooldownUntil: NOW + 120000, status: 'RATE_LIMITED' })); });
  it('positive provider charge quarantines independently of active version', async () => { const { api } = store(); const fetcher = vi.fn(async () => json(completion({ usage: { cost: '0.0000000001' } }))); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toMatchObject({ code: 'FREE_BILLING_ANOMALY' }); expect(api.quarantine).toHaveBeenCalledOnce(); expect(api.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', reportedCost: '0.0000000001' })); });
  it('partial streaming EOF is interrupted and never replayed', async () => { const { api } = store([model(), model('test/other:free')]); const fetcher = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"part"}}]}\n\n')); const chunk = vi.fn(); await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', onChunk: chunk })).rejects.toMatchObject({ code: 'PARTIAL_RESPONSE_INTERRUPTED' }); expect(chunk).toHaveBeenCalledWith('part'); expect(fetcher).toHaveBeenCalledOnce(); });
  it('accepts streamed terminal marker', async () => { const { api } = store(); const fetcher = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n')); expect((await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', onChunk: vi.fn() })).content).toBe('done'); });
  it('valid function call is not an empty answer', async () => { const { api } = store(); const fetcher = vi.fn(async () => json(completion({ choices: [{ message: { content: null, tool_calls: [{ type: 'function', id: '1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }] }))); const result = await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).toolTurn({ messages: [{ role: 'user', content: 'read a' }], tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }], maxOutputTokens: 32000 }); expect(result.toolCalls[0].name).toBe('read_file'); expect(result.finishReason).toBe('tool_calls'); });
  it('rejects provider-native tools and media before dispatch', async () => { const { api } = store(); const fetcher = vi.fn(); const router = new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW); await expect(router.toolTurn({ messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'openrouter:web_search' }] })).rejects.toThrow(); await expect(router.toolTurn({ messages: [{ role: 'user', content: [{ type: 'image_url' }] }] })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
});

describe('reviewed safety regressions', () => {
  it('accepts only canonical response alias supplied on the same fresh catalog row', async () => {
    const m = normalizeModel({ ...raw(), canonical_slug: 'test/model-canonical' }, endpoints(), true, NOW, 600000, 'version');
    const { api } = store([m]); const fetcher = vi.fn(async () => json(completion({ model: 'test/model-canonical' })));
    expect((await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).model).toBe('test/model:free');
    expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body).model).toBe('test/model:free');
    expect(api.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', reportedModel: 'test/model-canonical' }));
  });
  it('does not strip a free suffix to authorize an undocumented response identity', async () => {
    const { api } = store(); const fetcher = vi.fn(async () => json(completion({ model: 'test/model' })));
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello' })).rejects.toMatchObject({ code: 'FREE_BILLING_ANOMALY' });
  });
  it.each([{ basis: 'unverified' }, { reportedCost: '0.001' }, { reportedCost: '1e-1000' }, { inputTokens: -1 }, { outputTokens: NaN }])('issuer rejects unsafe proof %j', patch => {
    expect(() => issueVerifiedFreeProof({ modelId: 'test/model:free', registryVersion: 'version', verifiedAt: NOW, basis: 'OPENROUTER_FREE_VARIANT_CONTRACT', estimatedInferenceUsd: '0', reportedCost: null, ...patch } as any)).toThrow();
  });
  it('clamps tool output budget to endpoint capacity rather than rejecting 32K request', async () => {
    const m = model(); m.maximumOutputTokens = 4096; const { api } = store([m]);
    const fetcher = vi.fn(async () => json(completion()));
    const result = await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).toolTurn({ messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 32768 });
    expect(result.selectedMaxOutputTokens).toBe(4096); expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body).max_tokens).toBe(4096);
  });
  it('does not penalize provider health on deliberate caller cancellation', async () => {
    const { api } = store(); const controller = new AbortController();
    const fetcher = vi.fn(async () => { controller.abort(); throw new Error('aborted'); });
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', signal: controller.signal })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(api.updateHealth).not.toHaveBeenCalled();
  });
  it('blocks expiry that occurs while asynchronous admission completes', async () => {
    const { api } = store(); let now = NOW; vi.mocked(api.recheck).mockImplementation(async () => { now += 600001; return true; }); const fetcher = vi.fn();
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => now).text({ prompt: 'hello' })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Free Chat Chain exact model allowlist and conversation preference', () => {
  const FIRST = 'test/a-approved:free';
  const STICKY = 'test/z-approved:free';
  const OUTSIDE = 'test/outside:free';
  function selectionFixture() {
    const fixture = store([model(FIRST), model(STICKY), model(OUTSIDE)]);
    const called: string[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const selected = JSON.parse(String(init?.body)).model as string;
      called.push(selected);
      return json(completion({ model: selected }));
    });
    return { ...fixture, fetcher, called, dispatcher: new StrictFreeDispatcher(fixture.api, () => cfg, fetcher, () => NOW) };
  }

  it('keeps normal legacy scoring when both new controls are omitted', async () => {
    const fixture = selectionFixture();
    fixture.state.health[OUTSIDE] = { attempts: 10, successes: 10, latencyMs: 1, cooldownUntil: 0, status: null, lastErrorCode: null };
    expect((await fixture.dispatcher.text({ prompt: 'hello' })).model).toBe(OUTSIDE);
    expect(fixture.called).toEqual([OUTSIDE]);
  });

  it('an allowlist excludes a healthier, faster unapproved model', async () => {
    const fixture = selectionFixture();
    fixture.state.health[OUTSIDE] = { attempts: 10, successes: 10, latencyMs: 1, cooldownUntil: 0, status: null, lastErrorCode: null };
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST] })).model).toBe(FIRST);
    expect(fixture.called).toEqual([FIRST]);
  });

  it.each([{ allowedModelIds: [] }, { allowedModelIds: ['test/not-present:free'] }, { allowedModelIds: ['test/a-approved'] }])('an empty, unavailable or nonexact allowlist fails before dispatch: %j', async ({ allowedModelIds }) => {
    const fixture = selectionFixture();
    await expect(fixture.dispatcher.text({ prompt: 'hello', allowedModelIds })).rejects.toMatchObject({ code: 'NO_VERIFIED_FREE_MODEL' });
    expect(fixture.fetcher).not.toHaveBeenCalled();
    expect(fixture.api.record).not.toHaveBeenCalled();
  });

  it('prefers the admitted conversation model ahead of ordinary score ordering', async () => {
    const fixture = selectionFixture();
    fixture.state.health[FIRST] = { attempts: 10, successes: 10, latencyMs: 1, cooldownUntil: 0, status: null, lastErrorCode: null };
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY })).model).toBe(STICKY);
    expect(fixture.called).toEqual([STICKY]);
  });

  it('a preferred model outside the approved exact allowlist cannot escape the filter', async () => {
    const fixture = selectionFixture();
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST], preferredModelId: OUTSIDE })).model).toBe(FIRST);
    expect(fixture.called).toEqual([FIRST]);
  });

  it.each(['PAID', 'UNKNOWN', 'STALE', 'DISABLED'] as const)('preference cannot revive a %s model', async (status) => {
    const fixture = selectionFixture();
    fixture.state.models.find(m => m.exactModelId === STICKY)!.eligibilityStatus = status;
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY })).model).toBe(FIRST);
    expect(fixture.called).toEqual([FIRST]);
  });

  it('preference cannot revive disabled controls or current provider cooldown', async () => {
    for (const mode of ['disabled', 'cooldown']) {
      const fixture = selectionFixture();
      if (mode === 'disabled') fixture.state.controls[STICKY].disabled = true;
      else fixture.state.health[STICKY] = { attempts: 1, successes: 0, latencyMs: null, cooldownUntil: NOW + 60000, status: 'RATE_LIMITED', lastErrorCode: 'HTTP_429' };
      expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY })).model).toBe(FIRST);
      expect(fixture.called).toEqual([FIRST]);
    }
  });

  it('exclusions still win over a preferred approved model', async () => {
    const fixture = selectionFixture();
    const excluded = new Set([STICKY]);
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY, excludeModelIds: excluded })).model).toBe(FIRST);
    expect(fixture.called).toEqual([FIRST]);
    expect(excluded).toEqual(new Set([STICKY, FIRST]));
  });

  it('failed preferred model retries only another approved model, never an outsider', async () => {
    const fixture = selectionFixture();
    fixture.fetcher.mockImplementation(async (_url, init) => {
      const selected = JSON.parse(String(init?.body)).model as string;
      fixture.called.push(selected);
      return selected === STICKY ? json({}, 429, { 'retry-after': '60' }) : json(completion({ model: selected }));
    });
    const result = await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY });
    expect(result.model).toBe(FIRST);
    expect(fixture.called).toEqual([STICKY, FIRST]);
    expect(fixture.api.updateHealth).toHaveBeenCalledWith(STICKY, expect.objectContaining({ cooldownUntil: NOW + 60000, status: 'RATE_LIMITED' }));
  });

  it('one-attempt mode does not expand the allowlist after preferred failure', async () => {
    const fixture = selectionFixture();
    fixture.fetcher.mockImplementation(async (_url, init) => { fixture.called.push(JSON.parse(String(init?.body)).model); return json({}, 503); });
    await expect(fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY, maxAttempts: 1 })).rejects.toMatchObject({ code: 'ALL_FREE_MODELS_FAILED' });
    expect(fixture.called).toEqual([STICKY]);
  });

  it('rechecks a preferred model immediately before dispatch and skips it when revoked', async () => {
    const fixture = selectionFixture();
    vi.mocked(fixture.api.recheck).mockImplementation(async selected => selected.exactModelId !== STICKY);
    expect((await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY })).model).toBe(FIRST);
    expect(fixture.called).toEqual([FIRST]);
    expect(fixture.api.recheck).toHaveBeenCalledTimes(2);
  });

  it('stream selection honors the same allowlist and preference without losing chunks', async () => {
    const fixture = selectionFixture();
    fixture.fetcher.mockImplementation(async (_url, init) => {
      const selected = JSON.parse(String(init?.body)).model as string;
      fixture.called.push(selected);
      return new Response(`data: ${JSON.stringify({ ...completion({ model: selected }), choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const onChunk = vi.fn();
    const result = await fixture.dispatcher.text({ prompt: 'hello', allowedModelIds: [FIRST, STICKY], preferredModelId: STICKY, onChunk });
    expect(result).toMatchObject({ content: 'Hello', model: STICKY });
    expect(onChunk.mock.calls).toEqual([['Hello']]);
    expect(fixture.called).toEqual([STICKY]);
  });
});

describe('registry safety refusals are terminal across approved fallback models', () => {
  it.each([
    { delta: { refusal: 'Provider refusal' }, finish_reason: null },
    { delta: {}, finish_reason: 'content_filter' },
  ])('a refusal after visible text keeps its safety classification and never falls through', async choice => {
    const first = 'test/first-approved:free'; const second = 'test/second-approved:free';
    const { api } = store([model(first), model(second)]);
    const chunks = [{ id: 'test', model: first, choices: [{ delta: { content: 'Partial answer' }, finish_reason: null }] }, { id: 'test', model: first, choices: [choice] }];
    const fetcher = vi.fn(async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'));
    const onChunk = vi.fn();
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [first, second], preferredModelId: first, onChunk })).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onChunk.mock.calls).toEqual([['Partial answer']]);
  });

  it.each([
    { label: 'message refusal', envelope: { choices: [{ message: { content: null, refusal: 'Provider refusal' }, finish_reason: 'stop' }] } },
    { label: 'content filter finish', envelope: { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] } },
    { label: 'structured safety error', envelope: { error: { code: 'content_policy_violation', message: 'Provider refusal' } } },
  ])('nonstream $label never requests a second model', async ({ envelope }) => {
    const first = 'test/first-approved:free'; const second = 'test/second-approved:free';
    const { api } = store([model(first), model(second)]);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const selected = JSON.parse(String(init?.body)).model;
      return json(selected === first ? { id: 'test', model: first, ...envelope } : completion({ model: second }));
    });
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [first, second], preferredModelId: first })).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { delta: { content: null, refusal: 'Provider refusal' }, finish_reason: null },
    { delta: {}, finish_reason: 'content_filter' },
  ])('stream refusal never emits content or requests another approved model', async choice => {
    const first = 'test/first-approved:free'; const second = 'test/second-approved:free';
    const { api } = store([model(first), model(second)]);
    const fetcher = vi.fn(async () => new Response(`data: ${JSON.stringify({ id: 'test', model: first, choices: [choice] })}\n\ndata: [DONE]\n\n`));
    const onChunk = vi.fn();
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [first, second], preferredModelId: first, onChunk })).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalled();
  });
});

describe('registry whitespace-only streams are not committed answers', () => {
  it('a throwing consumer cannot start another model after receiving its first real text', async () => {
    const first = 'test/first-approved:free'; const second = 'test/second-approved:free';
    const { api } = store([model(first), model(second)]);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const selected = JSON.parse(String(init?.body)).model;
      const frame = { id: 'test', model: selected, choices: [{ delta: { content: 'Visible answer' }, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
    const onChunk = vi.fn(() => { throw new Error('Consumer failed after receiving the text'); });
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [first, second], preferredModelId: first, onChunk })).rejects.toMatchObject({ code: 'PARTIAL_RESPONSE_INTERRUPTED' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onChunk.mock.calls).toHaveLength(1);
  });

  it('does not emit an empty rung and leaves outer fallback available after its one allowed attempt', async () => {
    const selected = 'test/first-approved:free';
    const { api } = store([model(selected)]);
    const frame = { id: 'test', model: selected, choices: [{ delta: { content: '  \n\t' }, finish_reason: 'stop' }] };
    const fetcher = vi.fn(async () => new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`));
    const onChunk = vi.fn();
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [selected], maxAttempts: 1, onChunk })).rejects.toMatchObject({ code: 'ALL_FREE_MODELS_FAILED' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('preserves buffered whitespace exactly once when actual text arrives', async () => {
    const selected = 'test/first-approved:free';
    const { api } = store([model(selected)]);
    const frames = [
      { id: 'test', model: selected, choices: [{ delta: { content: '  ' }, finish_reason: null }] },
      { id: 'test', model: selected, choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
      { id: 'test', model: selected, choices: [{ delta: { content: ' again' }, finish_reason: 'stop' }] },
    ];
    const fetcher = vi.fn(async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'));
    const onChunk = vi.fn();
    expect(await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'hello', allowedModelIds: [selected], maxAttempts: 1, onChunk })).toMatchObject({ content: '  Hello again' });
    expect(onChunk.mock.calls).toEqual([['  Hello'], [' again']]);
  });
});

describe('optional gateway hooks preserve legacy registry semantics', () => {
  it('legacy calls have no async gateway requirement and still emit verified proof', async () => {
    const { api } = store(); const fetcher = vi.fn(async () => json(completion()));
    const result = await new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'Hello' });
    expect(fetcher).toHaveBeenCalledOnce(); expect(isVerifiedFreeProof(result.pricingProof)).toBe(true);
  });
  it('gateway hooks cannot enable inner retries', async () => {
    const { api } = store(); const fetcher = vi.fn();
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'Hello', gateway: {
      modelId: 'test/model:free', endpointTag: 'test/endpoint', registryVersion: 'version',
      authorizeDispatch: async () => true, assertDispatchPolicy: () => {}, beforeVisibleOutput: async () => {},
    } })).rejects.toMatchObject({ code: 'GATEWAY_AUTHORIZATION_REQUIRED' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('legacy still uses three-attempt fallback when hooks are absent', async () => {
    const { api } = store([model('test/a:free'), model('test/b:free'), model('test/c:free')]);
    const fetcher = vi.fn(async () => json({}, 500));
    await expect(new StrictFreeDispatcher(api, () => cfg, fetcher, () => NOW).text({ prompt: 'Hello' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
