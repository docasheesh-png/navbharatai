import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getServerDb: vi.fn(), refresh: vi.fn(), read: vi.fn(), transport: vi.fn(), factory: vi.fn(), persist: vi.fn(), reserve: vi.fn(), unattempted: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: mocks.getServerDb }));
vi.mock('./receiptStore', () => ({ persistSurplusReceipt: mocks.persist, reserveSurplusAttempt: mocks.reserve, resolveSurplusUnattempted: mocks.unattempted }));
vi.mock('./runtime', async importOriginal => ({ ...await importOriginal<typeof import('./runtime')>(), refreshSurplusRegistry: mocks.refresh }));
vi.mock('./store', () => ({ SurplusStore: class { read = mocks.read; } }));
vi.mock('./transport', () => ({ createSurplusBuildTransport: mocks.factory }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { createSurplusBuildSession, type SurplusReviewedState } from './buildSession';
import { createProductionSurplusAdapter, SURPLUS_REVIEWS_DOCUMENT, type SurplusProductionReviews } from './productionAdapter';
import { isSurplusReceiptDecision } from './receiptPolicy';
const now = 1800000000000;
function state(): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [{ model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
      discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified', observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://www.surplusintelligence.ai/api/markets/model-a' }] },
    reviews: { quality: [{ binding: 'model-provider', model: 'model-a', providerId: 'provider-a', benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 }], pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: [{ reviewId: 'capability', model: 'model-a', modelVersion: 'reviewed-v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' }],
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  };
}
const params = { model: 'ignored-legacy-model', system: 'build', messages: [{ role: 'user' as const, content: 'Make app' }], tools: [], maxTokens: 100 };
function setup() {
  const s = state();
  const config: SurplusProductionReviews = {
    ...s,
    revision: 1,
    account: { accountId: 'account', credentialSha256: createHash('sha256').update('synthetic-test-key').digest('hex'), marketplaceOnly: true, noFallbackKeys: true, reviewedUntil: now + 300000,
      liveCredentialCheckAt: now - 1000, liveCredentialCheckExpiresAt: now + 300000 },
    pilot: { id: 'pilot', expiresAt: now + 300000, maxCalls: 5, maxEstimatedMicroUsd: '100000', providerSpendLimitReviewedUntil: now + 300000, noAutoTopup: true },
    usageMappings: [{ reviewId: 'usage-review', model: 'model-a', reviewedAt: now - 1000, expiresAt: now + 300000,
      cacheRead: 'prompt_tokens_details.cached_tokens', cacheWrite: 'unsupported', reasoning: 'included-in-completion-output-rate', additionalCharges: 'none' }],
    tariffs: [{ kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official-provider.example/pricing',
      artifactSha256: 'b'.repeat(64), reviewId: 'tariff-review', reviewedAt: now - 2000, reviewExpiresAt: now + 300000,
      effectiveFrom: now - 10000, effectiveUntil: null, observedAt: now - 3000,
      surplusModelId: 'model-a', surplusModelVersion: 'reviewed-v1', officialModelId: 'official-model', officialModelVersion: 'official-version',
      modelMappingReviewId: 'model-mapping', usageMappingReviewId: 'usage-review', currency: 'USD', billingBasis: 'tokens-only',
      usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: 'not-supported', reasoning: '2' } }],
  };
  const wire = { status: 200, receivedAt: now + 1, headers: { 'x-si-provider-family': 'provider-a', 'x-si-served-by': 'marketplace' } as Record<string, string>,
    body: { id: 'response-1', model: 'model-a', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 100 }, buyer_cost_micro: 100 } as Record<string, unknown>,
      surplus: undefined as Record<string, unknown> | undefined } };
  const doc = vi.fn(() => ({ get: vi.fn(async () => ({ data: () => config })) }));
  mocks.getServerDb.mockReturnValue({ doc }); mocks.read.mockResolvedValue(s.snapshot);
  mocks.persist.mockResolvedValue({ canContinue: true }); mocks.unattempted.mockResolvedValue({ canContinue: true });
  mocks.refresh.mockResolvedValue(undefined); mocks.factory.mockReturnValue(mocks.transport);
  mocks.transport.mockImplementation(async () => { vi.setSystemTime(now + 1); return wire; });
  const env = { AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'synthetic-test-key', SURPLUS_REGISTRY_MODELS: 'model-a,model-b,model-c,model-d' };
  const adapter = createProductionSurplusAdapter(env);
  const make = () => createSurplusBuildSession({ buildId: 'build', tier: 'off', enabled: true, adapter });
  const run = async () => (await make())!.runner().runTurn(params);
  return { config, wire, adapter, make, run, doc, env };
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });
describe('production Surplus adapter through the actual build-session factory', () => {
  it('loads only the server review document and dispatches the exact price/provider/model binding', async () => {
    const { run, doc } = setup(); const result = await run();
    expect(doc).toHaveBeenCalledWith(SURPLUS_REVIEWS_DOCUMENT);
    expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a', provider: 'provider-a', si_route: { objective: 'price' }, stream: false }), expect.any(AbortSignal));
    expect(result.text).toBe('done');
    expect(result.usage.surplusReceipt).toMatchObject({ status: 'chargeable', actualCostUsd: '0.0001', userChargeUsd: '0.001',
      officialCeilingUsd: '0.00111', expenseEvidence: 'provider-reported-actual' });
    expect(isSurplusReceiptDecision(result.usage.surplusReceipt)).toBe(true);
  });
  it('caps exactly at the official same-usage tariff without inventing invoice evidence', async () => {
    const { run, wire } = setup(); wire.body.usage.buyer_cost_micro = '200';
    wire.body.usage.invoice_cost = 9000;
    expect((await run()).usage.surplusReceipt).toMatchObject({ actualCostUsd: '0.0002', userChargeUsd: '0.00111', reason: 'capped_at_verified_official_tariff' });
  });
  it('does not substitute unknown cache usage with zero', async () => {
    const { run, wire } = setup(); delete wire.body.usage.prompt_tokens_details;
    await expect(run()).rejects.toThrow();
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: expect.objectContaining({ status: 'blocked', actualCostUsd: '0.0001', userChargeUsd: '0', reason: 'missing_or_ambiguous_usage' }) }));
  });
  it('does not accept a guessed alternate buyer cost field', async () => {
    const { run, wire } = setup(); delete wire.body.usage.buyer_cost_micro; wire.body.usage.cost = 100;
    await expect(run()).rejects.toThrow();
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: expect.objectContaining({ status: 'blocked', actualCostUsd: null, userChargeUsd: '0' }) }));
  });
  it('supports long-running body metadata without requiring fast response headers', async () => {
    const { run, wire } = setup(); wire.headers = {}; wire.body.surplus = { provider: 'provider-a', served_by: 'marketplace', route_objective: 'price', adapted_params: [], truncated: false };
    expect((await run()).usage.surplusReceipt?.status).toBe('chargeable');
  });
  it.each(['model', 'provider', 'served_by', 'objective', 'adapted'] as const)('rejects returned %s mismatches and absorbs failed output', async kind => {
    const { make, wire } = setup();
    if (kind === 'model') wire.body.model = 'model-b';
    if (kind === 'provider') wire.headers['x-si-provider-family'] = 'provider-b';
    if (kind === 'served_by') wire.headers['x-si-served-by'] = 'fallback';
    if (kind === 'objective') wire.headers['x-si-route-objective'] = 'latency';
    if (kind === 'adapted') wire.headers['x-si-adapted-params'] = 'tools';
    const completed = vi.fn(); const session = await make();
    await expect(session!.runner({ onTurnComplete: completed }).runTurn(params)).rejects.toThrow();
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ surplusReceipt: expect.objectContaining({ status: kind === 'model' || kind === 'provider' ? 'blocked' : 'absorbed', userChargeUsd: '0', actualCostUsd: '0.0001' }) }) }), 'SURPLUS');
  });
  it.each(['headers', 'body'] as const)('absorbs truncated %s output instead of billing salvaged output', async source => {
    const { run, wire } = setup();
    if (source === 'headers') wire.headers['x-si-truncated'] = '1';
    else wire.body.surplus = { truncated: true };
    const result = await run(); expect(result.truncated).toBe(true);
    expect(result.usage.surplusReceipt).toMatchObject({ status: 'absorbed', actualCostUsd: '0.0001', userChargeUsd: '0', reason: 'partial_discard_requires_whole_call_absorption' });
  });
  it.each(['account', 'credential', 'futureCredential'] as const)('blocks invalid %s configuration before transport', async kind => {
    const { run, config } = setup();
    if (kind === 'account') config.account.reviewedUntil = now;
    if (kind === 'credential') config.account.liveCredentialCheckExpiresAt = now;
    if (kind === 'futureCredential') config.account.liveCredentialCheckAt = now + 1;
    await expect(run()).rejects.toThrow(); expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it.each(['missingMapping', 'expiredMapping', 'futureMapping', 'missingTariff', 'expiredTariff', 'wrongTariffModel'] as const)('blocks %s review before paid transport', async kind => {
    const { run, config } = setup();
    if (kind === 'missingMapping') config.usageMappings = [];
    if (kind === 'expiredMapping') config.usageMappings[0].expiresAt = now;
    if (kind === 'futureMapping') config.usageMappings[0].reviewedAt = now + 1;
    if (kind === 'missingTariff') config.tariffs = [];
    if (kind === 'expiredTariff') config.tariffs[0].reviewExpiresAt = now;
    if (kind === 'wrongTariffModel') config.tariffs[0].surplusModelId = 'different';
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('requires the tariff-referenced mapping itself to be current before spending', async () => {
    const { run, config } = setup();
    config.usageMappings.unshift({ ...config.usageMappings[0], reviewId: 'stale-mapping', expiresAt: now });
    config.tariffs[0].usageMappingReviewId = 'stale-mapping';
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('selects the validated tariff rather than an earlier expired model match', async () => {
    const { run, config } = setup();
    config.tariffs.unshift({ ...config.tariffs[0], snapshotId: 'expired', reviewExpiresAt: now });
    expect((await run()).usage.surplusReceipt).toMatchObject({ status: 'chargeable', userChargeUsd: '0.001' });
  });
  it('rejects a credential-bearing official tariff URL before spending', async () => {
    const { run, config } = setup(); config.tariffs[0].sourceUrl = 'https://user:pass@official-provider.example/pricing';
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('keeps the receipt audit explicitly unreconciled and preserves process-issued billing authority', async () => {
    const { run } = setup(); const result = await run();
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      invoiceReconciliation: 'not-reconciled', decision: result.usage.surplusReceipt,
    }));
    expect(isSurplusReceiptDecision(result.usage.surplusReceipt)).toBe(true);
  });
  it.each(['missing', 'wrong', 'rotated'] as const)('blocks %s credential evidence before any inference', async kind => {
    const { run, config, env } = setup();
    if (kind === 'missing') config.account.credentialSha256 = '';
    if (kind === 'wrong') config.account.credentialSha256 = 'a'.repeat(64);
    if (kind === 'rotated') env.SURPLUS_API_KEY = 'changed-synthetic-key';
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it.each(['mapping', 'tariff'] as const)('blocks ambiguous current %s reviews before inference', async kind => {
    const { run, config } = setup();
    if (kind === 'mapping') config.usageMappings.push({ ...config.usageMappings[0], reviewId: 'another-current-mapping' });
    else config.tariffs.push({ ...config.tariffs[0], snapshotId: 'another-current-tariff' });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('does not mutate database review records while filtering invalid capabilities', async () => {
    const { adapter, config } = setup();
    config.capabilities.push({ ...config.capabilities[0], model: 'unsupported-model' });
    const before = structuredClone(config); const state = await adapter.readState();
    expect(state.capabilities).toHaveLength(1); expect(config).toEqual(before);
  });
  it('reserves durably before transport and does not call HTTP when reservation fails', async () => {
    const { run } = setup(); mocks.reserve.mockRejectedValue(new Error('pilot exhausted'));
    await expect(run()).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(mocks.reserve).toHaveBeenCalledOnce(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('requires bounded pilot authority before registry refresh or inference', async () => {
    const { run, config } = setup(); config.pilot.maxCalls = 0;
    await expect(run()).rejects.toThrow(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('blocks credential rotation while durable reservation is in progress', async () => {
    const { run, env } = setup(); mocks.reserve.mockImplementation(async () => { env.SURPLUS_API_KEY = 'rotated-after-reservation'; });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('keeps a permit bound to its own immutable account even when another state is read', async () => {
    const { run, config, adapter } = setup();
    mocks.reserve.mockImplementation(async () => {
      config.account.accountId = 'another-account'; config.tariffs[0].usdPerMillionTokens.input = '100';
      await adapter.readState();
    });
    const result = await run();
    expect(result.usage.surplusReceipt).toMatchObject({ accountId: 'account', userChargeUsd: '0.001', officialCeilingUsd: '0.00111' });
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountId: 'account' }));
  });
  it('does not let an empty body adaptation list hide a positive adaptation header', async () => {
    const { run, wire } = setup(); wire.headers['x-si-adapted-params'] = 'tools'; wire.body.surplus = { adapted_params: [] };
    await expect(run()).rejects.toThrow();
  });
  it('does not let a false body truncation flag hide a positive truncation header', async () => {
    const { run, wire } = setup(); wire.headers['x-si-truncated'] = '1'; wire.body.surplus = { truncated: false };
    expect((await run()).usage.surplusReceipt).toMatchObject({ status: 'absorbed', userChargeUsd: '0' });
  });
  it('rejects contradictory body and header provider identity', async () => {
    const { run, wire } = setup(); wire.body.surplus = { provider: 'provider-b' };
    await expect(run()).rejects.toThrow();
  });
  it('rechecks mapping expiry after reservation before the first HTTP request', async () => {
    const { run, config } = setup(); config.usageMappings[0].expiresAt = now + 10;
    mocks.reserve.mockImplementation(async () => { vi.setSystemTime(now + 10); });
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('rejects credential rotation between authorization and dispatch', async () => {
    const { run, adapter, env } = setup(); const bind = adapter.bind!.bind(adapter);
    adapter.bind = (permit, state, review) => { bind(permit, state, review); env.SURPLUS_API_KEY = 'new-unreviewed-key'; };
    await expect(run()).rejects.toThrow(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it.each(['floor', 'quality', 'pricing', 'privacy'] as const)('rechecks %s evidence after the reservation wait and never sends stale HTTP', async kind => {
    const { run, config } = setup();
    if (kind === 'floor') config.floorContract.expiresAt = now + 10;
    if (kind === 'quality') config.reviews.quality[0].expiresAt = now + 10;
    if (kind === 'pricing') config.reviews.pricingContract!.expiresAt = now + 10;
    if (kind === 'privacy') config.reviews.accountAndPrivacyReviewedUntil = now + 10;
    mocks.reserve.mockImplementation(async () => { vi.setSystemTime(now + 10); });
    await expect(run()).rejects.toThrow(); expect(mocks.reserve).toHaveBeenCalledOnce(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('serializes parallel runner instances until the first receipt has durably cleared the pilot slot', async () => {
    const { make, wire } = setup(); const events: string[] = []; let pending = false;
    let releaseFirst!: () => void, markStarted!: () => void;
    const firstStarted = new Promise<void>(resolve => { markStarted = resolve; });
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    mocks.reserve.mockImplementation(async () => {
      if (pending) throw new Error('overlapping pilot reservation'); pending = true; events.push('reserve');
    });
    mocks.persist.mockImplementation(async () => { events.push('persist'); pending = false; });
    let calls = 0;
    mocks.transport.mockImplementation(async () => {
      calls += 1; events.push('http');
      if (calls === 1) { markStarted(); await firstGate; }
      vi.setSystemTime(now + calls); return { ...wire, receivedAt: now + calls, body: { ...wire.body, id: `response-${calls}` } };
    });
    const session = await make(); const first = session!.runner().runTurn(params);
    await firstStarted;
    const second = session!.runner().runTurn(params);
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    expect(mocks.reserve).toHaveBeenCalledOnce(); expect(mocks.transport).toHaveBeenCalledOnce();
    releaseFirst(); const results = await Promise.all([first, second]);
    expect(results.every(result => result.usage.surplusReceipt?.status === 'chargeable')).toBe(true);
    expect(events).toEqual(['reserve', 'http', 'persist', 'reserve', 'http', 'persist']);
  });
  it('does no database, registry or transport work when the build flag is OFF', async () => {
    setup();
    expect(await createSurplusBuildSession({ buildId: 'build', tier: 'off', enabled: false })).toBeUndefined();
    expect(mocks.getServerDb).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
});

function addModel(config: SurplusProductionReviews, model: string, rate = '2') {
  config.capabilities.push({ ...config.capabilities[0], model, reviewId: 'cap-' + model });
  config.reviews.quality.push({ ...config.reviews.quality[0], model });
  config.usageMappings.push({ ...config.usageMappings[0], model, reviewId: 'usage-' + model });
  config.tariffs.push({ ...config.tariffs[0], surplusModelId: model, usageMappingReviewId: 'usage-' + model, snapshotId: 'tariff-' + model });
  const observation = state().snapshot!;
  return { ...observation.offers[0], model, offerId: 'offer-' + model, rates: { input: rate, output: rate } };
}
describe('bounded fallback through production session and durable evidence', () => {
  it.each(['minimum_discount_not_met', 'no_sellers_for_model'])('silently selects eligible fallback after documented %s and keeps winner sticky', async code => {
    const { config, make, wire } = setup(); vi.setSystemTime(now + 1); const snapshot = state().snapshot!;
    snapshot.models.push('model-b'); snapshot.offers.push(addModel(config, 'model-b'));
    mocks.read.mockResolvedValue(snapshot);
    mocks.transport.mockImplementation(async request => request.model === 'model-a'
      ? { status: 404, receivedAt: now + 1, headers: {}, body: { error: { type: 'invalid_request_error', code, message: 'untrusted provider explanation' }, request_id: 'trace-one' } }
      : { ...wire, body: { ...wire.body, id: 'response-b', model: request.model } });
    const session = (await make())!, onText = vi.fn(), complete = vi.fn();
    const result = await session.runner({ onTurnComplete: complete }).runTurn({ ...params, onText });
    expect(result.model).toBe('model-b'); expect(session.model).toBe('model-b'); expect(onText).toHaveBeenCalledExactlyOnceWith('done');
    expect(mocks.unattempted).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ reason: code, traceRequestId: 'trace-one', model: 'model-a' }));
    expect(complete).toHaveBeenCalledTimes(1);
    await session.runner().runTurn(params);
    expect(mocks.transport.mock.calls.map(([r]) => r.model)).toEqual(['model-a', 'model-b', 'model-b']);
  });
  it('authorizes concurrent queued turns only after the fallback winner is sticky', async () => {
    const { config, make, wire } = setup(); vi.setSystemTime(now + 1); const snapshot = state().snapshot!;
    snapshot.models.push('model-b'); snapshot.offers.push(addModel(config, 'model-b')); mocks.read.mockResolvedValue(snapshot);
    mocks.transport.mockImplementation(async request => request.model === 'model-a'
      ? { status: 404, receivedAt: now + 1, headers: {}, body: { error: { type: 'invalid_request_error', code: 'minimum_discount_not_met' }, request_id: 'trace-one' } }
      : { ...wire, body: { ...wire.body, id: 'response-' + mocks.transport.mock.calls.length, model: request.model } });
    const session = (await make())!;
    const results = await Promise.all([session.runner().runTurn(params), session.runner().runTurn(params)]);
    expect(results.map(r => r.model)).toEqual(['model-b', 'model-b']);
    expect(mocks.transport.mock.calls.map(([r]) => r.model)).toEqual(['model-a', 'model-b', 'model-b']);
    expect(session.model).toBe('model-b');
  });
  it('keeps absorbed supplier expense for a fully accounted empty answer before switching model', async () => {
    const { config, make, wire } = setup(); vi.setSystemTime(now + 1); const snapshot = state().snapshot!;
    snapshot.models.push('model-b'); snapshot.offers.push(addModel(config, 'model-b')); mocks.read.mockResolvedValue(snapshot);
    mocks.transport.mockImplementation(async request => ({ ...wire, body: { ...wire.body, id: 'response-' + request.model, model: request.model,
      choices: [{ message: { role: 'assistant', content: request.model === 'model-a' ? '' : 'done' }, finish_reason: 'stop' }] } }));
    const complete = vi.fn(); await (await make())!.runner({ onTurnComplete: complete }).runTurn(params);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].usage.surplusReceipt).toMatchObject({ status: 'absorbed', actualCostUsd: '0.0001', userChargeUsd: '0' });
    expect(complete.mock.calls[1][0].usage.surplusReceipt).toMatchObject({ status: 'chargeable', modelId: 'model-b' });
  });
  it('retains refusal expense but forbids fallback even if a caller misclassifies it as empty', async () => {
    const { config, make, wire, adapter } = setup(); vi.setSystemTime(now + 1); const snapshot = state().snapshot!;
    snapshot.models.push('model-b'); snapshot.offers.push(addModel(config, 'model-b')); mocks.read.mockResolvedValue(snapshot);
    Object.assign(wire.body.choices[0].message, { content: null, refusal: 'Policy refusal' });
    const dispatch = vi.spyOn(adapter, 'dispatch'), complete = vi.fn(), onText = vi.fn();
    const session = (await make())!;
    await expect(session.runner({ onTurnComplete: complete }).runTurn({ ...params, onText })).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(mocks.transport).toHaveBeenCalledOnce(); expect(onText).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0].usage.surplusReceipt).toMatchObject({ status: 'absorbed', actualCostUsd: '0.0001', userChargeUsd: '0' });
    const outcome = await adapter.failure!(wire, dispatch.mock.calls[0][2], complete.mock.calls[0][0],
      { stage: 'response_validation', reason: 'empty_completion', attempt: 1, hasResponse: true });
    expect(outcome.canRetry).toBe(false);
    await expect(session.runner().runTurn(params)).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(mocks.transport).toHaveBeenCalledOnce();
  });
  it.each(['unknown-network', 'shared-quota', 'quarantine', 'missing-usage'])('does not fallback for %s and poisons later dispatch', async kind => {
    const { config, make, wire } = setup(); vi.setSystemTime(now + 1); const snapshot = state().snapshot!;
    snapshot.models.push('model-b'); snapshot.offers.push(addModel(config, 'model-b')); mocks.read.mockResolvedValue(snapshot);
    if (kind === 'unknown-network') mocks.transport.mockRejectedValue(new Error('timeout'));
    else if (kind === 'shared-quota') mocks.transport.mockResolvedValue({ status: 429, receivedAt: now, headers: {}, body: { error: { code: 'rate_limit_exceeded' }, request_id: 'trace' } });
    else {
      wire.body.choices[0].message.content = '';
      if (kind === 'quarantine') mocks.persist.mockResolvedValue({ canContinue: false });
      if (kind === 'missing-usage') delete wire.body.usage.prompt_tokens_details;
    }
    const session = (await make())!;
    await expect(session.runner().runTurn(params)).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    await expect(session.runner().runTurn(params)).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
  });
  it('rejects provisioning credentials before any paid request', async () => {
    const { env, config, run } = setup(); env.SURPLUS_API_KEY = 'inf_admin_example'; config.account.credentialSha256 = createHash('sha256').update(env.SURPLUS_API_KEY).digest('hex');
    await expect(run()).rejects.toThrow(); expect(mocks.transport).not.toHaveBeenCalled();
  });
});
