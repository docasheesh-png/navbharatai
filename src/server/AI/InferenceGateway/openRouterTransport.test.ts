import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeRoutingError, StrictFreeDispatcher, type FreeTextRequest } from '../LiveRegistry/dispatcher';
import { normalizeModel, eligibility } from '../LiveRegistry/eligibility';
import type { RegistryStore, RegistryState } from '../LiveRegistry/types';
import { registryCredentialBinding, type RegistryConfig } from '../LiveRegistry/sync';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { DispatchBinding } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { gatewayTextCredentialBinding, gatewayTextPayloadDigest } from './textTransport';
import { executeGatewayOpenRouter, readGatewayOpenRouterCostAnomaly, readGatewayOpenRouterRejection, readGatewayOpenRouterHealth, readGatewayOpenRouterUsage, type GatewayOpenRouterInput, type GatewayOpenRouterConfig } from './openRouterTransport';
const mocked = vi.hoisted(() => ({ run: vi.fn(), config: vi.fn() }));
vi.mock('../LiveRegistry/runtime', () => ({ strictFreeText: mocked.run, registryConfig: mocked.config }));
const SECRET = 'synthetic-account-key'; const ENV = 'INFERENCE_GATEWAY_OPENROUTER_TEST_KEY';
function bind(input: GatewayOpenRouterInput): GatewayOpenRouterInput {
  const request = { ...input.request, payloadDigest: gatewayTextPayloadDigest({ ...input, streaming: !!input.onChunk }) };
  const p = input.profile;
  const binding: DispatchBinding = {
    key: { logicalRequestId: request.logicalRequestId, principalId: request.principalId, tenantId: request.tenantId, payloadDigest: request.payloadDigest },
    physicalAttemptId: request.nextPhysicalAttemptId, snapshotRevision: 'snapshot-1',
    requestBinding: evidenceBinding(withoutEvidence(request)), profileBinding: evidenceBinding(withoutEvidence(p)),
    profileId: p.id, profileVersion: p.version, providerId: p.providerId, modelId: p.modelId, modelRevision: p.modelRevision,
    adapterId: p.adapterId, payer: request.payer, budgetScopeId: request.budgetScopeId,
    quota: [{ ledgerKey: 'requests', amount: 1 }],

  };
  return { ...input, request, claim: { id: 'reservation-1', claimId: 'claim-1', intentBinding: evidenceBinding(binding), binding, queueWaitConsumedAtDispatchMs: 0 } };
}
function fixture(): GatewayOpenRouterInput {
  const now = Date.now(); const payer = { kind: 'platform' as const, ownerId: 'platform-owner' };
  const quality = { tier: 'standard' as const, gateId: 'gate-1', gateVersion: 'v1' };
  const provider = 'OPENROUTER' as const; const paid = false; const model = 'test/model:free';
  const profile: ProviderProfile = {
    id: 'profile-1', version: 'v1', providerId: provider, modelId: model, modelRevision: 'reviewed-revision', adapterId: 'gateway-openrouter-text-v1',
    status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: ['chat'], qualityApprovals: [quality], termsApprovals: ['terms-v1'],
    capabilities: [{ kind: 'text', maxContextTokens: 4096, maxInputTokens: 2048, maxOutputTokens: 512, streaming: true, systemPrompt: true }],
    privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['reviewed-region'] },
    credentialOwner: payer, quotaDimensions: [{ scope: { providerId: provider, kind: 'account', id: 'reviewed-account' }, meter: 'requests/day' }],
    charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: 'reviewed-profile-evidence',
  };
  const request: RoutingRequest = {
    logicalRequestId: 'request-1', nextPhysicalAttemptId: 'attempt-1', payloadDigest: '', policyRevision: 'policy-v1', termsPolicyId: 'terms-v1',
    budgetScopeId: 'platform-free-fallback', principalId: 'principal-1', tenantId: 'tenant-1', surface: 'chat', quality,
    capability: { kind: 'text', inputTokens: 2048, outputTokens: 512, streaming: false, systemPrompt: false },
    privacy: { dataClass: 'public', policyId: 'privacy-1', allowedProcessingRegions: ['reviewed-region'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false },
    payer, mode: paid ? 'free-first-authorized-paid' : 'strict-free', createdAtMs: now, deadlineAtMs: now + 60000,
    maxQueueWaitMs: 1000, queueWaitConsumedMs: 0, queueEnteredAtMs: now, firstOutputTimeoutMs: 10000, attemptTimeoutMs: 60000,
    cancellation: { id: 'cancellation-1', cancelled: false }, outputVisible: false, maxPhysicalAttempts: 1, attempts: [], evidenceRef: 'request-evidence',
  };
  const transport: GatewayOpenRouterConfig = { provider, model, endpointTag: 'test/endpoint', registryVersion: 'version', maxOutputTokens: 512, timeoutMs: 60000, credentialEnv: ENV, credentialBinding: gatewayTextCredentialBinding(SECRET) };
  return bind({ profile, request, transport, claim: {} as GatewayOpenRouterInput['claim'], prompt: 'Hello', signal: new AbortController().signal,
    reportCostAnomaly: vi.fn(async () => {}), authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(() => {}), markOutputVisible: vi.fn(async () => {}) });
}

