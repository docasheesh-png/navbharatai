import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeGatewayGrounding, gatewayGroundingPayloadDigest, readGatewayGroundingUsage, readGatewayGroundingHealth, type GatewayGroundingInput } from './groundingTransport';
import { evidenceBinding, withoutEvidence } from './profiles';
import { gatewayTextCredentialBinding } from './textTransport';
import type { ProviderProfile, RoutingRequest } from './types';
import type { DispatchBinding } from './executor';
const ENV = 'INFERENCE_GATEWAY_BRAVE_TEST_KEY'; const KEY = 'synthetic-search-credential';
function fixture(): GatewayGroundingInput {
 const now = Date.now(); const payer = { kind: 'platform' as const, ownerId: 'platform' };
 const quality = { tier: 'standard' as const, gateId: 'search-quality', gateVersion: '1' };
 const profile: ProviderProfile = { id: 'brave', version: '1', providerId: 'BRAVE', modelId: 'brave-search-v1', modelRevision: 'reviewed-search-v1', adapterId: 'gateway-brave-search-v1',
 status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: ['chat'], qualityApprovals: [quality], termsApprovals: ['terms'],
 capabilities: [{ kind: 'grounding-search', maxQueries: 1, maxResults: 20, citations: true, domainFiltering: false }],
 privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['reviewed-region'] }, credentialOwner: payer,
 quotaDimensions: [{ scope: { providerId: 'BRAVE', kind: 'account', id: 'canonical-account' }, meter: 'requests/day' }], charging: 'metered', evidenceRef: 'profile' };
 const payload = { kind: 'grounding-search' as const, query: 'current public weather', maxResults: 5 };
 const request: RoutingRequest = { logicalRequestId: 'logical', nextPhysicalAttemptId: 'physical', payloadDigest: gatewayGroundingPayloadDigest(payload), policyRevision: '1', termsPolicyId: 'terms', budgetScopeId: 'platform-free-fallback', principalId: 'user', tenantId: 'platform', surface: 'chat', quality,
 capability: { kind: 'grounding-search', queries: 1, maxResults: 5, citations: true, domainFiltering: false }, privacy: { dataClass: 'public', policyId: 'privacy', allowedProcessingRegions: ['reviewed-region'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false }, payer, mode: 'free-first-authorized-paid',
 createdAtMs: now, deadlineAtMs: now + 60000, maxQueueWaitMs: 5000, queueWaitConsumedMs: 0, queueEnteredAtMs: now, firstOutputTimeoutMs: 6000, attemptTimeoutMs: 6000, cancellation: { id: 'cancel', cancelled: false }, outputVisible: false, maxPhysicalAttempts: 1, attempts: [], evidenceRef: 'request' };
 const binding: DispatchBinding = { key: { logicalRequestId: request.logicalRequestId, principalId: request.principalId, tenantId: request.tenantId, payloadDigest: request.payloadDigest }, physicalAttemptId: request.nextPhysicalAttemptId, snapshotRevision: 'snapshot', requestBinding: evidenceBinding(withoutEvidence(request)), profileBinding: evidenceBinding(withoutEvidence(profile)), profileId: profile.id, profileVersion: profile.version, providerId: profile.providerId, modelId: profile.modelId, modelRevision: profile.modelRevision, adapterId: profile.adapterId, payer, budgetScopeId: request.budgetScopeId, quota: [{ ledgerKey: 'requests', amount: 1 }], budget: { authorizationId: 'authorization', budgetScopeId: request.budgetScopeId, periodId: 'day', payer, amountNanoUsd: 5000000, rateCardVersion: 'rate-v1' } };
 return { ...payload, profile, request, claim: { id: 'hold', claimId: 'claim', binding, intentBinding: evidenceBinding(binding), queueWaitConsumedAtDispatchMs: 0 },
 transport: { kind: 'grounding-search', provider: 'BRAVE', model: 'brave-search-v1', baseURL: 'https://api.search.brave.com/res/v1/web/search', credentialEnv: ENV, credentialBinding: gatewayTextCredentialBinding(KEY), timeoutMs: 6000, maxQueryBytes: 4000, maxResults: 20, rateCard: { version: 'rate-v1', requestNanoUsd: 5000000, verifiedAtMs: now - 1000, expiresAtMs: now + 60000 } }, signal: new AbortController().signal,
 authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(() => {}) };
}
const response = () => new Response(JSON.stringify({ web: { results: [{ title: 'Public result', url: 'https://example.com/source', description: 'Source excerpt' }] } }));
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { process.env[ENV] = KEY; fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { delete process.env[ENV]; vi.unstubAllGlobals(); vi.useRealTimers(); });
it('requires one exact paid hold and produces private conservative request usage, not invoice cost', async () => {
 const input = fixture(); const result = await executeGatewayGrounding(input);
 expect(fetcher).toHaveBeenCalledOnce(); expect(result.results).toHaveLength(1);
 const proof = readGatewayGroundingUsage(result, input.claim);
 expect(proof).toMatchObject({ requests: 1, chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: 5000000 });
 expect(proof).not.toHaveProperty('actualNanoUsd'); expect(readGatewayGroundingUsage({ ...result }, input.claim)).toBeUndefined();
 expect(readGatewayGroundingUsage(result, { ...input.claim, claimId: 'other' })).toBeUndefined();
});
it.each(['strict', 'payload', 'underhold', 'rate', 'expiry', 'provider', 'domains', 'oversize', 'identity', 'capability', 'rate-version'])('rejects %s before physical dispatch', async kind => {
 const input = fixture();
 if (kind === 'strict') (input.request as any).mode = 'strict-free';
 if (kind === 'payload') (input as any).query += ' changed';
 if (kind === 'underhold') (input.claim.binding.budget as any).amountNanoUsd = 1;
 if (kind === 'rate') (input.transport.rateCard as any).requestNanoUsd = 1;
 if (kind === 'expiry') (input.transport.rateCard as any).expiresAtMs = Date.now();
 if (kind === 'provider') (input.transport as any).baseURL = 'https://evil.example';
 if (kind === 'domains') (input as any).domains = ['example.com'];
 if (kind === 'oversize') (input as any).query = 'a'.repeat(4001);
 if (kind === 'capability') (input.profile as any).capabilities = [];
 if (kind === 'rate-version') (input.transport.rateCard as any).version = 'new';
 if (kind === 'identity') (input.request as any).principalId = 'other';
 await expect(executeGatewayGrounding(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('rechecks credential generation after async claim and never multiplies quota through keys', async () => {
 const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { process.env[ENV] = 'rotated-key'; return true; });
 await expect(executeGatewayGrounding(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('does not allow an async control revocation to dispatch', async () => {
 const input = fixture(); vi.mocked(input.assertDispatchPolicy).mockImplementation(() => { throw Error('revoked'); });
 await expect(executeGatewayGrounding(input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([401,403,429,500])('retains the full hold with no fabricated no-charge proof on HTTP%s', async status => {
 const input = fixture(); fetcher.mockResolvedValue(new Response('{}', { status }));
 const error = await executeGatewayGrounding(input).catch(e => e);
 expect(readGatewayGroundingUsage(error, input.claim)).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds a transport that ignores cancellation without retrying', async () => {
 vi.useFakeTimers(); const input = fixture(); fetcher.mockImplementation(() => new Promise(() => {}));
 const pending = executeGatewayGrounding(input); const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
 await vi.advanceTimersByTimeAsync(6001); await rejected; expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps reviewed immutable inputs when caller mutates during claim', async () => {
 const input = fixture(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { (input as any).query = 'different'; return true; });
 await executeGatewayGrounding(input); expect(String(fetcher.mock.calls[0][0])).toContain('current+public+weather');
});
it.each(['javascript:alert(1)', 'https://name:password@example.com/'])('rejects unsafe result URL %s', async url => {
 fetcher.mockResolvedValue(new Response(JSON.stringify({ web: { results: [{ title: 't', description: 'd', url }] } })));
 await expect(executeGatewayGrounding(fixture())).rejects.toThrow();
});
it('does not release a hold using an expired tariff after receiving results', async () => {
 vi.useFakeTimers(); const input = fixture(); (input.transport.rateCard as any).expiresAtMs = Date.now() + 100;
 fetcher.mockImplementation(async () => { vi.setSystemTime(Date.now() + 200); return response(); });
 const result = await executeGatewayGrounding(input); expect(readGatewayGroundingUsage(result, input.claim)).toBeUndefined();
});

it('clips the network timer to the logical attempt timeout', async () => {
 vi.useFakeTimers(); const input = fixture(); (input.request as any).attemptTimeoutMs = 15;
 (input.claim.binding as any).requestBinding = evidenceBinding(withoutEvidence(input.request));
 (input.claim as any).intentBinding = evidenceBinding(input.claim.binding);
 fetcher.mockImplementation(() => new Promise(() => {}));
 const pending = executeGatewayGrounding(input).catch(e => e);
 await vi.advanceTimersByTimeAsync(16); expect(await pending).toMatchObject({ code: 'ABORTED' }); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([401,403,500])('records physical HTTP%s health without refund evidence', async status => {
 const input = fixture(); fetcher.mockResolvedValue(new Response('{}', { status }));
 const error = await executeGatewayGrounding(input).catch(e => e);
 expect(readGatewayGroundingHealth(error, input.claim)).toMatchObject({ kind: status < 500 ? 'auth' : 'transient' });
 expect(readGatewayGroundingUsage(error, input.claim)).toBeUndefined();
 expect(readGatewayGroundingHealth({ ...error }, input.claim)).toBeUndefined();
});

it.each(['pending','rejecting'])('cleans up an HTTP error body without waiting for %s cancellation', async mode => {
 const input = fixture(); const cancel = vi.fn(() => mode === 'pending' ? new Promise(() => {}) : Promise.reject(Error('closed')));
 fetcher.mockResolvedValue({ ok: false, status: 503, headers: new Headers(), body: { cancel } });
 await expect(executeGatewayGrounding(input)).rejects.toMatchObject({ code: 'SERVER' });
 expect(cancel).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each(['3600','999999999'])('honors paid-search429 Retry-After %s without refunding its request', async value => {
 const input = fixture(); fetcher.mockResolvedValue(new Response('{}',{ status: 429, headers: { 'retry-after': value } }));
 const error = await executeGatewayGrounding(input).catch(e => e); const proof = readGatewayGroundingHealth(error, input.claim);
 expect(proof?.kind).toBe(value === '3600' ? 'transient' : 'cooldown-unavailable');
 if (value === '3600') expect(proof?.cooldownUntilMs).toBeGreaterThanOrEqual(Date.now() + 3599000);
 expect(readGatewayGroundingUsage(error, input.claim)).toBeUndefined();
});
