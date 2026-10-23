import { createGatewayFreePricingProof, isGatewayFreePricingProof } from './pricingEvidence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { DispatchBinding } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { gatewayTextCredentialBinding } from './textTransport';
import { readGatewayVisionHealth, executeGatewayVision, gatewayVisionPayloadDigest, inspectGatewayImage, readGatewayVisionUsage, readGatewayVisionConservativeUsage, readGatewayVisionRejection, readGatewayVisionCostAnomaly, visionMaximumCost, type GatewayVisionInput } from './visionTransport';
const SECRET = 'fixture-vision-credential';
const ENV = 'GATEWAY_VISION_TEST';
function png(w = 1, h = 1): string { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString('base64'); }
const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF').toString('base64');
function bind(input: GatewayVisionInput): GatewayVisionInput {
    const request = { ...input.request, payloadDigest: gatewayVisionPayloadDigest(input.payload) };
    const p = input.profile;
    const rate = input.transport.rateCard;
    const binding: DispatchBinding = { key: { logicalRequestId: request.logicalRequestId, principalId: request.principalId, tenantId: request.tenantId, payloadDigest: request.payloadDigest }, physicalAttemptId: request.nextPhysicalAttemptId, snapshotRevision: 'snapshot', requestBinding: evidenceBinding(withoutEvidence(request)), profileBinding: evidenceBinding(withoutEvidence(p)), profileId: p.id, profileVersion: p.version, providerId: p.providerId, modelId: p.modelId, modelRevision: p.modelRevision, adapterId: p.adapterId, payer: request.payer, budgetScopeId: request.budgetScopeId, quota: [{ ledgerKey: 'requests', amount: 1 }], ...(rate ? { budget: { payer: request.payer, budgetScopeId: request.budgetScopeId, periodId: 'day', amountNanoUsd: visionMaximumCost(1048576, 512, rate), rateCardVersion: rate.version }, priceBinding: 'price', budgetAuthorizationBinding: 'budget' } : {}) };
    return { ...input, request, claim: { id: 'hold', claimId: 'claim', intentBinding: evidenceBinding(binding), binding, queueWaitConsumedAtDispatchMs: 0 } };
}
function fixture(paid = false): GatewayVisionInput {
    const now = Date.now();
    const provider = paid ? 'GEMINI' : 'GLM';
    const model = paid ? 'gemini-2.5-flash' : 'glm-4.6v-flash';
    const payer = { kind: 'platform' as const, ownerId: 'platform' };
    const quality = { tier: 'standard' as const, gateId: 'gate', gateVersion: 'v1' };
    const profile: ProviderProfile = { id: 'vision', version: 'v1', providerId: provider, modelId: model, modelRevision: model, adapterId: 'gateway-vision-v1', status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: ['chat'], qualityApprovals: [quality], termsApprovals: ['terms'], capabilities: [{ kind: 'vision-pdf', maxInputTokens: 1048576, maxOutputTokens: 8192, maxContextTokens: 1056768, streaming: false, systemPrompt: true, formats: ['image/png', 'image/jpeg', 'application/pdf'], maxImages: 8, maxPdfPages: 1000 }], privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['region'] }, credentialOwner: payer, quotaDimensions: [{ scope: { providerId: provider, kind: 'account', id: 'account' }, meter: 'requests/day' }], charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: 'profile' };
    const request: RoutingRequest = { logicalRequestId: 'request', nextPhysicalAttemptId: 'attempt', payloadDigest: '', policyRevision: 'policy', termsPolicyId: 'terms', budgetScopeId: 'platform-free-fallback', principalId: 'user', tenantId: 'tenant', surface: 'chat', quality, capability: { kind: 'vision-pdf', inputTokens: paid ? 1048576 : 130560, outputTokens: 512, streaming: false, systemPrompt: false, formats: paid ? ['application/pdf'] : ['image/png'], imageCount: paid ? 0 : 1, pdfPages: paid ? 1000 : 0 }, privacy: { dataClass: 'public', policyId: 'privacy', allowedProcessingRegions: ['region'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false }, payer, mode: paid ? 'free-first-authorized-paid' : 'strict-free', createdAtMs: now, deadlineAtMs: now + 60000, maxQueueWaitMs: 1000, queueWaitConsumedMs: 0, queueEnteredAtMs: now, firstOutputTimeoutMs: 6000, attemptTimeoutMs: 60000, cancellation: { id: 'cancel', cancelled: false }, outputVisible: false, maxPhysicalAttempts: 1, attempts: [], evidenceRef: 'request' };
    return bind({ profile, request, claim: {} as GatewayVisionInput['claim'], transport: { kind: 'vision-pdf', provider, model, credentialEnv: ENV, credentialBinding: gatewayTextCredentialBinding(SECRET), timeoutMs: 60000, maxOutputTokens: 512, maxImages: 8, maxImageBytes: 5000000, maxTotalBytes: 20000000, maxDimension: 6000, maxPixels: 36000000, ...(paid ? { rateCard: { version: 'rate', inputNanoUsdPerMillion: 300000000, outputNanoUsdPerMillion: 2500000000, verifiedAtMs: now - 1, expiresAtMs: now + 60000 } } : {}) }, payload: { kind: 'vision-pdf', prompt: 'Describe this', attachments: [paid ? { mimeType: 'application/pdf', data: pdf } : { mimeType: 'image/png', data: png() }], streaming: false }, signal: new AbortController().signal, authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(), markOutputVisible: vi.fn(async () => { }), reportCostAnomaly: vi.fn(async () => { }) });
}
const glm = () => ({ model: 'glm-4.6v-flash', choices: [{ message: { content: 'An image' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
const gemini = () => ({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'A document' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 115 } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.stubEnv(ENV, SECRET); fetcher = vi.fn(async () => response(glm())); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('bounded claimed vision transport', () => {
    it('sends one exact GLM image call and authenticates final zero usage', async () => { const input = fixture(); const result = await executeGatewayVision(input); expect(result.content).toBe('An image'); expect(fetcher).toHaveBeenCalledOnce(); expect(input.authorizeClaim).toHaveBeenCalledOnce(); expect(readGatewayVisionUsage(result, input.claim)).toMatchObject({ actualNanoUsd: 0, inputTokens: 100, outputTokens: 10 }); expect(readGatewayVisionUsage({ ...result }, input.claim)).toBeUndefined(); expect(readGatewayVisionUsage(result, { ...input.claim, claimId: 'other' })).toBeUndefined(); const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body).toMatchObject({ model: 'glm-4.6v-flash', stream: false, max_tokens: 512, tools: [], thinking: { type: 'disabled' } }); expect(body.messages[0].content[1].image_url.url).toContain('data:image/png;base64,'); });
    it('mints only authentic final GLM zero-price reporting evidence', async () => {
        const input = fixture(); fetcher.mockResolvedValue(response(glm()));
        const result = await executeGatewayVision(input);
        const proof = createGatewayFreePricingProof(result, input.claim);
        const expected = { provider: result.provider, model: result.model, usage: result.usage, logicalRequestId: input.request.logicalRequestId };
        expect(isGatewayFreePricingProof(proof, expected)).toBe(true);
        expect(isGatewayFreePricingProof({ ...proof }, expected)).toBe(false);
        expect(createGatewayFreePricingProof({ ...result }, input.claim)).toBeUndefined();
        expect(isGatewayFreePricingProof(proof, { ...expected, model: 'other' })).toBe(false);
    });
    it.each(['credential', 'claim', 'deadline', 'surface', 'payload', 'model', 'paid', 'stream'])('blocks %s mismatch before fetch', async (kind) => { const input = fixture(); if (kind === 'credential')
        vi.stubEnv(ENV, 'other'); if (kind === 'claim')
        (input.claim as any).claimId = ''; if (kind === 'deadline')
        (input.request as any).deadlineAtMs = 0; if (kind === 'surface')
        (input.request as any).surface = 'doctor'; if (kind === 'payload')
        (input.payload as any).prompt = 'changed'; if (kind === 'model')
        (input.transport as any).model = 'glm-4.6v-flashX'; if (kind === 'paid')
        (input.profile as any).charging = 'metered'; if (kind === 'stream')
        (input.payload as any).streaming = true; await expect(executeGatewayVision(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
    it('rechecks key rotation and revocation after final asynchronous authorization', async () => { const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { vi.stubEnv(ENV, 'rotated'); return true; }); await expect(executeGatewayVision(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
    it('does not dispatch when durable hold authority is rejected', async () => { const input = fixture(); vi.mocked(input.authorizeClaim).mockResolvedValue(false); await expect(executeGatewayVision(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
    it.each([{ usage: { cost: '0.1' } }, { error: { usage: { cost: null } } }])('quarantines contradictory charged envelope %j', async (body) => { const input = fixture(); fetcher.mockResolvedValue(response(body, 429)); const error = await executeGatewayVision(input).catch(e => e); expect(readGatewayVisionCostAnomaly(error, input.claim)).toBeDefined(); expect(input.reportCostAnomaly).toHaveBeenCalledOnce(); expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined(); });
    it.each([{ choices: [{ message: { refusal: 'no' } }] }, { error: { code: '1301' } }])('never retries a safety outcome %j', async (body) => { const input = fixture(); fetcher.mockResolvedValue(response(body, 429)); const error = await executeGatewayVision(input).catch(e => e); expect(error.code).toBe('SAFETY_REFUSAL'); expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined(); });
    it.each([{ choices: [] }, { usage: { cost: 0 } }, { error: { usage: { cost: 0 } } }])('retains ambiguous 429 hold %j', async (body) => { const input = fixture(); fetcher.mockResolvedValue(response(body, 429)); const error = await executeGatewayVision(input).catch(e => e); expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined(); });
    it('certifies only an explicit generation rejection', async () => { const input = fixture(); fetcher.mockResolvedValue(response({ error: { code: '1302' } }, 429)); const error = await executeGatewayVision(input).catch(e => e); expect(readGatewayVisionRejection(error, input.claim)).toMatchObject({ generationRejected: true, status: 429 }); });
    it.each([undefined, { prompt_tokens: 0, completion_tokens: 10, total_tokens: 10 }, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 50 }])('retains unproved usage %j', async (usage) => { const input = fixture(); fetcher.mockResolvedValue(response({ ...glm(), usage })); const result = await executeGatewayVision(input); expect(result.completeUsage).toBe(false); expect(readGatewayVisionUsage(result, input.claim)).toBeUndefined(); });
    it('aborts before dispatch', async () => { const controller = new AbortController(); controller.abort(); await expect(executeGatewayVision({ ...fixture(), signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' }); expect(fetcher).not.toHaveBeenCalled(); });
});
describe('decoded media admission, never remote fetching', () => {
    it('reads actual PNG dimensions', () => { expect(inspectGatewayImage({ mimeType: 'image/png', data: png(640, 480) })).toEqual({ bytes: 33, width: 640, height: 480 }); });
    it.each(['https://example.com/image', 'data:image/png;base64,AAAA', 'AAAA', '@@@@', 'a==='])('rejects URL or malformed encoded image %s', data => { expect(() => inspectGatewayImage({ mimeType: 'image/png', data })).toThrow(); });
    it('rejects declared MIME mismatch', () => { expect(() => inspectGatewayImage({ mimeType: 'image/jpeg', data: png() })).toThrow(); });
    it('blocks huge decoded dimensions before fetch', async () => { const input = fixture(); const changed = bind({ ...input, payload: { ...input.payload, attachments: [{ mimeType: 'image/png', data: png(6001, 1) }] } }); await expect(executeGatewayVision(changed)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
    it('cannot send PDF to image-only GLM', async () => { const input = fixture(); const changed = bind({ ...input, payload: { ...input.payload, attachments: [{ mimeType: 'application/pdf', data: pdf }] } }); await expect(executeGatewayVision(changed)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
});
describe('reviewed metered Gemini PDF door', () => {
    it('uses full-context hold and distinct maximum-tariff proof, including reasoning', async () => { const input = fixture(true); fetcher.mockResolvedValue(response(gemini())); const result = await executeGatewayVision(input); expect(result.content).toBe('A document'); expect(readGatewayVisionUsage(result, input.claim)).toBeUndefined(); expect(readGatewayVisionConservativeUsage(result, input.claim)).toMatchObject({ chargeBasis: 'conservative-ceiling', inputTokens: 100, outputTokens: 15, conservativeCeilingNanoUsd: 67500 }); const [url, init] = fetcher.mock.calls[0]; expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'); expect(JSON.parse(init.body).generationConfig).toEqual({ maxOutputTokens: 384, thinkingConfig: { thinkingBudget: 0 } }); expect(input.claim.binding.budget!.amountNanoUsd).toBe(315852800); });
    it.each(['underfunded', 'strict-free', 'bad-pdf', 'expired-rate', 'wrong-model'])('blocks %s PDF dispatch', async (kind) => { let input = fixture(true); if (kind === 'underfunded')
        (input.claim.binding.budget as any).amountNanoUsd = 1; if (kind === 'strict-free')
        input = bind({ ...input, request: { ...input.request, mode: 'strict-free' } }); if (kind === 'bad-pdf')
        input = bind({ ...input, payload: { ...input.payload, attachments: [{ mimeType: 'application/pdf', data: Buffer.from('not pdf').toString('base64') }] } }); if (kind === 'expired-rate')
        (input.transport.rateCard as any).expiresAtMs = 0; if (kind === 'wrong-model')
        (input.transport as any).model = 'gemini-new'; await expect(executeGatewayVision(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
    it('keeps full hold when final reasoning accounting is inconsistent', async () => { const input = fixture(true); const data = gemini(); data.usageMetadata.totalTokenCount = 110; fetcher.mockResolvedValue(response(data)); const result = await executeGatewayVision(input); expect(readGatewayVisionConservativeUsage(result, input.claim)).toBeUndefined(); });
    it.each([{ promptTokenCount: 1048577 }, { candidatesTokenCount: 513 }, { thoughtsTokenCount: 513 }, { candidatesTokenCount: 500, thoughtsTokenCount: 20 }])('quarantines paid usage beyond the reserved ceiling %j', async counters => {
        const input = fixture(true); const data = gemini(); Object.assign(data.usageMetadata, counters);
        fetcher.mockResolvedValue(response(data)); const error = await executeGatewayVision(input).catch(e => e);
        expect(readGatewayVisionCostAnomaly(error, input.claim)).toMatchObject({ kind: 'paid-liability-contradiction' });
        expect(input.reportCostAnomaly).toHaveBeenCalledOnce(); expect(input.markOutputVisible).not.toHaveBeenCalled();
    });
    it('keeps the full hold when a thought part has no thought count', async () => {
        const input = fixture(true); const data: any = gemini(); data.candidates[0].content.parts.push({ text: 'private reasoning', thought: true });
        delete data.usageMetadata.thoughtsTokenCount; data.usageMetadata.totalTokenCount = 110;
        fetcher.mockResolvedValue(response(data)); const result = await executeGatewayVision(input);
        expect(result.content).toBe('A document'); expect(readGatewayVisionConservativeUsage(result, input.claim)).toBeUndefined();
    });
    it.each([{ candidates: [{ content: { parts: [{ text: 'generated' }] } }] }, { usageMetadata: { promptTokenCount: 10 } }, { error: { usageMetadata: { promptTokenCount: 10 } } }])('never certifies generated Gemini HTTP429 envelopes %j', async body => {
        const input = fixture(true); fetcher.mockResolvedValue(response(body, 429)); const error = await executeGatewayVision(input).catch(e => e);
        expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined();
    });
    it.each([{ promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'SAFETY' }] }, { error: { promptFeedback: { blockReason: 'SAFETY' } } }])('keeps native Gemini refusal terminal on HTTP429 %j', async body => {
        const input = fixture(true); fetcher.mockResolvedValue(response(body, 429)); const error = await executeGatewayVision(input).catch(e => e);
        expect(error.code).toBe('SAFETY_REFUSAL'); expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined();
    });
    it('does not claim local PDF page count inspection', () => { const input = fixture(true); expect(input.request.capability).toMatchObject({ pdfPages: 1000 }); expect(input.payload.attachments[0].data).toBe(pdf); });
});
it.each(['pending', 'rejecting'] as const)('does not await %s response cleanup', async (mode) => {
    const input = fixture();
    const cancel = vi.fn(() => mode === 'pending' ? new Promise<void>(() => { }) : Promise.reject(Error('cleanup')));
    const read = vi.fn().mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify(glm())) }).mockResolvedValue({ done: true });
    fetcher.mockResolvedValue({ ok: true, status: 200, body: { getReader: () => ({ read, cancel }) } });
    const result = await executeGatewayVision(input);
    expect(result.content).toBe('An image');
    expect(cancel).toHaveBeenCalledOnce();
    await Promise.resolve();
});
it('does not dispatch if durable authorization crosses deadline', async () => {
    vi.useFakeTimers();
    const input = fixture();
    vi.mocked(input.authorizeClaim).mockImplementation(async () => { vi.setSystemTime(input.request.deadlineAtMs + 1); return true; });
    await expect(executeGatewayVision(input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
});
it('aborts an in-flight body read and retains unmeasured cost', async () => {
    const controller = new AbortController();
    const input = { ...fixture(), signal: controller.signal };
    const cancel = vi.fn(async () => { });
    fetcher.mockResolvedValue({ ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise(() => { }), cancel }) } });
    const result = executeGatewayVision(input);
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    const error = await result.catch(e => e);
    expect(error.code).toBe('ABORTED');
    expect(readGatewayVisionUsage(error, input.claim)).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
});
it.each([{ cachedContentTokenCount: -1 }, { cachedContentTokenCount: 101 }, { toolUsePromptTokenCount: -1 }, { thoughtsTokenCount: -1 }, { candidatesTokenCount: 0 }])('retains full paid hold for contradictory metadata %j', async (extra) => {
    const input = fixture(true);
    const data = gemini();
    Object.assign(data.usageMetadata, extra);
    fetcher.mockResolvedValue(response(data));
    const result = await executeGatewayVision(input);
    expect(readGatewayVisionConservativeUsage(result, input.claim)).toBeUndefined();
});
it('does not accept a Gemini redirected model version', async () => {
    const input = fixture(true);
    fetcher.mockResolvedValue(response({ ...gemini(), modelVersion: 'unreviewed-successor' }));
    await expect(executeGatewayVision(input)).rejects.toThrow();
    expect(input.markOutputVisible).not.toHaveBeenCalled();
});
it('separates GLM balance exhaustion from per-minute throttling', async () => {
    const input = fixture();
    fetcher.mockResolvedValue(response({ error: { code: '1113' } }, 429));
    await expect(executeGatewayVision(input)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
});

it.each(['60', '900000'])('respects provider Retry-After %s without shortening it', async delay => {
    const input = fixture(); const res = response({ error: { code: '1302' } }, 429); res.headers.set('retry-after', delay);
    fetcher.mockResolvedValue(res); const error = await executeGatewayVision(input).catch(e => e);
    const proof = readGatewayVisionRejection(error, input.claim);
    if (delay === '60') expect(proof?.cooldownUntilMs).toBeGreaterThanOrEqual(proof!.receivedAtMs + 60000);
    else { expect(proof).toBeUndefined(); expect(readGatewayVisionHealth(error, input.claim)?.kind).toBe('cooldown-unavailable'); }
});

it.each(['1113', '1308', '1310', '1313'])('does not certify account exhaustion %s as retryable rate limit', async code => {
    const input = fixture(); fetcher.mockResolvedValue(response({ error: { code } }, 429));
    const error = await executeGatewayVision(input).catch(e => e);
    expect(error.code).toBe('QUOTA_EXHAUSTED'); expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined();
});

it.each([401, 403, 500, 503])('authenticates dispatched provider health %s without retry or cost release', async status => {
    const input = fixture(); fetcher.mockResolvedValue(response({ error: { code: 'failure' } }, status));
    const error = await executeGatewayVision(input).catch(e => e);
    expect(readGatewayVisionHealth(error, input.claim)).toMatchObject({ kind: status < 500 ? 'auth' : 'transient', binding: input.claim.binding });
    expect(readGatewayVisionHealth({ ...error }, input.claim)).toBeUndefined();
    expect(readGatewayVisionHealth(error, { ...input.claim, claimId: 'other' })).toBeUndefined();
    expect(readGatewayVisionRejection(error, input.claim)).toBeUndefined();
});
it('does not mint health evidence before actual dispatch or after user abort', async () => {
    const input = fixture(); const controller = new AbortController(); controller.abort();
    const error = await executeGatewayVision({ ...input, signal: controller.signal }).catch(e => e);
    expect(readGatewayVisionHealth(error, input.claim)).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
});
it('binds dispatched health to the immutable claim despite caller mutation', async () => {
    const input = fixture(); const originalClaim = structuredClone(input.claim);
    fetcher.mockImplementation(async () => { (input.claim as any).claimId = 'mutated'; throw Error('network'); });
    const error = await executeGatewayVision(input).catch(e => e);
    expect(readGatewayVisionHealth(error, originalClaim)?.kind).toBe('transient');
    expect(readGatewayVisionHealth(error, input.claim)).toBeUndefined();
});
it.each([400, 429])('does not mark non-health response %s as provider failure', async status => {
    const input = fixture(); fetcher.mockResolvedValue(response({ error: { code: '1302' } }, status));
    const error = await executeGatewayVision(input).catch(e => e);
    expect(readGatewayVisionHealth(error, input.claim)).toBeUndefined();
});

it('does not accept a forged executor timeout as provider health', async () => {
    const input = fixture(); const controller = new AbortController();
    fetcher.mockImplementation(async () => { controller.abort({ kind: 'executor-timeout' }); throw Error('aborted'); });
    const error = await executeGatewayVision({ ...input, signal: controller.signal }).catch(e => e);
    expect(error.code).toBe('ABORTED'); expect(readGatewayVisionHealth(error, input.claim)).toBeUndefined();
});

describe('reviewed paid image fallback under common image compatibility policy', () => {
    function imageFallback() {
        const input = fixture(true);
        if (input.request.capability.kind !== 'vision-pdf') throw Error('fixture');
        return bind({ ...input, payload: { ...input.payload, attachments: [{ mimeType: 'image/png', data: png() }] },
            request: { ...input.request, capability: { ...input.request.capability, inputTokens: 130560, formats: ['image/png'], imageCount: 1, pdfPages: 0 } } });
    }
    it('reserves full Gemini context even though the shared image policy remains GLM-compatible', async () => {
        const input = imageFallback(); const data = gemini();
        data.usageMetadata.promptTokenCount = 200000; data.usageMetadata.totalTokenCount = 200015;
        fetcher.mockResolvedValue(response(data)); const result = await executeGatewayVision(input);
        expect(input.request.capability).toMatchObject({ inputTokens: 130560, pdfPages: 0 });
        expect(input.claim.binding.budget?.amountNanoUsd).toBe(315852800);
        expect(readGatewayVisionConservativeUsage(result, input.claim)).toMatchObject({ inputTokens: 200000, outputTokens: 15, conservativeCeilingNanoUsd: 60037500 });
        expect(JSON.parse(fetcher.mock.calls[0][1].body).contents[0].parts[1].inlineData.mimeType).toBe('image/png');
    });
    it('rejects a paid image hold based only on the smaller common image input bound', async () => {
        const input = imageFallback();
        (input.claim.binding.budget as any).amountNanoUsd = visionMaximumCost(130560, 512, input.transport.rateCard!);
        await expect(executeGatewayVision(input)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetcher).not.toHaveBeenCalled();
    });
    it('still forbids paid image fallback under strict-free policy', async () => {
        const input = imageFallback(); const strict = bind({ ...input, request: { ...input.request, mode: 'strict-free' } });
        await expect(executeGatewayVision(strict)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(fetcher).not.toHaveBeenCalled();
    });
});