let state: RegistryState; let store: RegistryStore; let fetcher: ReturnType<typeof vi.fn>; let cfg: RegistryConfig;
const completion = (extra: Record<string, unknown> = {}) => ({ id: 'provider-request', model: 'test/model:free', choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0 }, ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const packet = (content: string, finish_reason: string | null = null, usage?: unknown) => ({ model: 'test/model:free', choices: [{ delta: { content }, finish_reason }], ...(usage ? { usage } : {}) });
const stream = (packets: unknown[]) => new Response(packets.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const streaming = () => { const input = fixture(); return bind({ ...input, onChunk: vi.fn(), request: { ...input.request, capability: { kind: 'text', inputTokens: 2048, outputTokens: 512, streaming: true, systemPrompt: false } } }); };
beforeEach(() => {
  const now = Date.now(); const id = 'test/model:free';
  const m = normalizeModel({ id, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, context_length: 8192 },
    { data: { id, endpoints: [{ model_id: id, tag: 'test/endpoint', pricing: { prompt: '0', completion: '0' }, context_length: 8192, max_completion_tokens: 8192, supported_parameters: ['max_tokens'] }] } }, true, now, 600000, 'version');
  state = { manifest: { version: 'version', count: 1, fetchedAt: now, expiresAt: now + 600000, accountVerified: true, accountCredentialBinding: registryCredentialBinding(SECRET), transitions: {} }, models: [m],
    controls: { [id]: { disabled: false, termsReviewedUntil: now + 600000, updatedAt: now, actor: 'test', reason: 'reviewed', endpointTag: 'test/endpoint' } }, health: {}, lastSyncAttemptAt: null, lastSyncError: null };
  store = { routingState: vi.fn(async () => state), recheck: vi.fn(async m => state.manifest?.version === m.registryVersion && eligibility(m, state.controls[m.exactModelId], state.health[m.exactModelId], Date.now()).status === 'VERIFIED_FREE'),
    record: vi.fn(async () => {}), updateHealth: vi.fn(async () => {}), quarantine: vi.fn(async () => {}), blockAccount: vi.fn(async () => {}) } as unknown as RegistryStore;
  cfg = { enabled: true, strictFreeModulesEnabled: true, strictFreeWeakEnabled: false, apiKey: SECRET, syncIntervalMs: 300000, metadataTtlMs: 600000 };
  fetcher = vi.fn(async () => json(completion()));
  const dispatcher = new StrictFreeDispatcher(store, () => cfg, fetcher);
  mocked.run.mockImplementation((input: FreeTextRequest) => dispatcher.text(input)); mocked.config.mockImplementation(() => cfg);
  vi.stubEnv(ENV, SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });
describe('gateway uses exact existing verified registry transport', () => {
  it('authorizes once, sends exact zero-cap endpoint once, and emits genuine final proof', async () => {
    const input = fixture(); const order: string[] = [];
    vi.mocked(input.authorizeClaim).mockImplementation(async a => { expect(Object.isFrozen(a)).toBe(true); order.push('authorize'); return true; });
    vi.mocked(input.assertDispatchPolicy).mockImplementation(() => { order.push('policy'); });
    fetcher.mockImplementation(async () => { order.push('fetch'); return json(completion()); });
    vi.mocked(input.markOutputVisible).mockImplementation(async () => { order.push('visible'); });
    const result = await executeGatewayOpenRouter(input);
    expect(order).toEqual(['policy', 'authorize', 'policy', 'fetch', 'visible']);
    expect(input.authorizeClaim).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'test/model:free', provider: { only: ['test/endpoint'], allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } }, plugins: [] });
    expect(mocked.run.mock.calls[0][0].maxAttempts).toBe(1);
    expect(readGatewayOpenRouterUsage(result, input.claim)).toMatchObject({ final: true, inputTokens: 10, outputTokens: 2, actualNanoUsd: 0 });
    expect(readGatewayOpenRouterUsage({ ...result }, input.claim)).toBeUndefined();
    expect(readGatewayOpenRouterUsage(result, { ...input.claim, claimId: 'different' })).toBeUndefined();
  });
  it.each(['endpoint', 'version', 'account', 'terms', 'paid', 'stale', 'cooldown'])('blocks current registry %s mismatch before authorization', async kind => {
    const input = fixture(); const m = state.models[0];
    if (kind === 'endpoint') m.endpointTag = 'other/endpoint';
    if (kind === 'version') state.manifest!.version = 'changed';
    if (kind === 'account') m.accountAvailable = false;
    if (kind === 'terms') state.controls[m.exactModelId].termsReviewedUntil = 0;
    if (kind === 'paid') m.eligibilityStatus = 'PAID';
    if (kind === 'stale') m.metadataExpiresAt = 0;
    if (kind === 'cooldown') state.accountCooldownUntil = Date.now() + 60000;
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); expect(input.authorizeClaim).not.toHaveBeenCalled();
  });
  it('cannot substitute another eligible model', async () => {
    state.models[0].exactModelId = 'other/model:free';
    await expect(executeGatewayOpenRouter(fixture())).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects wrong account credential without dispatch', async () => {
    vi.stubEnv(ENV, 'different-account'); await expect(executeGatewayOpenRouter(fixture())).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires the durable authorization and rechecks terms after it', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { state.controls['test/model:free'].disabled = true; return true; });
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects false one-use authorization', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockResolvedValue(false);
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('awaits first visible fence before streaming bytes', async () => {
    const input = streaming(); const order: string[] = [];
    fetcher.mockResolvedValue(stream([packet('Hello'), packet('', 'stop', { prompt_tokens: 10, completion_tokens: 2, cost: 0 })]));
    vi.mocked(input.markOutputVisible).mockImplementation(async () => { await Promise.resolve(); order.push('fence'); });
    vi.mocked(input.onChunk!).mockImplementation(async () => { order.push('chunk'); });
    const result = await executeGatewayOpenRouter(input); expect(order).toEqual(['fence', 'chunk']); expect(input.markOutputVisible).toHaveBeenCalledOnce();
    expect(readGatewayOpenRouterUsage(result, input.claim)?.actualNanoUsd).toBe(0);
  });
  it('never forwards bytes when visibility fence fails', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([packet('Hello'), packet('', 'stop')]));
    vi.mocked(input.markOutputVisible).mockRejectedValue(new Error('unavailable'));
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(input.onChunk).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not invent complete usage when absent or nonfinal', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([packet('Hello', null, { prompt_tokens: 10, completion_tokens: 1, cost: 0 }), packet(' world'), packet('', 'stop')]));
    const result = await executeGatewayOpenRouter(input); expect(result.completeUsage).toBe(false); expect(readGatewayOpenRouterUsage(result, input.claim)).toBeUndefined();
  });
  it('refusal is terminal with no retries', async () => {
    fetcher.mockResolvedValue(json(completion({ choices: [{ message: { refusal: 'no' }, finish_reason: 'content_filter' }] })));
    await expect(executeGatewayOpenRouter(fixture())).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('cancellation during authorization never dispatches later', async () => {
    const abort = new AbortController(); const input = { ...fixture(), signal: abort.signal };
    let release!: (v: boolean) => void; vi.mocked(input.authorizeClaim).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = executeGatewayOpenRouter(input); const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    while (!release) await Promise.resolve(); abort.abort(); await rejected; release(true); await Promise.resolve(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('cannot authorize changed payload, claim, or unsupported tools', async () => {
    const input = { ...fixture(), prompt: 'Changed' }; await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('HTTP refusal remains terminal rather than becoming an authentication fallback', async () => {
    fetcher.mockResolvedValue(json({ error: { code: 'content_policy_violation' } }, 403));
    await expect(executeGatewayOpenRouter(fixture())).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never mints final proof from early usage followed by an empty finish', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([packet('Hello', null, { prompt_tokens: 10, completion_tokens: 1, cost: 0 }), packet('', 'stop')]));
    const result = await executeGatewayOpenRouter(input); expect(result.completeUsage).toBe(false); expect(readGatewayOpenRouterUsage(result, input.claim)).toBeUndefined();
  });
  it('requires a complete wire stream and rejects text after the terminal finish', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([packet('Hello', 'stop'), packet('should not appear')]));
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(input.onChunk).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('checks exact deployment policy after async authority, before fetch', async () => {
    const input = fixture(); let authorized = false;
    vi.mocked(input.authorizeClaim).mockImplementation(async () => { authorized = true; return true; });
    vi.mocked(input.assertDispatchPolicy).mockImplementation(() => { if (authorized) throw new Error('disabled'); });
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects reported identity mismatch before the first byte', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([{ ...packet('Hello', 'stop'), model: 'wrong/model' }]));
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(input.onChunk).not.toHaveBeenCalled(); expect(input.markOutputVisible).not.toHaveBeenCalled();
  });
  it('never retries a transient error inside registry', async () => {
    fetcher.mockResolvedValue(json({}, 429));
    await expect(executeGatewayOpenRouter(fixture())).rejects.toMatchObject({ code: 'RATE_LIMIT' }); expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'rotated'])('blocks %s catalog credential generation without affecting legacy metadata', async kind => {
    if (kind === 'missing') delete state.manifest!.accountCredentialBinding;
    else { cfg = { ...cfg, apiKey: 'rotated-key' }; vi.stubEnv(ENV, 'rotated-key'); }
    const input = fixture(); await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(input.authorizeClaim).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('blocks credential rotation during async authorization', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => {
      cfg = { ...cfg, apiKey: 'rotated-key' }; vi.stubEnv(ENV, 'rotated-key'); return true;
    });
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('brands only the real HTTP429 rejection for the exact dispatched claim', async () => {
    fetcher.mockResolvedValue(json({}, 429)); const input = fixture();
    const error = await executeGatewayOpenRouter(input).catch(error => error);
    expect(readGatewayOpenRouterRejection(error, input.claim)).toMatchObject({ kind: 'http-rejected', status: 429, generationRejected: true, outputVisible: false, binding: input.claim.binding });
    expect(readGatewayOpenRouterRejection({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayOpenRouterRejection(error, { ...input.claim, claimId: 'other' })).toBeUndefined();
  });
  it('a code-shaped registry error cannot forge rejected-generation evidence', async () => {
    mocked.run.mockRejectedValueOnce(new FreeRoutingError('HTTP_429', 429)); const input = fixture();
    const error = await executeGatewayOpenRouter(input).catch(error => error);
    expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
  });
  it('a stream error after visible text cannot claim zero-work rejection', async () => {
    const input = streaming(); fetcher.mockResolvedValue(stream([packet('Hello'), { error: { code: 429 } }]));
    const error = await executeGatewayOpenRouter(input).catch(error => error);
    expect(input.onChunk).toHaveBeenCalledOnce(); expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ tool_calls: [] }, { function_call: {} }, { content: ['not-text'] }])('does not silently downgrade malformed or tool responses to text', async extra => {
    fetcher.mockResolvedValue(json(completion({ choices: [{ message: { content: 'Hello', ...extra }, finish_reason: 'stop' }] })));
    const input = fixture(); await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(input.markOutputVisible).not.toHaveBeenCalled();
  });

});

describe('final gateway registry boundary regressions', () => {
  it.each([
    { choices: [{ delta: { refusal: 'no' } }] },
    { choices: [{ message: { refusal: 'no' } }] },
    { choices: [{ finish_reason: 'content_filter' }] },
    { choices: [{ finish_reason: 'sensitive' }] },
  ])('does not certify a contradictory safety HTTP429 as retryable: %j', async body => {
    const input = fixture(); fetcher.mockResolvedValue(json(body, 429));
    const error = await executeGatewayOpenRouter(input).catch(error => error);
    expect(error).toMatchObject({ code: 'SAFETY_REFUSAL' });
    expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('validates current gateway authority after the final asynchronous registry read', async () => {
    const input = fixture(); let expired = false; let reads = 0;
    vi.mocked(store.recheck).mockImplementation(async () => { await Promise.resolve(); if (++reads === 2) expired = true; return true; });
    vi.mocked(input.authorizeClaim).mockImplementation(async () => !expired);
    await expect(executeGatewayOpenRouter(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    expect(reads).toBe(2); expect(input.authorizeClaim).toHaveBeenCalledOnce();
  });
  it.each(['pending', 'rejecting'] as const)('finishes terminal DONE without socket EOF or %s cleanup delay', async cleanup => {
    const input = streaming(); const cancel = vi.fn(() => cleanup === 'pending' ? new Promise<void>(() => {}) : Promise.reject(Error('cleanup')));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet('Hello', 'stop', { prompt_tokens: 10, completion_tokens: 2, cost: 0 }))}\n\ndata: [DONE]\n\n`));
    }, cancel });
    fetcher.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const result = await executeGatewayOpenRouter(input); expect(result.content).toBe('Hello');
    expect(readGatewayOpenRouterUsage(result, input.claim)?.actualNanoUsd).toBe(0); expect(cancel).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
});
it.each([{ code: 'safety' }, { type: 'prohibited_content' }, { error: { status: 'safety_refusal' } }, { error: { choices: [{ delta: { refusal: 'no' } }] } }])('does not retry other typed safety schemas on429: %j', async body => {
  const input = fixture(); fetcher.mockResolvedValue(json(body, 429)); const error = await executeGatewayOpenRouter(input).catch(error => error);
  expect(error).toMatchObject({ code: 'SAFETY_REFUSAL' }); expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
});

 describe('durable anomaly reporting', () => {
  it.each([0.01, '0.01', null, 'unknown', -1])('retains a private claim-bound anomaly for cost %s', async cost => {
    const input = fixture(); fetcher.mockResolvedValue(json(completion({ usage: { prompt_tokens: 10, completion_tokens: 2, cost } })));
    const error = await executeGatewayOpenRouter(input).catch(e => e);
    expect(input.reportCostAnomaly).toHaveBeenCalledOnce();
    expect(readGatewayOpenRouterCostAnomaly(error, input.claim)?.kind).toBe('free-cost-contradiction');
    expect(readGatewayOpenRouterUsage(error, input.claim)).toBeUndefined();
    expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
    expect(readGatewayOpenRouterCostAnomaly({}, input.claim)).toBeUndefined();
  });
  it('preserves anomaly evidence when durable reporting aborts the request', async () => {
    const controller = new AbortController(); const input = { ...fixture(), signal: controller.signal };
    vi.mocked(input.reportCostAnomaly).mockImplementation(async () => { controller.abort(); });
    fetcher.mockResolvedValue(json(completion({ usage: { cost: '1' } })));
    const error = await executeGatewayOpenRouter(input).catch(e => e);
    expect(readGatewayOpenRouterCostAnomaly(error, input.claim)).toBeDefined();
    expect(input.markOutputVisible).not.toHaveBeenCalled();
  });
});

it.each([200, 429])('quarantines charged refusal envelopes before status %s classification', async status => {
  const input = fixture();
  fetcher.mockResolvedValue(json({ error: { code: 'safety_violation' }, usage: { cost: '0.1' } }, status));
  const error = await executeGatewayOpenRouter(input).catch(e => e);
  expect(input.reportCostAnomaly).toHaveBeenCalledOnce();
  expect(readGatewayOpenRouterCostAnomaly(error, input.claim)).toBeDefined();
  expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
  expect(input.markOutputVisible).not.toHaveBeenCalled();
});

it('preserves verified registry pricing provenance on the caller response', async () => {
 const input = fixture(); fetcher.mockResolvedValue(json(completion()));
 const result = await executeGatewayOpenRouter(input);
 expect(result.pricingProof).toMatchObject({ registryVersion: 'version', modelId: 'test/model:free', estimatedInferenceUsd: '0' });
});

it.each([
 { choices: [{ message: { content: 'generated despite status' } }] },
 { usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } },
 { error: { choices: [] } },
 { error: { usage: { cost: 0 } } },
])('does not certify a no-generation rejection from a contradictory 429 envelope: %j', async body => {
 const input = fixture(); fetcher.mockResolvedValue(json(body, 429));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
 expect(readGatewayOpenRouterUsage(error, input.claim)).toBeUndefined();
 expect(fetcher).toHaveBeenCalledOnce(); expect(input.markOutputVisible).not.toHaveBeenCalled();
});

it('preserves nested charged-error anomaly before ambiguous 429 classification', async () => {
 const input = fixture(); fetcher.mockResolvedValue(json({ error: { usage: { cost: '0.01' } } }, 429));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(input.reportCostAnomaly).toHaveBeenCalledOnce();
 expect(readGatewayOpenRouterCostAnomaly(error, input.claim)).toBeDefined();
 expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
});

it.each(['pending', 'rejecting'] as const)('does not delay a completed JSON response for %s reader cleanup', async mode => {
 const input = fixture();
 const cancel = vi.fn(() => mode === 'pending' ? new Promise<void>(() => {}) : Promise.reject(Error('cleanup')));
 const read = vi.fn().mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify(completion())) }).mockResolvedValue({ done: true });
 fetcher.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read, cancel }) } } as unknown as Response);
 const result = await executeGatewayOpenRouter(input);
 expect(result.content).toBeTruthy(); expect(cancel).toHaveBeenCalledOnce();
 await Promise.resolve();
});

it.each(['3600', 'date'])('preserves authenticated Retry-After %s rather than retrying after sixty seconds', async value => {
 const input = fixture(); const now = Date.now(); const until = Math.floor((now + 3600000) / 1000) * 1000;
 fetcher.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': value === 'date' ? new Date(until).toUTCString() : value } }));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 const proof = readGatewayOpenRouterRejection(error, input.claim);
 expect(proof?.cooldownUntilMs).toBeGreaterThanOrEqual(until); expect(proof?.cooldownUntilMs).toBeLessThanOrEqual(Date.now() + 3600000);
});
it('never certifies a shorter retry when the provider requests an excessive cooldown', async () => {
 const input = fixture(); fetcher.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '999999999' } }));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
 expect(readGatewayOpenRouterHealth(error, input.claim)).toMatchObject({ kind: 'cooldown-unavailable' });
});

it.each([401,403,500,503])('records physical HTTP%s health separately from money/retry evidence', async status => {
 const input = fixture(); fetcher.mockResolvedValue(json({}, status));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(readGatewayOpenRouterHealth(error, input.claim)).toMatchObject({ kind: status < 500 ? 'auth' : 'transient' });
 expect(readGatewayOpenRouterHealth({ ...error }, input.claim)).toBeUndefined();
 expect(readGatewayOpenRouterRejection(error, input.claim)).toBeUndefined();
 expect(readGatewayOpenRouterUsage(error, input.claim)).toBeUndefined();
});
it('does not create health evidence for pre-dispatch authority rejection', async () => {
 const input = fixture(); input.authorizeClaim.mockResolvedValue(false);
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(readGatewayOpenRouterHealth(error, input.claim)).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
});
it('does not classify safety refusal as provider health failure', async () => {
 const input = fixture(); fetcher.mockResolvedValue(json({ error: { type: 'safety' } }, 503));
 const error = await executeGatewayOpenRouter(input).catch(e => e);
 expect(readGatewayOpenRouterHealth(error, input.claim)).toBeUndefined();
});
