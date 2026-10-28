import { RESERVATION_REJECTIONS, reservationRejection } from './reservationDiagnostic';
import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';
import { createHash } from 'node:crypto';
import { readScopeFailure } from '../../AgentV3/scopeFailureDiagnostic';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getServerDb: vi.fn(), refresh: vi.fn(), read: vi.fn(), transport: vi.fn(), factory: vi.fn(), persist: vi.fn(), reserve: vi.fn(), unattempted: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: mocks.getServerDb }));
vi.mock('./receiptStore', () => ({ persistSurplusReceipt: mocks.persist, reserveSurplusAttempt: mocks.reserve, resolveSurplusUnattempted: mocks.unattempted }));
vi.mock('./runtime', async importOriginal => ({ ...await importOriginal<typeof import('./runtime')>(), refreshSurplusRegistry: mocks.refresh }));
vi.mock('./store', () => ({ SurplusStore: class { read = mocks.read; } }));
vi.mock('./transport', () => ({ createSurplusBuildTransport: mocks.factory }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { createSurplusBuildSession, type SurplusReviewedState } from './buildSession';
import { createProductionSurplusAdapter } from './productionAdapter';
import { isSurplusReceiptDecision } from './receiptPolicy';
import * as liveAdmission from './liveAdmission';
const now = 1800000000000;
function snapshot(): NonNullable<SurplusReviewedState['snapshot']> {
  return { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [{ model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
    discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified', observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://www.surplusintelligence.ai/api/markets/model-a' }] };
}
const params = { model: 'ignored-legacy-model', system: 'build', messages: [{ role: 'user' as const, content: 'Make app' }], tools: [], maxTokens: 100 };
function setup(extraEnv: Record<string, string> = {}) {
  const snap = snapshot();
  const wire = { status: 200, receivedAt: now + 1, headers: { 'x-si-provider-family': 'provider-a', 'x-si-served-by': 'marketplace' } as Record<string, string>,
    body: { id: 'response-1', model: 'model-a', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 100 }, buyer_cost_micro: 100 } as Record<string, unknown>,
      surplus: undefined as Record<string, unknown> | undefined } };
  mocks.getServerDb.mockReturnValue({ doc: vi.fn(() => ({ get: vi.fn(async () => ({ data: () => ({}) })) })) });
  mocks.read.mockResolvedValue(snap);
  mocks.persist.mockResolvedValue({ canContinue: true }); mocks.unattempted.mockResolvedValue({ canContinue: true });
  mocks.refresh.mockResolvedValue(undefined); mocks.factory.mockReturnValue(mocks.transport);
  mocks.transport.mockImplementation(async () => { vi.setSystemTime(now + 1); return wire; });
  const env = { AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'synthetic-test-key', SURPLUS_REGISTRY_MODELS: 'model-a,model-b,model-c,model-d', ...extraEnv };
  const adapter = createProductionSurplusAdapter(env);
  const make = () => createSurplusBuildSession({ buildId: 'build', tier: 'weak', enabled: true, adapter });
  const run = async () => (await make())!.runner().runTurn(params);
  return { snap, wire, adapter, make, run, env };
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('production Surplus adapter — live key+flag admission', () => {
  it('a coding cancellation cancels transport without retry or invented receipt', async () => {
    const { make } = setup();
    let dispatchedSignal: AbortSignal | undefined;
    mocks.transport.mockImplementation((_request, signal: AbortSignal) => {
      dispatchedSignal = signal;
      return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT'))));
    });
    const session = (await make())!;
    const abort = new AbortController();
    const result = session.runner().runTurn({ ...params, signal: abort.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(dispatchedSignal?.aborted).toBe(false);
    abort.abort();
    expect(await result).toBeInstanceOf(Error);
    expect(dispatchedSignal?.aborted).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(RESERVATION_REJECTIONS)('retains trusted reservation predicate %s without dispatch', async reason => {
    const { make } = setup();
    mocks.reserve.mockRejectedValue(reservationRejection(reason, 'PRIVATE_PREDICATE_DETAIL'));
    const session = (await make())!;
    const result = await session.runner().runTurn(params).catch(error => error);
    expect(readScopeFailure(result)).toEqual({ stage: 'reservation', reason });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(mocks.transport).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(['reservation', 'dispatch', 'receipt'] as const)('retains %s failure through real coding session and public folding', async stage => {
    const { make } = setup();
    if (stage === 'reservation') mocks.reserve.mockRejectedValue(new Error('PRIVATE_PILOT_ERROR'));
    if (stage === 'dispatch') mocks.transport.mockRejectedValue(new Error('PRIVATE_HTTP_ERROR'));
    if (stage === 'receipt') mocks.persist.mockRejectedValue(new Error('PRIVATE_RECEIPT_ERROR'));
    const session = (await make())!;
    const result = await session.runner().runTurn(params).catch(error => error);
    expect(readScopeFailure(result)).toEqual({ stage, reason: stage === 'reservation' ? 'reservation_failed' : `${stage}_failed` });
    expect(result).toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.transport).toHaveBeenCalledTimes(stage === 'reservation' ? 0 : 1);
  });
  it.each([false, true])('reserves and dispatches the cheapest seller when a model has multiple sellers (reversed=%s)', async reversed => {
    const { snap, wire, env, run } = setup();
    snap.offers[0].rates = { input: '3', output: '3' };
    snap.offers.push({ ...snap.offers[0], providerId: 'provider-b', offerId: 'offer-b', rates: { input: '1', output: '1' } });
    addOffer(snap, 'model-b', '5');
    if (reversed) snap.offers.reverse();
    const before = structuredClone(snap);
    const evidence = liveAdmission.synthesizeLiveReviews(env, snap, now);
    expect(evidence.capabilities.map(c => [c.model, c.providerId]).sort()).toEqual([
      ['model-a', 'provider-a'], ['model-a', 'provider-b'], ['model-b', 'provider-a'],
    ]);
    expect(evidence.reviews.quality).toHaveLength(3);
    wire.headers['x-si-provider-family'] = 'provider-b';
    const result = await run();
    expect(result.text).toBe('done');
    expect(result.usage.surplusReceipt?.status).toBe('chargeable');
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ model: 'model-a', providerId: 'provider-b' }));
    expect(mocks.transport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'model-a', provider: 'provider-b', si_route: { objective: 'price' } }), expect.any(AbortSignal));
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.transport.mock.invocationCallOrder[0]);
    expect(evidence.usageMappings.map(m => m.model).sort()).toEqual(['model-a', 'model-b']);
    expect(evidence.tariffs.map(t => t.surplusModelId).sort()).toEqual(['model-a', 'model-b']);
    expect(snap).toEqual(before);
  });
  it.each(['mapping', 'tariff'] as const)('rejects genuinely conflicting model %s evidence before reservation or HTTP', async kind => {
    const synthesize = liveAdmission.synthesizeLiveReviews;
    vi.spyOn(liveAdmission, 'synthesizeLiveReviews').mockImplementation((...args) => {
      const evidence = synthesize(...args);
      if (kind === 'mapping') evidence.usageMappings.push({ ...evidence.usageMappings[0], reviewId: 'conflicting-usage', cacheRead: 'prompt_cache_hit_tokens' });
      else evidence.tariffs.push({ ...evidence.tariffs[0], snapshotId: 'conflicting-tariff', usdPerMillionTokens: { ...evidence.tariffs[0].usdPerMillionTokens, input: '200' } });
      return evidence;
    });
    const { run } = setup();
    await expect(run()).rejects.toThrow();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('synthesizes live admission from key + snapshot and dispatches without Firestore review seed', async () => {
    const { run } = setup(); const result = await run();
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a', provider: 'provider-a', si_route: { objective: 'price' }, stream: false }), expect.any(AbortSignal));
    expect(result.text).toBe('done');
    expect(result.usage.surplusReceipt?.status).toBe('chargeable');
    expect(isSurplusReceiptDecision(result.usage.surplusReceipt)).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: 'surplus-live-key',
      credentialSha256: createHash('sha256').update('synthetic-test-key').digest('hex'),
      pilot: expect.objectContaining({ id: 'owner-live-key-flag-v1', noAutoTopup: true }),
    }));
  });
  it('does not substitute unknown cache usage with zero', async () => {
    const { run, wire } = setup(); delete wire.body.usage.prompt_tokens_details;
    await expect(run()).rejects.toThrow();
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: expect.objectContaining({ status: 'blocked', reason: 'missing_or_ambiguous_usage' }) }));
  });
  it('supports long-running body metadata without requiring fast response headers', async () => {
    const { run, wire } = setup(); wire.headers = {}; wire.body.surplus = { provider: 'provider-a', served_by: 'marketplace', route_objective: 'price', adapted_params: [], truncated: false };
    expect((await run()).usage.surplusReceipt?.status).toBe('chargeable');
  });
  it.each(['model', 'provider', 'served_by', 'objective', 'adapted'] as const)('rejects returned %s mismatches', async kind => {
    const { make, wire } = setup();
    if (kind === 'model') wire.body.model = 'model-b';
    if (kind === 'provider') wire.headers['x-si-provider-family'] = 'provider-b';
    if (kind === 'served_by') wire.headers['x-si-served-by'] = 'fallback';
    if (kind === 'objective') wire.headers['x-si-route-objective'] = 'latency';
    if (kind === 'adapted') wire.headers['x-si-adapted-params'] = 'tools';
    const completed = vi.fn(); const session = await make();
    await expect(session!.runner({ onTurnComplete: completed }).runTurn(params)).rejects.toThrow();
    expect(mocks.transport).toHaveBeenCalledTimes(1);
  });
  it('absorbs truncated header output instead of billing salvaged output', async () => {
    const { run, wire } = setup(); wire.headers['x-si-truncated'] = '1';
    const result = await run(); expect(result.truncated).toBe(true);
    expect(result.usage.surplusReceipt).toMatchObject({ status: 'absorbed', userChargeUsd: '0' });
  });
  it('blocks missing API key before transport', async () => {
    const { run, env } = setup(); delete (env as { SURPLUS_API_KEY?: string }).SURPLUS_API_KEY;
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('blocks admin provisioning keys before transport', async () => {
    const { run } = setup({ SURPLUS_API_KEY: 'inf_admin_example' });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('blocks when builder flag is off', async () => {
    const { run } = setup({ AGENTV3_SURPLUS_BUILDER: 'false' });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('reserves durably before transport and does not call HTTP when reservation fails', async () => {
    const { run } = setup(); mocks.reserve.mockRejectedValue(new Error('pilot exhausted'));
    await expect(run()).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(mocks.reserve).toHaveBeenCalledOnce(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('does no database, registry or transport work when the build flag is OFF', async () => {
    setup();
    expect(await createSurplusBuildSession({ buildId: 'build', tier: 'weak', enabled: false })).toBeUndefined();
    expect(mocks.getServerDb).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('fails closed when metadata snapshot has no offers yet', async () => {
    const { run } = setup();
    mocks.read.mockResolvedValue({ ...snapshot(), offers: [], models: [] });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
});

function addOffer(snap: NonNullable<SurplusReviewedState['snapshot']>, model: string, rate = '2') {
  snap.models.push(model);
  snap.offers.push({ ...snap.offers[0], model, offerId: 'offer-' + model, rates: { input: rate, output: rate } });
}
describe('bounded fallback through live production session', () => {
  it.each(['minimum_discount_not_met', 'no_sellers_for_model'])('silently selects eligible fallback after documented %s', async code => {
    const { snap, make, wire } = setup(); vi.setSystemTime(now + 1);
    addOffer(snap, 'model-b'); mocks.read.mockResolvedValue(snap);
    mocks.transport.mockImplementation(async request => request.model === 'model-a'
      ? { status: 404, receivedAt: now + 1, headers: {}, body: { error: { type: 'invalid_request_error', code, message: 'untrusted provider explanation' }, request_id: 'trace-one' } }
      : { ...wire, body: { ...wire.body, id: 'response-b', model: request.model } });
    const session = (await make())!, onText = vi.fn(), complete = vi.fn();
    const result = await session.runner({ onTurnComplete: complete }).runTurn({ ...params, onText });
    expect(result.model).toBe('model-b'); expect(session.model).toBe('model-b'); expect(onText).toHaveBeenCalledExactlyOnceWith('done');
    expect(mocks.unattempted).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ reason: code, traceRequestId: 'trace-one', model: 'model-a' }));
  });
});
