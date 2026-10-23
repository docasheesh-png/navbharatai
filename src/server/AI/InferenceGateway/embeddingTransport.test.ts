import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { DispatchBinding } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { executeGatewayEmbedding, gatewayEmbeddingPayloadDigest, gatewayEmbeddingMaximumNanoUsd,
  readGatewayEmbeddingUsage, readGatewayEmbeddingHealth, gatewayEmbeddingCredentialBinding, readGatewayEmbeddingCostAnomaly, VERTEX_EMBEDDING_VECTOR_SPACE, type GatewayEmbeddingInput } from './embeddingTransport';
function fixture(): GatewayEmbeddingInput {
  const now = Date.now(); const payer = { kind: 'platform' as const, ownerId: 'platform' };
  const quality = { tier: 'professional' as const, gateId: 'quality', gateVersion: '1' };
  const profile: ProviderProfile = { id: 'embed', version: '1', providerId: 'VERTEX', modelId: 'text-embedding-004',
    modelRevision: '004', adapterId: 'gateway-vertex-embedding-v1', status: 'approved', serviceClass: 'production', product: 'inference-api',
    surfaces: ['professional'], qualityApprovals: [quality], termsApprovals: ['terms'],
    capabilities: [{ kind: 'embedding', maxInputTokens: 2048, dimensions: 768, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE }],
    privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['us-central1'] },
    credentialOwner: payer, quotaDimensions: [{ scope: { providerId: 'VERTEX', kind: 'project', id: 'my-project' }, meter: 'requests/day' }],
    charging: 'metered', evidenceRef: 'profile-proof' };
  const text = 'नमस्ते world';
  const request: RoutingRequest = { logicalRequestId: 'logical', nextPhysicalAttemptId: 'attempt', payloadDigest: gatewayEmbeddingPayloadDigest(text),
    policyRevision: 'policy', termsPolicyId: 'terms', budgetScopeId: 'platform-free-fallback', principalId: 'uid', tenantId: 'tenant',
    surface: 'professional', quality, capability: { kind: 'embedding', inputTokens: 2048, dimensions: 768, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE },
    privacy: { dataClass: 'public', policyId: 'privacy', allowedProcessingRegions: ['us-central1'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false },
    payer, mode: 'free-first-authorized-paid', createdAtMs: now, deadlineAtMs: now + 10000, maxQueueWaitMs: 1000, queueWaitConsumedMs: 0,
    queueEnteredAtMs: now, firstOutputTimeoutMs: 6000, attemptTimeoutMs: 6000, cancellation: { id: 'cancel', cancelled: false },
    outputVisible: false, maxPhysicalAttempts: 1, attempts: [], evidenceRef: 'request-proof' };
  const binding: DispatchBinding = { key: { logicalRequestId: 'logical', principalId: 'uid', tenantId: 'tenant', payloadDigest: request.payloadDigest },
    physicalAttemptId: 'attempt', snapshotRevision: 'snapshot', requestBinding: evidenceBinding(withoutEvidence(request)),
    profileBinding: evidenceBinding(withoutEvidence(profile)), profileId: profile.id, profileVersion: profile.version, providerId: profile.providerId,
    modelId: profile.modelId, modelRevision: profile.modelRevision, adapterId: profile.adapterId, payer, budgetScopeId: request.budgetScopeId, quota: [],
    budget: { authorizationId: 'budget-auth', payer, budgetScopeId: request.budgetScopeId, periodId: 'day', amountNanoUsd: 100000, rateCardVersion: 'rate-v1' } };
  return { text, profile, request, claim: { id: 'hold', claimId: 'claim', binding, intentBinding: evidenceBinding(binding), queueWaitConsumedAtDispatchMs: 0 },
    transport: { kind: 'embedding', provider: 'VERTEX', model: 'text-embedding-004', project: 'my-project', location: 'us-central1', credentialPrincipal: 'runtime@my-project.iam.gserviceaccount.com',
      vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE, maxInputBytes: 8192, timeoutMs: 6000,
      rateCard: { version: 'rate-v1', maxNanoUsdPerCharacter: 25, verifiedAtMs: now - 1, expiresAtMs: now + 10000 } },
    signal: new AbortController().signal, authorizeClaim: vi.fn(async () => true), assertDispatchPolicy: vi.fn(), reportCostAnomaly: vi.fn(async () => {}) };
}
const response = (statistics: unknown = { token_count: 4, truncated: false }, values: unknown = Array(768).fill(0.1)) => new Response(JSON.stringify({ predictions: [{ embeddings: { values, statistics } }] }));
const ports = () => ({ accessToken: vi.fn(async () => ({ token: 'fake-access-value', project: 'my-project', principal: 'runtime@my-project.iam.gserviceaccount.com' })), fetch: vi.fn<typeof fetch>(async () => response()) });
afterEach(() => vi.useRealTimers());
describe('bounded Vertex embeddings', () => {
  it('dispatches exactly one reviewed REST request and produces only conservative character liability', async () => {
    const input = fixture(); const p = ports(); const result = await executeGatewayEmbedding(input, p);
    expect(p.fetch).toHaveBeenCalledOnce(); const [url, init] = p.fetch.mock.calls[0];
    expect(url).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/text-embedding-004:predict');
    expect(JSON.parse(init!.body as string)).toEqual({ instances: [{ content: input.text }], parameters: { autoTruncate: false, outputDimensionality: 768 } });
    const proof = readGatewayEmbeddingUsage(result, input.claim)!;
    expect(proof.chargeBasis).toBe('conservative-ceiling'); expect(proof.conservativeCeilingNanoUsd).toBe(Buffer.byteLength(input.text) * 25);
    expect(proof).not.toHaveProperty('actualNanoUsd'); expect(result.values).toHaveLength(768);
    expect(readGatewayEmbeddingUsage({ ...result }, input.claim)).toBeUndefined();
    expect(readGatewayEmbeddingUsage(result, { ...input.claim, claimId: 'other' })).toBeUndefined();
  });
  it.each(['strict', 'digest', 'project', 'dimensions', 'underhold', 'rate', 'expired', 'capability', 'region'])('blocks %s before auth/network', async variant => {
    const input = fixture();
    if (variant === 'capability') (input.profile as any).capabilities = [];
    if (variant === 'region') (input.transport as any).location = 'europe-west1';
    if (variant === 'strict') (input.request as any).mode = 'strict-free';
    if (variant === 'digest') (input as any).text += ' extra';
    if (variant === 'project') (input.transport as any).project = '../evil';
    if (variant === 'dimensions') (input.request.capability as any).dimensions = 100;
    if (variant === 'underhold') (input.claim.binding.budget as any).amountNanoUsd = 0;
    if (variant === 'rate') (input.transport.rateCard as any).maxNanoUsdPerCharacter = 1;
    if (variant === 'expired') (input.transport.rateCard as any).expiresAtMs = Date.now();
    const p = ports(); await expect(executeGatewayEmbedding(input, p)).rejects.toThrow(); expect(p.accessToken).not.toHaveBeenCalled(); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('rejects a different ADC principal before claim and fetch', async () => {
    const input = fixture(); const p = ports(); p.accessToken.mockResolvedValue({ token: 'fake-access-value', project: 'my-project', principal: 'other@my-project.iam.gserviceaccount.com' });
    await expect(executeGatewayEmbedding(input, p)).rejects.toMatchObject({ code: 'AUTH' }); expect(input.authorizeClaim).not.toHaveBeenCalled(); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('rejects a correctly bound profile with the wrong billing-project quota scope', async () => {
    const input = fixture(); (input.profile.quotaDimensions[0].scope as any).id = 'unrelated-project';
    (input.claim.binding as any).profileBinding = evidenceBinding(withoutEvidence(input.profile));
    (input.claim as any).intentBinding = evidenceBinding(input.claim.binding);
    const p = ports(); await expect(executeGatewayEmbedding(input, p)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    expect(p.accessToken).not.toHaveBeenCalled(); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('rejects an ADC project mismatch before dispatch', async () => {
    const input = fixture(); const p = ports(); p.accessToken.mockResolvedValue({ token: 'fake-access-value', project: 'other-project', principal: input.transport.credentialPrincipal });
    await expect(executeGatewayEmbedding(input, p)).rejects.toMatchObject({ code: 'AUTH' }); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('does not send after a denied claim', async () => {
    const input = fixture(); vi.mocked(input.authorizeClaim).mockResolvedValue(false); const p = ports();
    await expect(executeGatewayEmbedding(input, p)).rejects.toMatchObject({ code: 'POLICY_BLOCKED' }); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('checks expiry again after the asynchronous claim', async () => {
    vi.useFakeTimers(); const input = fixture(); const p = ports(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { vi.setSystemTime(Date.now() + 11000); return true; });
    await expect(executeGatewayEmbedding(input, p)).rejects.toThrow(); expect(p.fetch).not.toHaveBeenCalled();
  });
  it('keeps the original reviewed config if caller mutates its objects during auth', async () => {
    const input = fixture(); const p = ports(); vi.mocked(input.authorizeClaim).mockImplementation(async () => { (input.transport as any).project = 'other-project'; return true; });
    await executeGatewayEmbedding(input, p); expect(p.fetch.mock.calls[0][0]).toContain('/my-project/');
  });
  it.each([{ token_count: 4, truncated: true }, { token_count: 4 }, { token_count: 4, truncated: false, bad: true }])('rejects truncated/unknown truncation but ignores irrelevant metadata %j', async stats => {
    const p = ports(); p.fetch.mockResolvedValue(response(stats)); const input = fixture();
    if (stats.truncated === false) await expect(executeGatewayEmbedding(input, p)).resolves.toBeDefined();
    else await expect(executeGatewayEmbedding(input, p)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([undefined, 0, -1, 2049, '4'])('keeps full hold without trustworthy positive token statistics %s', async token_count => {
    const p = ports(); p.fetch.mockResolvedValue(response({ token_count, truncated: false })); const input = fixture();
    const result = await executeGatewayEmbedding(input, p); expect(readGatewayEmbeddingUsage(result, input.claim)).toBeUndefined();
  });
  it.each([Array(767).fill(1), Array(768).fill(null)])('rejects changed vector space or malformed values', async values => {
    const p = ports(); p.fetch.mockResolvedValue(response(undefined, values)); await expect(executeGatewayEmbedding(fixture(), p)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('honors already cancelled input before ADC', async () => {
    const input = fixture(); const c = new AbortController(); c.abort(); const p = ports();
    await expect(executeGatewayEmbedding({ ...input, signal: c.signal }, p)).rejects.toMatchObject({ code: 'ABORTED' }); expect(p.accessToken).not.toHaveBeenCalled();
  });
  it('aborts a hanging fetch without retrying or exposing raw errors', async () => {
    vi.useFakeTimers(); const p = ports(); p.fetch.mockImplementation(async () => new Promise(() => {}));
    const result = executeGatewayEmbedding(fixture(), p); const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(6001); await assertion; expect(p.fetch).toHaveBeenCalledOnce();
    expect((p.fetch.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  });
  it('preserves an authenticated over-bound character contradiction for durable quarantine', async () => {
    const input = fixture(); const p = ports(); p.fetch.mockResolvedValue(new Response(JSON.stringify({ metadata: { billable_character_count: 999999 }, predictions: [] })));
    const error = await executeGatewayEmbedding(input, p).catch(e => e);
    expect(input.reportCostAnomaly).toHaveBeenCalledWith(error);
    expect(readGatewayEmbeddingCostAnomaly(error, input.claim)).toMatchObject({ kind: 'paid-liability-contradiction' });
    expect(readGatewayEmbeddingCostAnomaly({ ...error }, input.claim)).toBeUndefined();
  });
  it('uses characters conservatively, not token count, including non-BMP text', () => {
    expect(gatewayEmbeddingMaximumNanoUsd('😀', 25)).toBe(100); expect(() => gatewayEmbeddingMaximumNanoUsd('x', 24)).toThrow();
  });
});

describe('embedding credential association and private health', () => {
 it('hashes only canonical project/principal, not structurally extra transport fields', () => {
  const pair = { project: 'my-project', credentialPrincipal: 'runtime@my-project.iam.gserviceaccount.com' };
  const extended = { ...pair, timeoutMs: 30000, rateCard: 'different-version' };
  expect(gatewayEmbeddingCredentialBinding(pair)).toBe(gatewayEmbeddingCredentialBinding(extended));
 });
 it.each([[401,'auth'],[403,'auth'],[503,'transient'],[429,'transient']] as const)('authenticates physical HTTP%s without minting money usage',async(status,kind)=>{
  const input=fixture();const p=ports();p.fetch.mockResolvedValue(new Response('{}',{status,headers:{'retry-after':'3600'}}));
  const error=await executeGatewayEmbedding(input,p).catch(e=>e);expect(readGatewayEmbeddingHealth(error,input.claim)).toMatchObject({kind});
  expect(readGatewayEmbeddingHealth({...error},input.claim)).toBeUndefined();expect(readGatewayEmbeddingUsage(error,input.claim)).toBeUndefined();
 });
 it('marks an unrepresentable provider cooldown unavailable without shortening it',async()=>{
  const input=fixture();const p=ports();p.fetch.mockResolvedValue(new Response('{}',{status:429,headers:{'retry-after':'691200'}}));
  const error=await executeGatewayEmbedding(input,p).catch(e=>e);expect(readGatewayEmbeddingHealth(error,input.claim)?.kind).toBe('cooldown-unavailable');
 });
 it('does not certify denied ADC identity or forged timeout reason as physical health',async()=>{
  const input=fixture();const p=ports();p.accessToken.mockResolvedValue({token:'synthetic',project:'wrong-project',principal:'wrong'});
  const error=await executeGatewayEmbedding(input,p).catch(e=>e);expect(readGatewayEmbeddingHealth(error,input.claim)).toBeUndefined();expect(p.fetch).not.toHaveBeenCalled();
  const c=new AbortController();const q=ports();q.fetch.mockImplementation(async()=>{c.abort({kind:'inference-executor-timeout'});return new Promise(()=>{});});
  const aborted=await executeGatewayEmbedding({...input,signal:c.signal},q).catch(e=>e);expect(readGatewayEmbeddingHealth(aborted,input.claim)).toBeUndefined();
 });
});

it('binds zero Retry-After and its receipt to one observation time even when the clock advances', async () => {
 const input=fixture();const p=ports();p.fetch.mockResolvedValue(new Response('{}',{status:429,headers:{'retry-after':'0'}}));
 let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now++);
 try { const error=await executeGatewayEmbedding(input,p).catch(e=>e);const proof=readGatewayEmbeddingHealth(error,input.claim)!;
  expect(proof.kind).toBe('transient');expect(proof.cooldownUntilMs).toBe(proof.receivedAtMs);
 } finally {clock.mockRestore();}
});
