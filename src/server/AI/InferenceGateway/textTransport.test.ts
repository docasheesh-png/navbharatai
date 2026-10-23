import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { realRateFor } from '../../AgentV3/providerRates';
import { usdToNanoUsd, maximumCostNanoUsd } from '../FreeChain/spendCap';
import { runWithInferenceScope } from '../inferencePolicy';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { DispatchBinding } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { executeGatewayText, gatewayTextCredentialBinding, gatewayTextPayloadDigest, readGatewayTextUsage, readGatewayTextHealth, readGatewayTextConservativeUsage, readGatewayTextRejection, readGatewayTextCostAnomaly, GatewayTextTransportError,
  type GatewayTextInput, type GatewayTextProvider, type GatewayTextTransportConfig } from './textTransport';

const SECRET = 'fake-test-secret-never-retain';
const ENV = 'GATEWAY_TEST_CREDENTIAL';
const ENDPOINTS: Record<GatewayTextProvider, string> = {
  GLM: 'https://api.z.ai/api/paas/v4', GEMINI: 'https://generativelanguage.googleapis.com/v1beta/openai',
  GROQ: 'https://api.groq.com/openai/v1', DEEPSEEK: 'https://api.deepseek.com/v1',
  CLOUDFLARE: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1',
};
function bind(input: GatewayTextInput): GatewayTextInput {
  const request = { ...input.request, payloadDigest: gatewayTextPayloadDigest({ ...input, streaming: !!input.onChunk }) };
  const p = input.profile; const paid = p.charging === 'metered'; const rate = input.transport.rateCard;
  const binding: DispatchBinding = {
    key: { logicalRequestId: request.logicalRequestId, principalId: request.principalId, tenantId: request.tenantId, payloadDigest: request.payloadDigest },
    physicalAttemptId: request.nextPhysicalAttemptId, snapshotRevision: 'snapshot-1',
    requestBinding: evidenceBinding(withoutEvidence(request)), profileBinding: evidenceBinding(withoutEvidence(p)),
    profileId: p.id, profileVersion: p.version, providerId: p.providerId, modelId: p.modelId, modelRevision: p.modelRevision,
    adapterId: p.adapterId, payer: request.payer, budgetScopeId: request.budgetScopeId,
    quota: [{ ledgerKey: 'requests', amount: 1 }],
    ...(paid ? { priceBinding: 'reviewed-price', budgetAuthorizationBinding: 'reviewed-budget', budget: {
      payer: request.payer, budgetScopeId: request.budgetScopeId, periodId: 'reviewed-day',
      amountNanoUsd: maximumCostNanoUsd(2048, 512, rate!.inputNanoUsdPerMillion, rate!.outputNanoUsdPerMillion), rateCardVersion: rate!.version,
    } } : {}),
  };
  return { ...input, request, claim: { id: 'reservation-1', claimId: 'claim-1', intentBinding: evidenceBinding(binding), binding, queueWaitConsumedAtDispatchMs: 0 } };
}
function fixture(provider: GatewayTextProvider = 'GLM', paid = false): GatewayTextInput {
  const now = Date.now(); const payer = { kind: 'platform' as const, ownerId: 'platform-owner' };
  const quality = { tier: 'standard' as const, gateId: 'gate-1', gateVersion: 'v1' };
  const model = paid ? 'deepseek-flash' : provider === 'GLM' ? 'glm-4.7-flash' : 'reviewed-model';
  const profile: ProviderProfile = {
    id: 'profile-1', version: 'v1', providerId: provider, modelId: model, modelRevision: 'reviewed-revision', adapterId: 'gateway-text-v1',
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
  const rate = realRateFor('DEEPSEEK', 'deepseek-flash');
  const transport: GatewayTextTransportConfig = { provider, baseURL: ENDPOINTS[provider], model, maxOutputTokens: 512,
    timeoutMs: 60000, streamUsage: true, credentialEnv: ENV, credentialBinding: gatewayTextCredentialBinding(SECRET),
    ...(paid ? { rateCard: { version: 'reviewed-rate-v1', inputNanoUsdPerMillion: usdToNanoUsd(rate.inputPerMTok),
      outputNanoUsdPerMillion: usdToNanoUsd(rate.outputPerMTok), cachedInputNanoUsdPerMillion: usdToNanoUsd(rate.cacheReadPerMTok!),
      verifiedAtMs: now - 1, expiresAtMs: now + 60000 } } : {}) };
  return bind({ profile, request, transport, claim: {} as GatewayTextInput['claim'], prompt: 'Hello', signal: new AbortController().signal,
    authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(() => {}), markOutputVisible: vi.fn(async () => {}), reportCostAnomaly: vi.fn(async () => {}) });
}
function completion(usage: unknown = { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 }, content = 'Hello back') {
  return { choices: [{ index: 0, message: { content }, finish_reason: 'stop' }], usage };
}
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const streamResponse = (packets: unknown[], done = true) => new Response(packets.map(packet => `data: ${JSON.stringify(packet)}\r\n\r\n`).join('')
  + (done ? 'data: [DONE]\r\n\r\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
const chunk = (content: string, finish_reason: string | null = null, usage?: unknown) => ({ choices: [{ index: 0, delta: { content }, finish_reason }], ...(usage ? { usage } : {}) });
function streaming(input = fixture(), onChunk = vi.fn()): GatewayTextInput {
  return bind({ ...input, onChunk, request: { ...input.request, capability: { kind: 'text', inputTokens: 2048, outputTokens: 512, streaming: true, systemPrompt: false } } });
}
let fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => { vi.stubEnv(ENV, SECRET); fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(completion())); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('gateway text endpoint and exact authority boundary', () => {
  it.each(Object.keys(ENDPOINTS) as GatewayTextProvider[])('makes exactly one official %s POST after authorization, with no inherited headers', async provider => {
    const input = fixture(provider); const order: string[] = [];
    vi.mocked(input.authorizeClaim).mockImplementation(async a => { order.push('authorize'); expect(Object.isFrozen(a.transport)).toBe(true); return true; });
    fetchMock.mockImplementation(async () => { order.push('fetch'); return jsonResponse(completion()); });
    const result = await executeGatewayText(input);
    expect(order).toEqual(['authorize', 'fetch']); expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe(`${ENDPOINTS[provider]}/chat/completions`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
    expect(Object.keys(init!.headers!)).toHaveLength(3); expect((init!.signal as AbortSignal).aborted).toBe(true);
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: input.transport.model, stream: false, messages: [{ role: 'user', content: 'Hello' }] });
    expect(input.markOutputVisible).toHaveBeenCalledOnce(); expect(result).toMatchObject({ content: 'Hello back', completeUsage: true, usage: { inputTokens: 100, outputTokens: 20 } });
    expect(readGatewayTextUsage(result, input.claim)).toMatchObject({ final: true, outcome: { kind: 'completed' }, actualNanoUsd: 0, outputVisible: true });
  });
  it.each(['http://api.z.ai/api/paas/v4', 'https://api.z.ai.evil.example/api/paas/v4', 'https://secret@api.z.ai/api/paas/v4',
    'https://api.z.ai:443/api/paas/v4', 'https://api.z.ai/api/paas/v4?secret=x', 'https://api.z.ai/api/paas/v4#x', 'https://api.z.ai/api/paas/v4\n'])('denies endpoint substitution %s before authorization', async baseURL => {
    const input = fixture(); await expect(executeGatewayText({ ...input, transport: { ...input.transport, baseURL } })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(input.authorizeClaim).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not weaken the legacy strict-free guard', async () => {
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
    const result = await runWithInferenceScope('free-modules', () => executeGatewayText(fixture()));
    expect(result.content).toBe('Hello back'); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('requires current authoritative exclusive claim approval, not matching data', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockResolvedValue(false);
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['prompt', 'systemPrompt', 'schema', 'images', 'modelOverride'] as const)('rejects a changed %s after admission', async field => {
    const input = fixture(); const change = field === 'images' ? ['image'] : field === 'schema' ? {} : 'changed';
    await expect(executeGatewayText({ ...input, [field]: change })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ schema: {} }, { schema: null }, { images: ['image'] }, { modelOverride: 'expensive-model' }])('rejects rather than drops unsupported features %j', async feature => {
    await expect(executeGatewayText(bind({ ...fixture(), ...feature }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['qualityApprovals', 'termsApprovals'] as const)('fails closed without %s even with an allowing callback', async field => {
    const input = fixture(); await expect(executeGatewayText(bind({ ...input, profile: { ...input.profile, [field]: [] } }))).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects absent secrets without including credentials in result or errors', async () => {
    vi.stubEnv(ENV, ''); await expect(executeGatewayText(fixture())).rejects.toMatchObject({ code: 'CONFIGURATION' }); expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv(ENV, SECRET); fetchMock.mockRejectedValue(new Error(`Request leaked ${SECRET}`));
    const error = await executeGatewayText(fixture()).catch(e => e);
    expect(error).toBeInstanceOf(GatewayTextTransportError); expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('never permits credential or arbitrary request-body configuration', async () => {
    const input = fixture(); const transport = { ...input.transport, key: SECRET, extraBody: { model: 'expensive' } };
    await expect(executeGatewayText({ ...input, transport })).rejects.toMatchObject({ code: 'CONFIGURATION' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a provider response for an unreviewed substituted model', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...completion(), model: 'unreviewed-model' }));
    const input = fixture(); await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    expect(input.markOutputVisible).not.toHaveBeenCalled();
  });
  it('does not normalize a malformed empty image string into an allowed empty array', async () => {
    const input = fixture(); await expect(executeGatewayText({ ...input, images: '' as unknown as string[] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('copies immutable data before awaiting authority and rechecks cancellation afterward', async () => {
    const controller = new AbortController(); const input = { ...fixture(), signal: controller.signal };
    vi.mocked(input.authorizeClaim).mockImplementation(async a => { expect(a.transport.model).toBe('glm-4.7-flash'); controller.abort(); return true; });
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'ABORTED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects no input capacity instead of trimming the request', async () => {
    const input = fixture(); await expect(executeGatewayText(bind({ ...input, prompt: 'x'.repeat(3000) }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('streaming visibility and measured accounting', () => {
  it('awaits the durable visibility fence before any user chunk and preserves whitespace once', async () => {
    const order: string[] = []; let release: (() => void) | undefined;
    const input = streaming(fixture(), vi.fn(text => { order.push(`chunk:${text}`); }));
    vi.mocked(input.markOutputVisible).mockImplementation(() => new Promise<void>(resolve => { order.push('mark'); release = resolve; }));
    fetchMock.mockResolvedValue(streamResponse([chunk('  '), chunk('Hello'), chunk(' world', 'stop'), { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }]));
    const pending = executeGatewayText(input);
    await vi.waitFor(() => expect(order).toEqual(['mark'])); expect(input.onChunk).not.toHaveBeenCalled();
    release!(); const result = await pending;
    expect(order).toEqual(['mark', 'chunk:  Hello', 'chunk: world']); expect(input.markOutputVisible).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ content: '  Hello world', completeUsage: true });
  });
  it('does not expose any content when the visibility journal fails', async () => {
    const input = streaming(); vi.mocked(input.markOutputVisible).mockRejectedValue(new Error(SECRET));
    fetchMock.mockResolvedValue(streamResponse([chunk('Hello', 'stop', { prompt_tokens: 100, completion_tokens: 20 })]));
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'NETWORK' }); expect(input.onChunk).not.toHaveBeenCalled();
  });
  it('treats [DONE] as the protocol end instead of waiting for a lingering connection', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('Hello', 'stop', { prompt_tokens: 100, completion_tokens: 20 }))}\n\ndata: [DONE]\n\n`));
    }, cancel: cancelled });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const result = await executeGatewayText(streaming()); expect(result.content).toBe('Hello'); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('honors cancellation while the durable output fence is pending', async () => {
    const controller = new AbortController(); const input = { ...streaming(), signal: controller.signal };
    vi.mocked(input.markOutputVisible).mockImplementation(() => new Promise(() => {}));
    fetchMock.mockResolvedValue(streamResponse([chunk('Hello', 'stop')]));
    const pending = executeGatewayText(input); const assertion = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await vi.waitFor(() => expect(input.markOutputVisible).toHaveBeenCalledOnce()); controller.abort(); await assertion;
    expect(input.onChunk).not.toHaveBeenCalled();
  });
  it('invalidates intermediate usage when later text arrives without new totals', async () => {
    const input = streaming(); fetchMock.mockResolvedValue(streamResponse([chunk('Hello', null, { prompt_tokens: 100, completion_tokens: 1 }), chunk(' world', 'stop')]));
    const result = await executeGatewayText(input); expect(result.completeUsage).toBe(false); expect(result.usage).toBeUndefined(); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
  });
  it.each([undefined, {}, { prompt_tokens: 100 }, { prompt_tokens: 100, completion_tokens: '20' }, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 99 },
    { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 101 }])('never invents complete usage from %j', async usage => {
    fetchMock.mockResolvedValue(jsonResponse({ ...completion(), usage })); const input = fixture(); const result = await executeGatewayText(input);
    expect(result.completeUsage).toBe(false); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
  });
  it('does not accept forged/cloned results or usage under a different claim', async () => {
    const input = fixture(); const result = await executeGatewayText(input);
    expect(readGatewayTextUsage({ ...result }, input.claim)).toBeUndefined();
    expect(readGatewayTextUsage(result, { ...input.claim, claimId: 'other' })).toBeUndefined();
    expect(Object.isFrozen(readGatewayTextUsage(result, input.claim))).toBe(true); expect(inspect(result)).not.toContain(SECRET);
  });
  it.each([
    [streamResponse([chunk('answer', 'stop')], false), 'NETWORK'],
    [streamResponse([chunk('answer')]), 'NETWORK'],
    [streamResponse([chunk('blocked', 'content_filter')]), 'SAFETY_REFUSAL'],
    [streamResponse([chunk('not a tool response', 'tool_calls')]), 'INVALID_REQUEST'],
  ])('rejects incomplete or unsupported stream endings', async (response, code) => {
    fetchMock.mockResolvedValue(response); await expect(executeGatewayText(streaming())).rejects.toMatchObject({ code });
  });
  it('rejects refusal before sending same-packet content', async () => {
    const input = streaming(); fetchMock.mockResolvedValue(streamResponse([{ choices: [{ delta: { content: 'blocked', refusal: 'not allowed' }, finish_reason: 'stop' }] }]));
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'SAFETY_REFUSAL' }); expect(input.onChunk).not.toHaveBeenCalled(); expect(input.markOutputVisible).not.toHaveBeenCalled();
  });
  it('uses Groq final extension usage without retaining extension errors', async () => {
    const input = fixture('GROQ'); fetchMock.mockResolvedValue(jsonResponse({ ...completion(null), x_groq: { usage: { prompt_tokens: 3, completion_tokens: 4 } } }));
    expect(await executeGatewayText(input)).toMatchObject({ usage: { inputTokens: 3, outputTokens: 4 }, completeUsage: true });
  });
});

describe('reviewed cost and bounded transport', () => {
  it('keeps measured paid tokens separate from unproven exact billed charges', async () => {
    const input = fixture('DEEPSEEK', true); const rate = input.transport.rateCard!;
    fetchMock.mockResolvedValue(jsonResponse(completion({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 })));
    const result = await executeGatewayText(input);
    expect(result).toMatchObject({ completeUsage: true, usage: { inputTokens: 100, outputTokens: 20 }, cachedInputTokens: 40 });
    expect(readGatewayTextUsage(result, input.claim)).toBeUndefined(); // Peak reservation bounds are not billed-charge evidence.
  });
  it('keeps paid cost unproven when cache counts are missing instead of claiming a guessed actual', async () => {
    const input = fixture('DEEPSEEK', true); fetchMock.mockResolvedValue(jsonResponse(completion({ prompt_tokens: 100, completion_tokens: 20 })));
    const result = await executeGatewayText(input); expect(result.completeUsage).toBe(true); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
  });
  it.each(['expired', 'future', 'underpriced', 'over-ceiling'] as const)('rejects %s reviewed rate cards before dispatch', async bad => {
    const input = fixture('DEEPSEEK', true); const rate = { ...input.transport.rateCard! };
    if (bad === 'expired') rate.expiresAtMs = Date.now() - 1;
    if (bad === 'future') rate.verifiedAtMs = Date.now() + 10000;
    if (bad === 'underpriced') rate.inputNanoUsdPerMillion = 1;
    if (bad === 'over-ceiling') rate.inputNanoUsdPerMillion = 1000000000000;
    await expect(executeGatewayText(bind({ ...input, transport: { ...input.transport, rateCard: rate } }))).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rechecks rate expiry after the asynchronous authorization gate', async () => {
    vi.useFakeTimers(); const initial = fixture('DEEPSEEK', true);
    const input = { ...initial, transport: { ...initial.transport, rateCard: { ...initial.transport.rateCard!, expiresAtMs: Date.now() + 10 } } };
    vi.mocked(input.authorizeClaim).mockImplementation(async () => { vi.setSystemTime(Date.now() + 11); return true; });
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sanitizes unknown error enums even when a trusted dependency throws one', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockRejectedValue(new GatewayTextTransportError(SECRET as never));
    const error = await executeGatewayText(input).catch(e => e); expect(error.code).toBe('NETWORK'); expect(inspect(error)).not.toContain(SECRET);
  });
  it('aborts a stalled fetch at the configured timeout and never retries', async () => {
    vi.useFakeTimers(); const input = fixture(); fetchMock.mockImplementation(() => new Promise(() => {}));
    const pending = executeGatewayText({ ...input, transport: { ...input.transport, timeoutMs: 10 } });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' }); await vi.advanceTimersByTimeAsync(10); await assertion;
    expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it('observes rejected reader cancellation after abort without an unhandled rejection', async () => {
    const controller = new AbortController(); const unhandled: unknown[] = []; const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const input = streaming({ ...fixture(), signal: controller.signal });
      const stream = new ReadableStream<Uint8Array>({ pull() { controller.abort(); }, cancel() { return Promise.reject(new Error('cancel failed')); } });
      fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
      await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'ABORTED' });
      await new Promise(resolve => setTimeout(resolve, 0)); expect(unhandled).toEqual([]);
    } finally { process.removeListener('unhandledRejection', listener); }
  });
  it('cannot turn a valid above-floor reservation tariff into exact paid charges', async () => {
    const input = fixture('DEEPSEEK', true);
    const adjusted = bind({ ...input, transport: { ...input.transport, rateCard: { ...input.transport.rateCard!, inputNanoUsdPerMillion: 310_000_000 } } });
    fetchMock.mockResolvedValue(jsonResponse(completion({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 })));
    const result = await executeGatewayText(adjusted); expect(result.completeUsage).toBe(true); expect(readGatewayTextUsage(result, adjusted.claim)).toBeUndefined();
  });
  it('forwards cancellation to the in-flight HTTP request', async () => {
    const controller = new AbortController(); const input = { ...fixture(), signal: controller.signal };
    fetchMock.mockImplementation(async (_url, init) => { controller.abort(); expect(init!.signal!.aborted).toBe(true); throw new Error(SECRET); });
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'ABORTED' }); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([[401, 'AUTH'], [429, 'RATE_LIMIT'], [503, 'SERVER'], [404, 'MODEL_UNAVAILABLE']] as const)('classifies HTTP %s without retry or raw provider error retention', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: SECRET } }, status));
    const error = await executeGatewayText(fixture()).catch(e => e); expect(error).toMatchObject({ code, status }); expect(JSON.stringify(error)).not.toContain(SECRET); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    { message: { refusal: 'cannot comply' } },
    { delta: { refusal: 'cannot comply' } },
    { finish_reason: 'content_filter' },
  ])('never authenticates a 429 retry when typed refusal contradicts the rate-limit status: %j', async choice => {
    const input = fixture();
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'rate_limit_exceeded' }, choices: [choice] }, 429));
    const error = await executeGatewayText(input).catch(e => e);
    expect(error).toMatchObject({ code: 'SAFETY_REFUSAL', status: 429 });
    expect(readGatewayTextRejection(error, input.claim)).toBeUndefined(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([0.01, '0.01', 'unknown', null])('withholds zero-cost proof for contradictory free usage.cost %j before output', async cost => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse(completion({ prompt_tokens: 10, completion_tokens: 1, cost })));
    const error = await executeGatewayText(input).catch(e => e);
    expect(error).toMatchObject({ code: 'POLICY_BLOCKED' }); expect(input.markOutputVisible).not.toHaveBeenCalled();
    expect(readGatewayTextUsage(error, input.claim)).toBeUndefined(); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
    expect(readGatewayTextCostAnomaly(error, input.claim)).toMatchObject({ kind: 'free-cost-contradiction' });
    expect(readGatewayTextCostAnomaly({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayTextCostAnomaly(error, { ...input.claim, claimId: 'other' })).toBeUndefined();
  });
  it.each([0.01, '0.01'])('retains uncertainty instead of minting zero usage from a late stream cost %j', async cost => {
    const input = streaming(); fetchMock.mockResolvedValue(streamResponse([chunk('visible answer', 'stop'), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, cost } }]));
    const error = await executeGatewayText(input).catch(e => e);
    expect(error).toMatchObject({ code: 'POLICY_BLOCKED' }); expect(input.onChunk).toHaveBeenCalledOnce();
    expect(readGatewayTextUsage(error, input.claim)).toBeUndefined(); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
    expect(readGatewayTextCostAnomaly(error, input.claim)).toMatchObject({ kind: 'free-cost-contradiction' });
    expect(readGatewayTextCostAnomaly({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayTextCostAnomaly(error, { ...input.claim, claimId: 'other' })).toBeUndefined(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('rejects credential rotation after claim without reusing old account approvals', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { vi.stubEnv(ENV, 'different-account-secret'); return true; });
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'abort'] as const)('preserves billing anomaly proof through %s during hanging reader cleanup', async stop => {
    vi.useFakeTimers(); const controller = new AbortController();
    const input = streaming({ ...fixture(), signal: controller.signal });
    const body = new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('never expose', 'stop', { prompt_tokens: 10, completion_tokens: 1, cost: '0.01' }))}\n\n`));
    }, cancel() { if (stop === 'abort') controller.abort(); return new Promise(() => {}); } });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const pending = executeGatewayText({ ...input, transport: { ...input.transport, timeoutMs: 10 } }).catch(e => e);
    await vi.advanceTimersByTimeAsync(11); const error = await pending;
    expect(error).toMatchObject({ code: stop === 'abort' ? 'ABORTED' : 'POLICY_BLOCKED' });
    expect(readGatewayTextCostAnomaly(error, input.claim)).toMatchObject({ kind: 'free-cost-contradiction' });
    expect(input.onChunk).not.toHaveBeenCalled(); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it.each([{ choices: [{ message: { content: 'already generated' } }] }, { usage: { prompt_tokens: 10, completion_tokens: 1 } }])('does not certify rejected generation from contradictory HTTP429 body %j', async extra => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'rate_limit_exceeded' }, ...extra }, 429));
    const error = await executeGatewayText(input).catch(e => e); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it('authenticates free-cost anomalies even inside an HTTP429 error body without minting retry proof', async () => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'rate_limit_exceeded' }, usage: { cost: '0.01' } }, 429));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextCostAnomaly(error, input.claim)).toMatchObject({ kind: 'free-cost-contradiction' });
    expect(input.reportCostAnomaly).toHaveBeenCalledOnce(); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it.each([{ error: { code: 'server_error' } }, { model: 'substituted-model' }, { x_groq: { error: { code: 'server_error' } } }])('persists free-cost evidence before coexisting error markers %j', async marker => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ ...completion({ prompt_tokens: 10, completion_tokens: 1, cost: '0.01' }), ...marker }));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextCostAnomaly(error, input.claim)).toMatchObject({ kind: 'free-cost-contradiction' }); expect(input.reportCostAnomaly).toHaveBeenCalledOnce();
  });
  it.each(['3600', new Date(Date.now() + 3600000).toUTCString()])('binds a longer provider Retry-After into private rejection proof: %s', async header => {
    const input = fixture(); fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': header } }));
    const error = await executeGatewayText(input).catch(e => e); const proof = readGatewayTextRejection(error, input.claim);
    expect(proof?.cooldownUntilMs).toBeGreaterThan(Date.now() + 3500000);
  });
  it('retains an excessive valid cooldown terminally rather than shortening it into a retry', async () => {
    const input = fixture(); fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '691200' } }));
    const error = await executeGatewayText(input).catch(e => e); expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it('binds authentic HTTP429 proof to the actual error instance and dispatched claim only', async () => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'rate_limit_exceeded' } }, 429));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextRejection(error, input.claim)).toMatchObject({ kind: 'http-rejected', status: 429, generationRejected: true });
    expect(readGatewayTextRejection({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayTextRejection(error, { ...input.claim, claimId: 'other' })).toBeUndefined();
  });

});


describe('authenticated complete usage conservative liability, never invoice actual', () => {
  const complete = (extra: Record<string, unknown> = {}) => ({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
    prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, prompt_tokens_details: { cached_tokens: 80 }, ...extra });
  const reply = (usage: unknown, extra: Record<string, unknown> = {}) => ({ ...completion(usage), model: 'deepseek-flash', ...extra });
  it('releases only a separately typed uncached-input and full-output upper bound, including reasoning', async () => {
    const input = fixture('DEEPSEEK', true);
    fetchMock.mockResolvedValue(jsonResponse(reply(complete({ completion_tokens_details: { reasoning_tokens: 15 } }), {
      choices: [{ index: 0, message: { content: 'answer', reasoning_content: 'reasoning' }, finish_reason: 'stop' }],
    })));
    const result = await executeGatewayText(input); const proof = readGatewayTextConservativeUsage(result, input.claim)!;
    expect(proof).toMatchObject({ chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: maximumCostNanoUsd(100, 20,
      input.transport.rateCard!.inputNanoUsdPerMillion, input.transport.rateCard!.outputNanoUsdPerMillion), rateCardVersion: 'reviewed-rate-v1' });
    expect(proof).not.toHaveProperty('actualNanoUsd'); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
    expect(readGatewayTextConservativeUsage({ ...result }, input.claim)).toBeUndefined();
    expect(readGatewayTextConservativeUsage(result, { ...input.claim, claimId: 'other' })).toBeUndefined();
  });
  it.each(['total-missing', 'total-wrong', 'cache-disagrees', 'reasoning-over-output', 'unknown-charge', 'audio-details', 'missing-model', 'reasoning-missing', 'zero-prompt', 'zero-completion'] as const)('retains full money for %s', async flaw => {
    const input = fixture('DEEPSEEK', true); const usage: Record<string, unknown> = complete();
    if (flaw === 'zero-prompt') Object.assign(usage, { prompt_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, prompt_tokens_details: { cached_tokens: 0 }, total_tokens: 20 });
    if (flaw === 'zero-completion') Object.assign(usage, { completion_tokens: 0, total_tokens: 100 });
    if (flaw === 'total-missing') delete usage.total_tokens;
    if (flaw === 'total-wrong') usage.total_tokens = 119;
    if (flaw === 'cache-disagrees') usage.prompt_tokens_details = { cached_tokens: 79 };
    if (flaw === 'reasoning-over-output') usage.completion_tokens_details = { reasoning_tokens: 21 };
    if (flaw === 'unknown-charge') usage.tool_tokens = 4;
    if (flaw === 'audio-details') usage.completion_tokens_details = { audio_tokens: 4 };
    const value = reply(usage); if (flaw === 'missing-model') delete (value as any).model;
    if (flaw === 'reasoning-missing') value.choices[0].message = { content: 'answer', reasoning_content: 'reasoning' } as any;
    fetchMock.mockResolvedValue(jsonResponse(value)); const result = await executeGatewayText(input);
    expect(readGatewayTextConservativeUsage(result, input.claim)).toBeUndefined(); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
  });
  it.each([0.01, '0.01', 'not-a-price'])('quarantines paid reported charge outside its proven ceiling: %s', async cost => {
    const input = fixture('DEEPSEEK', true); fetchMock.mockResolvedValue(jsonResponse(reply(complete({ cost }))));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextCostAnomaly(error, input.claim)?.kind).toBe('paid-liability-contradiction');
    expect(input.reportCostAnomaly).toHaveBeenCalledOnce(); expect(input.markOutputVisible).not.toHaveBeenCalled();
    expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it('does not treat a valid above-floor reservation tariff as actual billed price', async () => {
    const original = fixture('DEEPSEEK', true); const input = bind({ ...original, transport: { ...original.transport, rateCard: {
      ...original.transport.rateCard!, inputNanoUsdPerMillion: original.transport.rateCard!.inputNanoUsdPerMillion + 100_000_000,
    } } }); fetchMock.mockResolvedValue(jsonResponse(reply(complete())));
    const result = await executeGatewayText(input); expect(readGatewayTextUsage(result, input.claim)).toBeUndefined();
    expect(readGatewayTextConservativeUsage(result, input.claim)?.conservativeCeilingNanoUsd).toBe(maximumCostNanoUsd(100, 20,
      input.transport.rateCard!.inputNanoUsdPerMillion, input.transport.rateCard!.outputNanoUsdPerMillion));
  });
  it('retains all money when a reviewed tariff expires during generation', async () => {
    vi.useFakeTimers(); const input = fixture('DEEPSEEK', true);
    fetchMock.mockImplementation(async () => { vi.setSystemTime(input.transport.rateCard!.expiresAtMs); return jsonResponse(reply(complete())); });
    // The request itself still needs a later deadline than the tariff.
    const later = bind({ ...input, request: { ...input.request, deadlineAtMs: Date.now() + 120000, attemptTimeoutMs: 120000 }, transport: { ...input.transport, timeoutMs: 120000 } });
    const result = await executeGatewayText(later); expect(readGatewayTextConservativeUsage(result, later.claim)).toBeUndefined();
  });
  it('requires final complete stream usage and keeps no partial monetary proof', async () => {
    const input = streaming(fixture('DEEPSEEK', true));
    fetchMock.mockResolvedValue(streamResponse([{ ...chunk('answer'), model: 'deepseek-flash' },
      { ...chunk('', 'stop', complete()), model: 'deepseek-flash' }]));
    const result = await executeGatewayText(input); expect(readGatewayTextConservativeUsage(result, input.claim)).toBeDefined();
    fetchMock.mockResolvedValue(streamResponse([{ ...chunk('answer', null, complete()), model: 'deepseek-flash' }], false));
    await expect(executeGatewayText(input)).rejects.toMatchObject({ code: 'NETWORK' });
  });
});


describe('direct terminal cleanup is observed but not generation', () => {
  it.each(['hang', 'reject'] as const)('completes promptly after DONE when reader cancellation %s', async mode => {
    vi.useFakeTimers(); const unhandled: unknown[] = []; const listener = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', listener);
    try {
      const cancel = vi.fn(() => mode === 'hang' ? new Promise<void>(() => {}) : Promise.reject(new Error('cleanup failed')));
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify(chunk('answer', 'stop', { prompt_tokens: 10, completion_tokens: 1 }))}\n\ndata: [DONE]\n\n`)); }, cancel });
      fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
      const task = executeGatewayText(streaming()); let settled = false; void task.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true); expect((await task).content).toBe('answer');
      expect(cancel).toHaveBeenCalledOnce(); expect(unhandled).toEqual([]); expect(vi.getTimerCount()).toBe(0);
    } finally { process.removeListener('unhandledRejection', listener); }
  });
});


describe('nested error-envelope evidence cannot certify a rejected generation', () => {
  it.each([{ choices: [{ message: { content: 'generated' } }] }, { usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } },
    { usage: { prompt_tokens: 10, completion_tokens: 2, cost: '0.01' } }])('never retries nested HTTP429 data %j', async extra => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'rate_limit_exceeded', ...extra } }, 429));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
    if (extra.usage?.cost === '0.01') {
      expect(readGatewayTextCostAnomaly(error, input.claim)?.kind).toBe('free-cost-contradiction');
      expect(input.reportCostAnomaly).toHaveBeenCalledOnce();
    }
  });
});

describe('private physical transport health observations', () => {
  it.each([[401, 'auth'], [403, 'auth'], [500, 'transient'], [503, 'transient']] as const)('authenticates physical HTTP%s without rejection or refund proof', async (status, kind) => {
    const input = fixture(); fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'unavailable' } }, status));
    const error = await executeGatewayText(input).catch(e => e);
    expect(readGatewayTextHealth(error, input.claim)).toMatchObject({ kind, binding: input.claim.binding });
    expect(readGatewayTextHealth({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayTextHealth(error, { ...input.claim, claimId: 'another-claim' })).toBeUndefined();
    expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
  it('does not certify credential auth from a forged error or denied preflight', async () => {
    const input = fixture(); expect(readGatewayTextHealth({ code: 'AUTH' }, input.claim)).toBeUndefined();
    vi.mocked(input.authorizeClaim).mockRejectedValue(new Error('offline datastore'));
    const error = await executeGatewayText(input).catch(e => e); expect(readGatewayTextHealth(error, input.claim)).toBeUndefined(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('records actual socket failure as transient but never authorizes retry', async () => {
    const input = fixture(); fetchMock.mockRejectedValue(new Error('socket closed'));
    const error = await executeGatewayText(input).catch(e => e); expect(readGatewayTextHealth(error, input.claim)?.kind).toBe('transient');
    expect(readGatewayTextRejection(error, input.claim)).toBeUndefined();
  });
});
