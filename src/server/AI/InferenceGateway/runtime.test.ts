/** Offline vertical tests: real issuer, planner, ledger and transport; only Firebase/token/network edges are simulated. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
import { guestDailyQuota } from '../../lib/guestDailyQuota';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ db: null as unknown, verify: vi.fn(), maintenance: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: () => mocks.db }));
vi.mock('../../lib/authMiddleware', () => ({ verifyFirebaseToken: mocks.verify }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: mocks.maintenance }));
vi.mock('../../lib/adminEmails', () => ({ adminEmailList: () => [] }));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {
  async getCredentials() { return { client_email: 'runtime@my-project.iam.gserviceaccount.com' }; }
  async getAccessToken() { return 'synthetic-adc-token'; }
  async getProjectId() { return 'my-project'; }
} }));
import { assertGatewayAccountAccess, currentInferenceGatewayContext, inferenceGatewayEnabled, isGatewayRouteSelected, isGatewayTerminalError,
  maybeGatewayText, maybeGatewayEmbedding, maybeGatewayGrounding, maybeGatewayVision, maintainGatewayQuotaWindows, runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext } from './runtime';
import type { InferenceGatewayContext } from './context';
import { GATEWAY_CATALOG_PATH, GatewayAuthorityStore, type GatewayCatalog } from './authorityStore';
import { gatewayAccountFencePath, gatewayAccountCooldownPath, gatewayCredentialHealthPath } from './accountMigration';
import { FirestoreInferenceLedger, gatewayLedgerPath } from './firestoreLedger';
import { evidenceBinding, quotaLedgerKey } from './profiles';
import { FreeChainStore } from '../FreeChain/store';
import { runWithInferenceScope } from '../inferencePolicy';
import { gatewayTextCredentialBinding } from './textTransport';
import { isGatewayFreePricingProof } from './pricingEvidence';
import { gatewayEmbeddingCredentialBinding, VERTEX_EMBEDDING_VECTOR_SPACE } from './embeddingTransport';
import { gatewayQuotaRulePath, gatewayQuotaWindow, type GatewayQuotaRule } from './quotaRollover';
import { civilDayWindow } from '../FreeChain/quota';

function database() {
  const docs = new Map<string, unknown>(); let transaction = Promise.resolve(); let onRead: ((path: string) => void) | undefined; let onCommitted: ((writes: ReadonlyMap<string, unknown>) => void) | undefined;
  const copy = <T>(value: T): T => structuredClone(value);
  const doc = (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => copy(docs.get(path)) }) });
  const db = { doc, runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = transaction.then(async () => {
      const pending = new Map<string, unknown>();
      const tx = { async get(ref: { path: string }) { if (pending.size) throw new Error('Read after write'); onRead?.(ref.path);
        return { exists: docs.has(ref.path), data: () => copy(docs.get(ref.path)) }; },
      set(ref: { path: string }, value: unknown) { pending.set(ref.path, copy(value)); },
      create(ref: { path: string }, value: unknown) { if (docs.has(ref.path) || pending.has(ref.path)) throw new Error('Already exists'); pending.set(ref.path, copy(value)); } };
      const result = await fn(tx as unknown as Transaction); for (const [key, value] of pending) docs.set(key, value); onCommitted?.(pending); return result;
    });
    transaction = run.then(() => {}, () => {}); return run;
  } } as unknown as Firestore;
  return { db, docs, onRead: (fn: (path: string) => void) => { onRead = fn; }, onCommitted: (fn: (writes: ReadonlyMap<string, unknown>) => void) => { onCommitted = fn; } };
}
function context(overrides: Partial<InferenceGatewayContext> = {}): InferenceGatewayContext {
  return { principalId: 'verified-user', tenantId: 'verified-user', surface: 'chat', policyKey: 'chat:text',
    qualityTier: 'clinical', dataClass: 'health', funding: 'platform-free-fallback', mode: 'free-first-authorized-paid',
    deadlineAtMs: Date.now() + 90_000, ...overrides };
}
function fixture(paid = false, freeProvider: 'GLM' | 'GROQ' = 'GLM', quotaWindowMs = 61000) {
  const state = database(); const now = Date.now(); const provider = paid ? 'DEEPSEEK' : freeProvider; const legacyProvider = paid ? 'deepseek' : freeProvider.toLowerCase();
  const model = paid ? 'deepseek-flash' : freeProvider === 'GROQ' ? 'reviewed-groq-model' : 'glm-4.7-flash';
  const payer = { kind: 'platform' as const, ownerId: 'reviewed-owner' };
  const quality = { tier: 'clinical' as const, gateId: 'synthetic-clinical-gate', gateVersion: 'v1' };
  const privacy = { dataClass: 'health' as const, policyId: 'synthetic-private-policy', allowedProcessingRegions: ['reviewed-region'], maxRetentionHours: 0, allowTraining: false, allowHumanReview: false };
  const c: GatewayCatalog = { kind: 'gateway_catalog', version: 1, enabled: true, revision: 'synthetic-catalog-v1', issuedAtMs: now - 100, expiresAtMs: now + 60_000,
    platformScope: { id: 'platform-free-fallback', ownerId: payer.ownerId },
    policies: { 'chat:text': { surface: 'chat', funding: 'platform-free-fallback', termsPolicyId: 'reviewed-terms-v1', quality, privacy,
      maxInputTokens: 4096, maxOutputTokens: 512, maxQueueWaitMs: 5000, firstOutputTimeoutMs: 5000, attemptTimeoutMs: 60_000, logicalLimitNanoUsd: 10_000_000 } },
    profiles: [{ accountCredentialBinding: gatewayTextCredentialBinding('synthetic-secret-never-live'),
      ...(paid ? {} : { freeBillingSafety: { kind: 'intrinsic-zero' as const, evidenceRef: 'reviewed-zero-price', reviewedAtMs: now - 100, expiresAtMs: now + 60_000 } }), canonicalModelId: paid ? 'deepseek-flash-canonical' : freeProvider === 'GROQ' ? 'reviewed-groq-canonical' : 'glm-flash-canonical', profile: { id: 'profile-one', version: 'v1', providerId: provider, modelId: model, modelRevision: 'reviewed-model-v1',
      adapterId: 'gateway-openai-text-v1', status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: ['chat'],
      qualityApprovals: [quality], termsApprovals: ['reviewed-terms-v1'], capabilities: [{ kind: 'text', maxInputTokens: 4096, maxOutputTokens: 512, maxContextTokens: 4608, streaming: true, systemPrompt: true }],
      privacy: { dataClasses: ['health'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['reviewed-region'] }, credentialOwner: payer,
      quotaDimensions: [{ scope: { providerId: provider, kind: 'account', id: 'reviewed-account-one' }, meter: 'requests/day' },
        { scope: { providerId: provider, kind: 'account', id: 'reviewed-account-one' }, meter: 'tokens/minute' }],
      charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: 'catalog-reviewed-profile' },
      transport: { provider, baseURL: paid ? 'https://api.deepseek.com/v1' : freeProvider === 'GROQ' ? 'https://api.groq.com/openai/v1' : 'https://api.z.ai/api/paas/v4', model,
        maxOutputTokens: 512, timeoutMs: 60_000, streamUsage: true, credentialEnv: 'INFERENCE_GATEWAY_TEST_CREDENTIAL', credentialBinding: gatewayTextCredentialBinding('synthetic-secret-never-live'),
        ...(paid ? { rateCard: { version: 'reviewed-rate-v1', inputNanoUsdPerMillion: 300_000_000, outputNanoUsdPerMillion: 1_200_000_000,
          cachedInputNanoUsdPerMillion: 6_000_000, verifiedAtMs: now - 100, expiresAtMs: now + 60_000 } } : {}) },
      availability: { coolingUntilMs: 0, predictedQueueMs: 0, predictedFirstOutputMs: 10, predictedCompletionMs: 100 }, legacyProvider, migrationId: 'reviewed-migration-v1',
      review: { account: 'account-review', terms: 'terms-review', quality: 'quality-review', privacy: 'privacy-review', capability: 'capability-review', pricing: 'pricing-review' },
      reviewedAtMs: now - 100, expiresAtMs: now + 60_000 }] };
  state.docs.set(GATEWAY_CATALOG_PATH, c);
  state.docs.set(gatewayAccountFencePath(legacyProvider, ['reviewed-account-one']), { kind: 'gateway_account_owner', version: 2, provider: legacyProvider, migrationId: 'reviewed-migration-v1', authority: 'gateway-local-capacity',
    accountScopeIds: ['reviewed-account-one'], accountReviewRef: 'review-of-actual-shared-account', upstreamQuota: 'unknown',
    credentialBindings: [gatewayTextCredentialBinding('synthetic-secret-never-live')], reviewedAtMs: now - 100, expiresAtMs: now + 60_000 });
  for (const d of c.profiles[0].profile.quotaDimensions) {
    const ledgerKey = quotaLedgerKey(d);
    const rule: GatewayQuotaRule = { kind: 'gateway_quota_rule', version: 1, ledgerKey, revision: 1, dimension: d,
      overlappingDimensions: c.profiles[0].profile.quotaDimensions, migrationId: 'reviewed-migration-v1', limit: d.meter.startsWith('requests') ? 100 : 100_000,
      reviewRef: 'reviewed-local-pressure-rule', reviewedAtMs: now - 100, expiresAtMs: now + 60_000,
      reset: { kind: 'fixed-interval', anchorAtMs: now - 1000, intervalMs: quotaWindowMs }, accounting: 'local-only',
      accountPolicyPath: gatewayAccountFencePath(legacyProvider, ['reviewed-account-one']),
      accountPolicyBinding: evidenceBinding(state.docs.get(gatewayAccountFencePath(legacyProvider, ['reviewed-account-one']))),
      zeroBaseline: { kind: 'local-reservation-window', evidenceRef: 'reviewed-local-window' } };
    const window = gatewayQuotaWindow(rule, now)!; state.docs.set(gatewayQuotaRulePath(ledgerKey), rule);
    state.docs.set(gatewayLedgerPath('quota-policy', ledgerKey), { kind: 'gateway_quota_policy', version: 1, ledgerKey, revision: 1,
      authority: 'gateway-local-capacity', accountingBasis: 'gateway-local-only', migrationId: 'reviewed-migration-v1', limit: d.meter.startsWith('requests') ? 100 : 100_000, window, rolloverRule: { revision: 1, binding: evidenceBinding(rule) } });
    state.docs.set(gatewayLedgerPath('quota-state', ledgerKey), { kind: 'gateway_quota_state', version: 1, ledgerKey, migrationId: 'reviewed-migration-v1', held: 0, quarantined: false });
    state.docs.set(gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, window.id])), { kind: 'gateway_quota_period', version: 1, ledgerKey, window, spent: 5 });
  }
  if (paid) state.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10_000_000_000, updatedAt: now - 100, source: 'admin' });
  mocks.db = state.db; return { ...state, catalog: c, legacyProvider };
}
const response = (paid = false) => new Response(JSON.stringify({ model: paid ? 'deepseek-flash' : 'glm-4.7-flash', choices: [{ index: 0, message: { content: 'Verified answer' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0 } }), { headers: { 'content-type': 'application/json' } });
const req = { headers: { authorization: 'Bearer non-secret-fixture' } } as Request;
const run = (c = context(), input = { prompt: 'Hello', systemPrompt: 'Keep the complete instructions.' }) =>
  runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(c, () => maybeGatewayText(input)));
let network: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => { mocks.verify.mockReset().mockResolvedValue('verified-user'); mocks.maintenance.mockReset().mockResolvedValue(undefined); mocks.db = null;
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_TEST_CREDENTIAL', 'synthetic-secret-never-live');
  network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('production gateway runtime composition', () => {
  it('keeps OFF and explicitly unselected surfaces on legacy without auth, DB or provider calls', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); expect(inferenceGatewayEnabled()).toBe(false);
    await expect(run()).resolves.toBeNull(); expect(mocks.verify).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'professional'); await expect(run()).resolves.toBeNull();
  });
  it('does not treat plain context strings as authentication or approval', async () => {
    fixture(); await expect(runWithInferenceGatewayContext(context(), () => maybeGatewayText({ prompt: 'Hello' }))).rejects.toMatchObject({ reason: 'context-unverified' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([null, 'different-user'])('denies invalid/mismatched real ingress UID %s', async uid => {
    fixture(); mocks.verify.mockResolvedValue(uid); await expect(run()).rejects.toMatchObject({ reason: 'context-unverified' }); expect(network).not.toHaveBeenCalled();
  });
  it('binds exact prompt and system through issuer/planner/shared transaction/real transport, and settles measured quota', async () => {
    const f = fixture(); const result = await run(); expect(result).toMatchObject({ ok: true, content: 'Verified answer', usage: { inputTokens: 100, outputTokens: 20 } });
    expect(isGatewayFreePricingProof(result?.gatewayPricingProof, { provider: result?.provider, model: result?.model, usage: result?.usage, logicalRequestId: result?.inferenceGateway?.logicalRequestId })).toBe(true);
    expect(network).toHaveBeenCalledOnce(); const body = JSON.parse(network.mock.calls[0][1]!.body as string);
    expect(body.messages).toEqual([{ role: 'system', content: 'Keep the complete instructions.' }, { role: 'user', content: 'Hello' }]);
    const attempts = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ phase: 'settled', record: { outcome: 'completed', outputVisible: true } });
    expect(attempts[0].dispatchAuthorizedAtMs).toEqual(expect.any(Number));
    expect([...f.docs.values()].filter((v: any) => v.kind === 'gateway_quota_state')).toEqual(expect.arrayContaining([expect.objectContaining({ held: 0 })]));
    expect(f.docs.has('free_chat_chain/paid_budget_policy')).toBe(false);
  });
  it('retains conservative paid maximum in the existing ONE IST-day ledger until exact charges are proven', async () => {
    const f = fixture(true); network.mockResolvedValue(response(true)); const result = await run(); expect(result?.ok).toBe(true);
    const day = civilDayWindow(Date.now(), 'Asia/Kolkata'); expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ spentNanoUsd: 0, heldNanoUsd: 1843200, pending: 1 });
    expect([...f.docs.keys()].filter(p => p.includes('paid_day_'))).toHaveLength(1);
  });
  it('books complete paid usage as a conservative liability ceiling, not actual invoice money', async () => {
    const f = fixture(true);
    network.mockResolvedValue(new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ index: 0, message: { content: 'Answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 10 } } }), { headers: { 'content-type': 'application/json' } }));
    expect((await run())?.ok).toBe(true);
    const day = civilDayWindow(Date.now(), 'Asia/Kolkata');
    expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ spentNanoUsd: 54000, heldNanoUsd: 0, pending: 0, conservativePending: 1 });
    const usages = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_usage') as any[];
    expect(usages).toHaveLength(1); expect(usages[0].usage).toMatchObject({ chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: 54000 });
    expect(usages[0].usage).not.toHaveProperty('actualNanoUsd');
    expect([...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt')).toMatchObject({ phase: 'settled' });
  });
  it('retains the original paid maximum after catalog price changes during generation', async () => {
    const f = fixture(true);
    network.mockImplementation(async () => {
      f.catalog.revision = 'repriced-during-generation';
      return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ index: 0, message: { content: 'Answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100,
          prompt_tokens_details: { cached_tokens: 0 } } }), { headers: { 'content-type': 'application/json' } });
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    const day = civilDayWindow(Date.now(), 'Asia/Kolkata');
    expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ spentNanoUsd: 0, heldNanoUsd: 1843200, pending: 1 });
  });
  it('durably quarantines paid reporting above a complete-usage ceiling before a fresh request can dispatch', async () => {
    const f = fixture(true); network.mockResolvedValue(new Response(JSON.stringify({ model: 'deepseek-flash',
      choices: [{ index: 0, message: { content: 'Answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100,
        prompt_tokens_details: { cached_tokens: 0 }, cost: '0.0001' } }), { headers: { 'content-type': 'application/json' } }));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect([...f.docs.values()].find((v: any) => v.kind === 'gateway_transport_incident')).toMatchObject({ anomaly: 'paid-liability-contradiction', unresolved: true });
    expect(f.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ capNanoUsd: 0, source: 'safety' });
    network.mockClear().mockResolvedValue(response(true));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const day = civilDayWindow(Date.now(), 'Asia/Kolkata');
    expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ spentNanoUsd: 0, heldNanoUsd: 1843200, pending: 1 });
  });
  it('ambient strict-free overrides permissive context and never reaches paid transport', async () => {
    fixture(true); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
    await expect(runWithInferenceScope('free-modules', () => run())).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('does not invent a paid allowance when shared paid policy is absent', async () => {
    const f = fixture(true); f.docs.delete('free_chat_chain/paid_budget_policy'); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['existing-professional', 'existing-tenant', 'funded-builder', 'tenant-byok'] as const)('does not divert %s to platform money', async funding => {
    fixture(); await expect(run(context({ funding }))).rejects.toMatchObject({ reason: 'funding-integration-unavailable' }); expect(network).not.toHaveBeenCalled();
  });
  it.each([{ schema: {} }, { images: ['data:image/png;base64,test'] }, { modelOverride: 'unreviewed-model' }])('does not strip unsupported inputs %j', async feature => {
    fixture(); await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(), () => maybeGatewayText({ prompt: 'Hello', ...feature })))).rejects.toMatchObject({ reason: 'capability-integration-unavailable' }); expect(network).not.toHaveBeenCalled();
  });
  it('stays terminal after selected rollout is switched OFF', async () => {
    fixture(); await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(), () => {
      expect(isGatewayRouteSelected()).toBe(true); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); return maybeGatewayText({ prompt: 'Hello' });
    }))).rejects.toMatchObject({ reason: 'disabled-after-selection' }); expect(network).not.toHaveBeenCalled();
  });
  it('keeps excluded image contexts unselected', async () => {
    expect(inferenceGatewayEnabled('image-generation')).toBe(false); expect(inferenceGatewayEnabled('image-enhancement')).toBe(false);
    expect(await run(context({ surface: 'image-generation' }))).toBeNull(); expect(network).not.toHaveBeenCalled();
  });
  it.each(['dataClass', 'qualityTier', 'tenantId', 'funding'] as const)('rejects nested %s weakening/substitution', async field => {
    fixture(); const outer = context(); const weaker = field === 'dataClass' ? { dataClass: 'public' as const } : field === 'qualityTier' ? { qualityTier: 'standard' as const }
      : field === 'tenantId' ? { tenantId: 'other' } : { funding: 'existing-tenant' as const };
    await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(outer, () =>
      runWithInferenceGatewayContext({ ...outer, ...weaker }, () => maybeGatewayText({ prompt: 'Hello' }))))).rejects.toMatchObject({ reason: 'context-unverified' });
    expect(network).not.toHaveBeenCalled();
  });
  it('retains ancestor cancellation even if a nested helper supplies another signal', async () => {
    fixture(); const controller = new AbortController(); controller.abort(); const outer = context({ signal: controller.signal });
    await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(outer, () =>
      runWithInferenceGatewayContext({ ...outer, signal: new AbortController().signal }, () => maybeGatewayText({ prompt: 'Hello' }))))).rejects.toMatchObject({ reason: 'cancelled' });
    expect(network).not.toHaveBeenCalled();
  });
  it('checks maintenance before credentials or dispatch', async () => {
    fixture(); mocks.maintenance.mockRejectedValue(new Error('maintenance')); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['catalog', 'fence', 'quota-policy', 'quota-state', 'quota-period'] as const)('missing %s is not a fresh allowance', async missing => {
    const f = fixture(); if (missing === 'catalog') f.docs.delete(GATEWAY_CATALOG_PATH);
    else if (missing === 'fence') f.docs.delete(gatewayAccountFencePath(f.legacyProvider, ['reviewed-account-one']));
    else for (const key of f.docs.keys()) if (key.includes(`gateway_${missing.replace('-', '_')}_`)) f.docs.delete(key);
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['qualityApprovals', 'termsApprovals'] as const)('never manufactures %s from account declaration', async field => {
    const f = fixture(); f.catalog.profiles[0].profile = { ...f.catalog.profiles[0].profile, [field]: [] };
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('fails current configuration revocation before a physical dispatch', async () => {
    const f = fixture(); let catalogReads = 0; f.onRead(path => { if (path === GATEWAY_CATALOG_PATH && ++catalogReads === 3) f.docs.set(path, { ...f.catalog, enabled: false }); });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('leaves unknown transport charges held and never silently retries a provider', async () => {
    const f = fixture(true); network.mockRejectedValue(new Error('socket lost secret must not propagate'));
    await expect(run()).rejects.toSatisfy(isGatewayTerminalError); expect(network).toHaveBeenCalledOnce();
    const attempts = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    expect(attempts[0]).toMatchObject({ phase: 'pending', record: { outcome: 'uncertain' } }); expect(attempts[0].heldNanoUsd).toBeGreaterThan(0);
  });
  it('preserves legacy FreeChain quota behavior even if a gateway account review is malformed', async () => {
    const f = fixture(); f.docs.set(gatewayAccountFencePath('glm', ['reviewed-account-one']), { malformed: true });
    const store = new FreeChainStore(f.db); await expect(store.reserveQuota({ provider: 'glm', model: 'account-free-models', quotaScope: 'account', inputTokens: 10, outputTokens: 10,
      timeZone: 'UTC', limits: { rpm: 100, rpd: 1000 }, safetyMargin: .9 })).resolves.toMatchObject({ allowed: true });
    await expect(store.quotaSnapshot({ provider: 'glm', model: 'account-free-models', quotaScope: 'account', timeZone: 'UTC' })).resolves.toMatchObject({ available: true });
  });
  it('skips exhausted reviewed free capacity and initially selects eligible paid capacity', async () => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    free.catalog.profiles.push(paid.catalog.profiles[0]);
    const dimension = free.catalog.profiles[0].profile.quotaDimensions[0];
    const key = gatewayLedgerPath('quota-policy', quotaLedgerKey(dimension));
    free.docs.set(key, { ...(free.docs.get(key) as object), limit: 0 });
    mocks.db = free.db; network.mockResolvedValue(response(true));
    expect(await run()).toMatchObject({ ok: true, provider: 'DEEPSEEK' }); expect(network).toHaveBeenCalledOnce();
  });
  it('durably rejects replay and closes the final guard rather than reusing an earlier authorization', async () => {
    fixture(); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      const first = await authorize.call(this, claim); expect(first).toBe(true);
      expect(await authorize.call(this, claim)).toBe(false); return first;
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('honors a paid authority revocation after claim but before actual network invocation', async () => {
    const f = fixture(true); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      f.docs.set('free_chat_chain/paid_budget_policy', { ...(f.docs.get('free_chat_chain/paid_budget_policy') as object), revision: 2, capNanoUsd: 0 });
      return await authorize.call(this, claim);
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('journals streaming output before exposure and never hops providers after a truncated stream', async () => {
    const f = fixture(); const chunks: string[] = [];
    network.mockResolvedValue(new Response('data: ' + JSON.stringify({ model: 'glm-4.7-flash', choices: [{ index: 0, delta: { content: 'Partial answer' }, finish_reason: null }] }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } }));
    const result = await runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(), () => maybeGatewayText({ prompt: 'Hello', onChunk: chunk => {
      const attempts = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
      expect(attempts[0].record.outputVisible).toBe(true); chunks.push(chunk);
    } })));
    expect(result).toMatchObject({ ok: true, reason: 'stalled', content: 'Partial answer' }); expect(chunks).toEqual(['Partial answer']); expect(network).toHaveBeenCalledOnce();
  });
  it.each(['evidence-expiry', 'quota-expiry', 'IST-midnight'] as const)('revalidates %s after final asynchronous reads, not at pre-read time', async crossing => {
    const initial = Date.parse('2026-10-23T18:29:59.500Z'); let now = initial; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(crossing === 'IST-midnight', 'GLM', crossing === 'quota-expiry' ? 1500 : 61000); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    if (crossing === 'quota-expiry') for (const [key, value] of f.docs) {
      const record = value as any; if (record.kind === 'gateway_quota_policy' || record.kind === 'gateway_quota_period') record.window.endsAtMs = initial + 500;
    }
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      if (crossing === 'evidence-expiry') for (const value of f.docs.values()) { const record = value as any; if (typeof record.binding === 'string' && 'revoked' in record) record.expiresAtMs = initial + 500; }
      let states = 0;
      f.onRead(path => { if (crossing === 'IST-midnight' ? path.includes('/paid_day_') : path.includes('/gateway_quota_state_') && ++states === 2) now = initial + 1000; });
      return await authorize.call(this, claim);
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any; expect(attempt.dispatchAuthorizedAtMs).toBeUndefined();
  });
  it.each(['evidence-expiry', 'quota-expiry', 'IST-midnight'] as const)('rejects %s crossed after dispatch transaction commits but before its response', async crossing => {
    const initial = Date.parse('2026-10-23T18:29:59.500Z'); let now = initial; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(crossing === 'IST-midnight', 'GLM', crossing === 'quota-expiry' ? 1500 : 61000);
    const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function(claim) {
      if (crossing === 'evidence-expiry') for (const value of f.docs.values()) { const record = value as any; if (typeof record.binding === 'string' && 'revoked' in record) record.expiresAtMs = initial + 500; }
      f.onCommitted(writes => { if ([...writes.values()].some((v: any) => v.kind === 'gateway_attempt' && v.dispatchAuthorizedAtMs !== undefined)) now = initial + 1000; });
      return await authorize.call(this, claim);
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any;
    expect(attempt.dispatchAuthorizedAtMs).toBe(initial); expect(attempt.heldQuota.length).toBeGreaterThan(0);
    for (const hold of attempt.heldQuota) expect(f.docs.get(gatewayLedgerPath('quota-state', hold.ledgerKey))).toMatchObject({ held: hold.amount });
    if (crossing === 'IST-midnight') expect(attempt.heldNanoUsd).toBeGreaterThan(0);
  });
  it('rechecks the private exact-claim horizon synchronously after authorization returns before fetch', async () => {
    const initial = Date.parse('2026-10-23T12:00:00Z'); let now = initial; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(false, 'GLM', 1500); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function(claim) {
      const allowed = await authorize.call(this, claim); expect(allowed).toBe(true);
      now = initial + 1000; return allowed;
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any; expect(attempt.dispatchAuthorizedAtMs).toBe(initial); expect(attempt.heldQuota.length).toBeGreaterThan(0);
  });
  it.each(['claim-mismatch', 'clock-regression', 'adapter-closed'] as const)('never reopens a final dispatch fence after %s', async change => {
    const initial = Date.parse('2026-10-23T12:00:00Z'); let now = initial; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function(claim) {
      if (change === 'adapter-closed') f.onCommitted(writes => { if ([...writes.values()].some((v: any) => v.kind === 'gateway_attempt' && v.dispatchAuthorizedAtMs !== undefined)) this.closeDispatchClaim(claim); });
      const allowed = await authorize.call(this, claim);
      if (change === 'claim-mismatch') expect(this.isDispatchClaimCurrent({ ...claim, id: 'different-reservation' })).toBe(false);
      if (change === 'clock-regression') now = initial - 1;
      if (change === 'adapter-closed') { expect(allowed).toBe(false); expect(this.isDispatchClaimCurrent(claim)).toBe(false); }
      return allowed;
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any; expect(attempt.dispatchAuthorizedAtMs).toBe(initial); expect(attempt.heldQuota.length).toBeGreaterThan(0);
  });
  it.each(['disable', 'strict'] as const)('rechecks %s policy after asynchronous dispatch authorization', async change => {
    fixture(true); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      const allowed = await authorize.call(this, claim);
      if (change === 'disable') vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); else vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
      return allowed;
    });
    await expect(runWithInferenceScope('free-modules', () => run())).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['builder', 'developer-api', 'published-app', 'image-generation', 'image-enhancement', 'doctor', 'sda'] as const)('never selects excluded product %s, even under the master ON switch', async surface => {
    expect(inferenceGatewayEnabled(surface)).toBe(false); await expect(run(context({ surface, funding: 'funded-builder' }))).resolves.toBeNull(); expect(network).not.toHaveBeenCalled();
  });
  it('retries an authenticated HTTP429 on the next eligible account while retaining the first full quota hold', async () => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    free.catalog.profiles.push(paid.catalog.profiles[0]); mocks.db = free.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '3600' } })).mockResolvedValueOnce(response(true));
    expect(await run()).toMatchObject({ ok: true, provider: 'DEEPSEEK' }); expect(network).toHaveBeenCalledTimes(2);
    const attempts = [...free.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    expect(attempts).toHaveLength(2);
    expect(free.docs.get(gatewayAccountCooldownPath('glm', ['reviewed-account-one']))).toMatchObject({ untilMs: attempts[0].retryRejection.receivedAtMs + 3600000 });
    expect(attempts[0]).toMatchObject({ phase: 'pending', record: { outcome: 'definite-failure', failureClass: 'retryable-provider-failure', outputVisible: false }, retryRejection: { status: 429 } });
    for (const held of attempts[0].heldQuota) expect(free.docs.get(gatewayLedgerPath('quota-state', held.ledgerKey))).toMatchObject({ held: held.amount });
    expect(attempts[1]).toMatchObject({ phase: 'pending', record: { outcome: 'completed' } });
    const logical = [...free.docs.values()].find((v: any) => v.kind === 'gateway_logical') as any; expect(logical.attempts).toHaveLength(2); expect(logical.heldNanoUsd).toBe(attempts[1].heldNanoUsd);
  });
  it.each([[401, 'auth'], [503, 'transient']] as const)('durably cools physical %s failures across fresh runtime instances without releasing holds', async (status, kind) => {
    const f = fixture(); network.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status }));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
    const path = kind === 'auth' ? gatewayCredentialHealthPath('glm', ['reviewed-account-one'], f.catalog.profiles[0].accountCredentialBinding) : gatewayAccountCooldownPath('glm', ['reviewed-account-one']);
    expect(f.docs.get(path)).toMatchObject({ reason: kind, failures: 1 });
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any;
    expect(attempt).toMatchObject({ phase: 'pending', record: { outcome: 'uncertain' } });
    for (const hold of attempt.heldQuota) expect(f.docs.get(gatewayLedgerPath('quota-state', hold.ledgerKey))).toMatchObject({ held: hold.amount });
    network.mockClear().mockResolvedValue(response()); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('persists an excessive provider cooldown until reviewed recovery, not a shorter next-request retry', async () => {
    const f = fixture(); network.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '691200' } }));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(f.docs.get(gatewayAccountCooldownPath('glm', ['reviewed-account-one']))).toMatchObject({ untilMs: Number.MAX_SAFE_INTEGER, reason: 'cooldown-unavailable' });
    expect([...f.docs.values()].filter((v: any) => v.kind === 'gateway_rejection')).toHaveLength(0);
    network.mockClear().mockResolvedValue(response()); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('records a real coordinator first-output timeout separately from user cancellation', async () => {
    const f = fixture(); f.catalog.policies['chat:text'].firstOutputTimeoutMs = 10;
    network.mockImplementation(() => new Promise(() => {}));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    await vi.waitFor(() => expect(f.docs.get(gatewayAccountCooldownPath('glm', ['reviewed-account-one']))).toMatchObject({ reason: 'transient' }));
    expect(network).toHaveBeenCalledOnce(); expect([...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt')).toMatchObject({ phase: 'pending' });
  });
  it('rechecks an account circuit opened after claim before fetch', async () => {
    const f = fixture(); const original = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      f.docs.set(gatewayAccountCooldownPath('glm', ['reviewed-account-one']), { kind: 'gateway_account_cooldown', version: 1, untilMs: Date.now() + 30000 });
      return original.call(this, claim);
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each([401, 403, 400, 500, 503])('does not turn HTTP%s into an unproven retry', async status => {
    const f = fixture(); network.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status }));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
    expect([...f.docs.values()].filter((v: any) => v.kind === 'gateway_rejection')).toHaveLength(0);
  });
  it.each([
    { message: { refusal: 'cannot comply' } }, { delta: { refusal: 'cannot comply' } }, { finish_reason: 'content_filter' },
  ])('does not hop on contradictory HTTP429 plus typed refusal %j', async choice => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    free.catalog.profiles.push(paid.catalog.profiles[0]); mocks.db = free.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' }, choices: [choice] }), { status: 429 })).mockResolvedValueOnce(response(true));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
    expect([...free.docs.values()].filter((v: any) => v.kind === 'gateway_rejection')).toHaveLength(0);
  });
  it.each(['before-issue', 'after-claim'] as const)('rejects changed credential generation %s without changing quota ownership', async when => {
    const f = fixture();
    if (when === 'before-issue') vi.stubEnv('INFERENCE_GATEWAY_TEST_CREDENTIAL', 'rotated-secret');
    else { const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
      vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
        const result = await authorize.call(this, claim); vi.stubEnv('INFERENCE_GATEWAY_TEST_CREDENTIAL', 'rotated-secret'); return result;
      });
    }
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    const attempts = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    if (when === 'after-claim') { expect(attempts).toHaveLength(1); expect(attempts[0].phase).toBe('pending'); expect(attempts[0].heldQuota[0].amount).toBeGreaterThan(0); }
    else expect(attempts).toHaveLength(0);
  });
  it.each([0.01, '0.01'])('persistently quarantines a reported free cost %j without settling or billing guesses', async cost => {
    const f = fixture(); network.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'do not expose' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, cost } })));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any; expect(attempt.phase).toBe('pending');
    expect([...f.docs.values()].filter((v: any) => v.kind === 'gateway_usage')).toHaveLength(0);
    expect([...f.docs.values()].find((v: any) => v.kind === 'gateway_transport_incident')).toMatchObject({ anomaly: 'free-cost-contradiction', unresolved: true });
    for (const hold of attempt.heldQuota) expect(f.docs.get(gatewayLedgerPath('quota-state', hold.ledgerKey))).toMatchObject({ held: hold.amount, quarantined: true });
    // Each run constructs fresh runtime issuer/ledger state, as after a process restart.
    network.mockResolvedValue(response()); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
  });
  it.each(['same-alias', 'different-model', 'missing-identity', 'unknown-primary'] as const)('enforces reviewed independent-audit model identity: %s', async scenario => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    const target = paid.catalog.profiles[0];
    if (scenario === 'same-alias') target.canonicalModelId = free.catalog.profiles[0].canonicalModelId;
    if (scenario === 'missing-identity') delete target.canonicalModelId;
    free.catalog.profiles.push(target); mocks.db = free.db; network.mockResolvedValue(response(true));
    const c = context({ excludedModelIds: [scenario === 'unknown-primary' ? 'unknown-model' : 'glm-4.7-flash'] });
    if (scenario === 'different-model') { expect(await run(c)).toMatchObject({ provider: 'DEEPSEEK', ok: true }); expect(network).toHaveBeenCalledOnce(); }
    else { await expect(run(c)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled(); }
  });
  it('copies audit exclusions and prevents descendants from removing them', async () => {
    fixture(); const excluded = ['glm-4.7-flash']; const outer = context({ excludedModelIds: excluded });
    await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(outer, () => {
      excluded.length = 0; expect(currentInferenceGatewayContext()?.excludedModelIds).toEqual(['glm-4.7-flash']);
      return runWithInferenceGatewayContext({ ...outer, excludedModelIds: [] }, () => maybeGatewayText({ prompt: 'Hello' }));
    }))).rejects.toMatchObject({ reason: 'context-unverified' }); expect(network).not.toHaveBeenCalled();
  });
  it('persists a late-stream billing anomaly even when cancellation occurs during cleanup', async () => {
    const f = fixture(); const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: 'stop' }] }) + '\n\n'
        + 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, cost: '0.01' } }) + '\n\n'));
    }, cancel() { controller.abort(); return new Promise(() => {}); } });
    network.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const result = await runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context({ signal: controller.signal }), () => maybeGatewayText({ prompt: 'Hello', onChunk: () => {} })));
    expect(result).toMatchObject({ reason: 'stalled', content: 'partial' });
    expect([...f.docs.values()].find((v: any) => v.kind === 'gateway_transport_incident')).toMatchObject({ unresolved: true });
    network.mockResolvedValue(response()); await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
  });
  it('rejects model-only quotas that bind no actual account allowance', async () => {
    const f = fixture(); const oldDimensions = f.catalog.profiles[0].profile.quotaDimensions;
    const modelDimensions = oldDimensions.map(d => ({ ...d, scope: { ...d.scope, kind: 'model' as const } }));
    for (let i = 0; i < oldDimensions.length; i++) {
      const oldKey = quotaLedgerKey(oldDimensions[i]); const newKey = quotaLedgerKey(modelDimensions[i]);
      const policy = f.docs.get(gatewayLedgerPath('quota-policy', oldKey)) as any;
      const state = f.docs.get(gatewayLedgerPath('quota-state', oldKey)) as any;
      const period = f.docs.get(gatewayLedgerPath('quota-period', evidenceBinding([oldKey, policy.window.id]))) as any;
      const rule = { ...(f.docs.get(gatewayQuotaRulePath(oldKey)) as object), ledgerKey: newKey, dimension: modelDimensions[i], overlappingDimensions: modelDimensions };
      f.docs.set(gatewayQuotaRulePath(newKey), rule);
      f.docs.set(gatewayLedgerPath('quota-policy', newKey), { ...policy, ledgerKey: newKey, rolloverRule: { revision: 1, binding: evidenceBinding(rule) } });
      f.docs.set(gatewayLedgerPath('quota-state', newKey), { ...state, ledgerKey: newKey });
      f.docs.set(gatewayLedgerPath('quota-period', evidenceBinding([newKey, policy.window.id])), { ...period, ledgerKey: newKey });
    }
    f.catalog.profiles[0].profile = { ...f.catalog.profiles[0].profile, quotaDimensions: modelDimensions };
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    expect([...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt')).toHaveLength(0);
  });
  it('publishes a lowered deployment cap through the existing shared authority even on a free turn', async () => {
    const f = fixture(); f.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10_000_000_000, updatedAt: Date.now() - 1, source: 'admin' });
    vi.stubEnv('FREE_CHAIN_PAID_DAILY_CAP_USD', '0'); expect(await run()).toMatchObject({ ok: true });
    expect(f.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ capNanoUsd: 0, revision: 2, source: 'deployment' });
    expect(await new FreeChainStore(f.db).observePaidBudgetPolicy(10_000_000_000)).toMatchObject({ capNanoUsd: 0 });
  });
  it('cannot spend from a stale higher shared cap after deployment sets zero', async () => {
    const f = fixture(true); vi.stubEnv('FREE_CHAIN_PAID_DAILY_CAP_USD', '0');
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
    expect(f.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ capNanoUsd: 0 });
  });
  it('does not recreate missing shared policy during require-existing observation', async () => {
    const f = fixture(); await expect(new FreeChainStore(f.db).observePaidBudgetPolicy(10_000_000_000, Date.now(), true)).rejects.toThrow('Shared budget authority absent');
    expect(f.docs.has('free_chat_chain/paid_budget_policy')).toBe(false);
  });
  it('advances free → next eligible free → paid with separate retained rejection holds', async () => {
    const first = fixture(); const next = fixture(false, 'GROQ'); const paid = fixture(true);
    next.catalog.profiles[0].profile = { ...next.catalog.profiles[0].profile, id: 'next-free-profile' };
    next.catalog.profiles[0].availability.predictedFirstOutputMs = 20;
    paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const f of [next, paid]) { for (const [key, value] of f.docs) if (key !== GATEWAY_CATALOG_PATH) first.docs.set(key, value); first.catalog.profiles.push(f.catalog.profiles[0]); }
    mocks.db = first.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 })).mockResolvedValueOnce(response(true));
    expect(await run()).toMatchObject({ provider: 'DEEPSEEK', ok: true }); expect(network).toHaveBeenCalledTimes(3);
    const attempts = [...first.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    expect(attempts.map(a => a.claim.binding.providerId)).toEqual(['GLM', 'GROQ', 'DEEPSEEK']);
    for (const attempt of attempts.slice(0, 2)) { expect(attempt.retryRejection).toMatchObject({ status: 429 });
      for (const hold of attempt.heldQuota) expect(first.docs.get(gatewayLedgerPath('quota-state', hold.ledgerKey))).toMatchObject({ held: hold.amount }); }
  });
  it('quarantines a cost-bearing HTTP429 rather than hopping to available paid capacity', async () => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    free.catalog.profiles.push(paid.catalog.profiles[0]); mocks.db = free.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' }, usage: { cost: '0.01' } }), { status: 429 })).mockResolvedValueOnce(response(true));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
    expect([...free.docs.values()].find((v: any) => v.kind === 'gateway_transport_incident')).toMatchObject({ unresolved: true });
    expect([...free.docs.values()].filter((v: any) => v.kind === 'gateway_rejection')).toHaveLength(0);
    expect(free.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ capNanoUsd: 0, source: 'safety' });
    network.mockClear().mockResolvedValue(response(true));
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['missing', 'expired', 'automatic-overage'] as const)('blocks unknown upstream quota without reviewed hard free protection: %s', async unsafe => {
    const f = fixture(); const entry = f.catalog.profiles[0];
    if (unsafe === 'missing') delete entry.freeBillingSafety;
    else if (unsafe === 'expired') entry.freeBillingSafety!.expiresAtMs = Date.now() - 1;
    else entry.freeBillingSafety = { ...entry.freeBillingSafety!, kind: 'automatic-overage' as any };
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('allows shared unknown upstream remaining only as reviewed local capacity with a hard free stop', async () => {
    const f = fixture(); f.catalog.profiles[0].freeBillingSafety!.kind = 'provider-hard-stop';
    expect(await run()).toMatchObject({ ok: true });
    const review = f.docs.get(gatewayAccountFencePath('glm', ['reviewed-account-one'])); expect(review).toMatchObject({ upstreamQuota: 'unknown', authority: 'gateway-local-capacity' });
  });
  it('does not associate a rotated key with a reviewed account merely because its env name matches', async () => {
    const f = fixture(); f.catalog.profiles[0].accountCredentialBinding = gatewayTextCredentialBinding('another-secret');
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('runs the real reviewed rollover on the first request after reset and preserves old uncertain holds', async () => {
    const start = Date.parse('2026-10-23T12:00:00Z'); let now = start; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture(false, 'GLM', 2000); const dimension = f.catalog.profiles[0].profile.quotaDimensions[0]; const key = quotaLedgerKey(dimension);
    const oldPolicy = f.docs.get(gatewayLedgerPath('quota-policy', key)) as any;
    f.docs.set(gatewayLedgerPath('quota-state', key), { ...(f.docs.get(gatewayLedgerPath('quota-state', key)) as object), held: 10 });
    await maintainGatewayQuotaWindows(f.db); now += 1200;
    expect(await run()).toMatchObject({ ok: true }); expect(network).toHaveBeenCalledOnce();
    const policy = f.docs.get(gatewayLedgerPath('quota-policy', key)) as any;
    expect(policy.revision).toBe(2); expect(policy.window.startsAtMs).toBe(start + 1000);
    expect(f.docs.get(gatewayLedgerPath('quota-state', key))).toMatchObject({ held: 10 });
    expect(f.docs.get(gatewayLedgerPath('quota-period', evidenceBinding([key, oldPolicy.window.id])))).toMatchObject({ spent: 5 });
    expect(f.docs.get(gatewayLedgerPath('quota-period', evidenceBinding([key, policy.window.id])))).toMatchObject({ spent: 1, baseline: 'local-zero' });
  });
  it('coalesces maintenance observations without caching a dispatch authorization, and remains OFF inert', async () => {
    const f = fixture(); const doc = vi.spyOn(f.db, 'doc');
    await Promise.all(Array.from({ length: 20 }, () => maintainGatewayQuotaWindows(f.db)));
    expect(doc.mock.calls.filter(call => call[0] === GATEWAY_CATALOG_PATH)).toHaveLength(1); expect(network).not.toHaveBeenCalled();
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); doc.mockClear(); expect(await maintainGatewayQuotaWindows(f.db)).toMatchObject({ inspected: 0 }); expect(doc).not.toHaveBeenCalled();
  });
  it.each(['missing', 'expired', 'rolling'] as const)('does not dispatch using a seeded period when recurring quota review is %s', async kind => {
    const f = fixture(); const d = f.catalog.profiles[0].profile.quotaDimensions[0]; const key = quotaLedgerKey(d); const path = gatewayQuotaRulePath(key);
    if (kind === 'missing') f.docs.delete(path);
    else { const rule = { ...(f.docs.get(path) as any), ...(kind === 'expired' ? { expiresAtMs: Date.now() - 1 } : { reset: { kind: 'authoritative-import', semantics: 'rolling' } }) };
      f.docs.set(path, rule); f.docs.set(gatewayLedgerPath('quota-policy', key), { ...(f.docs.get(gatewayLedgerPath('quota-policy', key)) as object), rolloverRule: { revision: 1, binding: evidenceBinding(rule) } }); }
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('rechecks exact rule revocation after claim before the final physical boundary', async () => {
    const f = fixture(); const authorize = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementation(async function (claim) {
      const path = gatewayQuotaRulePath(claim.binding.quota[0].ledgerKey); f.docs.set(path, { ...(f.docs.get(path) as object), revision: 2 });
      return authorize.call(this, claim);
    });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('does not retry a forged error object that merely claims HTTP429', async () => {
    fixture(); network.mockRejectedValue({ status: 429, code: 'RATE_LIMIT' });
    await expect(run()).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).toHaveBeenCalledOnce();
  });
  it('uses freshly read evidence after a definite pre-dispatch reservation denial', async () => {
    const free = fixture(); const paid = fixture(true); paid.catalog.profiles[0].profile = { ...paid.catalog.profiles[0].profile, id: 'paid-profile' };
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) free.docs.set(key, value);
    free.catalog.profiles.push(paid.catalog.profiles[0]); mocks.db = free.db;
    const reserve = FirestoreInferenceLedger.prototype.reserve;
    vi.spyOn(FirestoreInferenceLedger.prototype, 'reserve').mockImplementationOnce(async function () {
      const key = gatewayLedgerPath('quota-policy', quotaLedgerKey(free.catalog.profiles[0].profile.quotaDimensions[0]));
      free.docs.set(key, { ...(free.docs.get(key) as object), limit: 0 }); return { kind: 'denied' };
    }).mockImplementation(reserve);
    network.mockResolvedValue(response(true)); expect(await run()).toMatchObject({ ok: true, provider: 'DEEPSEEK' }); expect(network).toHaveBeenCalledOnce();
  });
  it('keeps the external context descriptive only', () => {
    const c = context(); runWithInferenceGatewayContext(c, () => expect(currentInferenceGatewayContext()).toMatchObject(c)); expect(currentInferenceGatewayContext()).toBeUndefined();
  });
});


function operationFixture(kind: 'embedding' | 'grounding-search' | 'vision-pdf', pdf = false) {
  const f = fixture(kind !== 'vision-pdf' || pdf); const now = Date.now(); const entry = f.catalog.profiles[0];
  const oldPolicy = f.catalog.policies['chat:text']; const provider = kind === 'embedding' ? 'VERTEX' : kind === 'grounding-search' ? 'BRAVE' : pdf ? 'GEMINI' : 'GLM';
  const model = kind === 'embedding' ? 'text-embedding-004' : kind === 'grounding-search' ? 'brave-search-v1' : pdf ? 'gemini-2.5-flash' : 'glm-4.6v-flash';
  const suffix = kind === 'grounding-search' ? 'grounding' : kind === 'vision-pdf' ? (pdf ? 'vision-pdf' : 'vision-image') : kind;
  const region = kind === 'embedding' ? 'us-central1' : 'reviewed-region';
  const policy = { ...oldPolicy, privacy: { ...oldPolicy.privacy, allowedProcessingRegions: [region] },
    maxInputTokens: kind === 'embedding' ? 2048 : kind === 'grounding-search' ? 1 : pdf ? 1048576 : 4096,
    ...(pdf ? { logicalLimitNanoUsd: 400000000 } : {}),
    maxOutputTokens: kind === 'vision-pdf' ? 512 : 1,
    operation: kind === 'embedding' ? { kind, maxInputBytes: 8192, dimensions: 768 as const, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE }
      : kind === 'grounding-search' ? { kind, maxQueryBytes: 4000, maxResults: 5 }
      : { kind, maxImages: 1, maxPdfPages: pdf ? 1000 as const : 0 as const, formats: pdf ? ['application/pdf' as const] : ['image/png' as const], maxAttachmentBytes: 5000000 } };
  f.catalog.policies['chat:text:' + suffix] = policy;
  const dimensions = [{ scope: { providerId: provider, kind: kind === 'embedding' ? 'project' as const : 'account' as const,
    id: kind === 'embedding' ? 'my-project' : 'reviewed-account-one' }, meter: 'requests/day' }];
  if (kind !== 'grounding-search') dimensions.push({ ...dimensions[0], meter: 'tokens/minute' });
  entry.profile = { ...entry.profile, providerId: provider, modelId: model,
    adapterId: kind === 'embedding' ? 'gateway-vertex-embedding-v1' : kind === 'grounding-search' ? 'gateway-brave-search-v1' : 'gateway-vision-v1',
    capabilities: kind === 'embedding' ? [{ kind, maxInputTokens: 2048, dimensions: 768, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE }]
      : kind === 'grounding-search' ? [{ kind, maxQueries: 1, maxResults: 5, citations: true, domainFiltering: false }]
      : [{ kind, maxInputTokens: policy.maxInputTokens, maxOutputTokens: 512, maxContextTokens: policy.maxInputTokens + 512, streaming: false, systemPrompt: true, formats: pdf ? ['application/pdf'] : ['image/png'], maxImages: 1, maxPdfPages: pdf ? 1000 : 0 }],
    privacy: { ...entry.profile.privacy, processingRegions: [region] }, quotaDimensions: dimensions };
  const credential = { credentialEnv: 'INFERENCE_GATEWAY_TEST_CREDENTIAL', credentialBinding: gatewayTextCredentialBinding('synthetic-secret-never-live') };
  entry.transport = kind === 'embedding' ? { kind, provider, model, project: 'my-project', location: 'us-central1',
    credentialPrincipal: 'runtime@my-project.iam.gserviceaccount.com', vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE,
    maxInputBytes: 8192, timeoutMs: 30000, rateCard: { version: 'aux-rate', maxNanoUsdPerCharacter: 25, verifiedAtMs: now - 100, expiresAtMs: now + 60000 } }
    : kind === 'grounding-search' ? { kind, provider, model, ...credential, baseURL: 'https://api.search.brave.com/res/v1/web/search',
      timeoutMs: 30000, maxQueryBytes: 4000, maxResults: 5, rateCard: { version: 'aux-rate', requestNanoUsd: 5000000, verifiedAtMs: now - 100, expiresAtMs: now + 60000 } }
    : { kind, provider, model, ...credential, timeoutMs: 60000, maxOutputTokens: 512, maxImages: 1, maxImageBytes: 5000000,
      maxTotalBytes: 5000000, maxDimension: 6000, maxPixels: 36000000, ...(pdf ? { rateCard: { version: 'aux-rate', inputNanoUsdPerMillion: 300000000, outputNanoUsdPerMillion: 2500000000, verifiedAtMs: now - 100, expiresAtMs: now + 60000 } } : {}) } as any;
  entry.legacyProvider = provider.toLowerCase();
  if (entry.transport.kind === 'embedding') entry.accountCredentialBinding = gatewayEmbeddingCredentialBinding({ project: entry.transport.project, credentialPrincipal: entry.transport.credentialPrincipal });
  const path = gatewayAccountFencePath(entry.legacyProvider, [dimensions[0].scope.id]);
  const account = { kind: 'gateway_account_owner', version: 2, provider: entry.legacyProvider, migrationId: entry.migrationId,
    authority: 'gateway-local-capacity', accountScopeIds: [dimensions[0].scope.id], accountReviewRef: 'aux-account-review', upstreamQuota: 'unknown',
    credentialBindings: [entry.accountCredentialBinding], reviewedAtMs: now - 100, expiresAtMs: now + 60000 };
  f.docs.set(path, account);
  for (const dimension of dimensions) {
    const key = quotaLedgerKey(dimension); const rule: GatewayQuotaRule = { kind: 'gateway_quota_rule', version: 1, ledgerKey: key, revision: 1,
      dimension, overlappingDimensions: dimensions, migrationId: entry.migrationId, limit: dimension.meter.startsWith('tokens') ? 2000000 : 100,
      reviewRef: 'aux-local-review', reviewedAtMs: now - 100, expiresAtMs: now + 60000,
      reset: { kind: 'fixed-interval', anchorAtMs: now - 1000, intervalMs: 61000 }, accounting: 'local-only',
      accountPolicyPath: path, accountPolicyBinding: evidenceBinding(account), zeroBaseline: { kind: 'local-reservation-window', evidenceRef: 'aux-local-window' } };
    const window = gatewayQuotaWindow(rule, now)!;
    f.docs.set(gatewayQuotaRulePath(key), rule);
    f.docs.set(gatewayLedgerPath('quota-policy', key), { kind: 'gateway_quota_policy', version: 1, ledgerKey: key, revision: 1,
      authority: 'gateway-local-capacity', accountingBasis: 'gateway-local-only', migrationId: entry.migrationId, limit: rule.limit, window,
      rolloverRule: { revision: 1, binding: evidenceBinding(rule) } });
    f.docs.set(gatewayLedgerPath('quota-state', key), { kind: 'gateway_quota_state', version: 1, ledgerKey: key, migrationId: entry.migrationId, held: 0, quarantined: false });
    f.docs.set(gatewayLedgerPath('quota-period', evidenceBinding([key, window.id])), { kind: 'gateway_quota_period', version: 1, ledgerKey: key, window, spent: 0 });
  }
  return f;
}
function imagePayload() {
  const bytes = Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR',12); bytes.writeUInt32BE(1,16); bytes.writeUInt32BE(1,20);
  return { kind: 'vision-pdf' as const, prompt: 'Describe', attachments: [{ mimeType: 'image/png' as const, data: bytes.toString('base64') }], streaming: false as const };
}
const runOperation = (kind: 'embedding' | 'grounding-search' | 'vision-pdf', c = context()) => runWithAuthenticatedInferenceGatewayRequest(req,
  () => runWithInferenceGatewayContext(c, () => kind === 'embedding' ? maybeGatewayEmbedding('Hello')
    : kind === 'grounding-search' ? maybeGatewayGrounding('current fact', { maxResults: 5 }) : maybeGatewayVision(imagePayload())));
describe('real shared capability composition', () => {
  it('executes reviewed Gemini PDF with the full input ceiling plus separate output bound in the same ledger', async () => {
    const f = operationFixture('vision-pdf', true);
    network.mockResolvedValue(new Response(JSON.stringify({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'PDF answer' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 0, totalTokenCount: 120 } }), { headers: { 'content-type': 'application/json' } }));
    const result = await runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(), () => maybeGatewayVision({ kind: 'vision-pdf',
      prompt: 'Summarize', attachments: [{ mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7\nSynthetic offline PDF\n%%EOF').toString('base64') }], streaming: false })));
    expect(result).toMatchObject({ ok: true, provider: 'GEMINI', content: 'PDF answer' }); expect(network).toHaveBeenCalledOnce();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any;
    expect(attempt).toMatchObject({ phase: 'settled', claim: { binding: { budget: { amountNanoUsd: 315852800 } } },
      intent: { request: { capability: { inputTokens: 1048576, outputTokens: 512, pdfPages: 1000 } } } });
    const day = civilDayWindow(Date.now(), 'Asia/Kolkata');
    expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ heldNanoUsd: 0, pending: 0, conservativePending: 1, spentNanoUsd: 80000 });
  });

  it.each(['embedding', 'vision-pdf'] as const)('persists a genuine coordinator %s first-output timeout without treating client abort as proof', async kind => {
    const f = operationFixture(kind); f.catalog.policies[kind === 'embedding' ? 'chat:text:embedding' : 'chat:text:vision-image'].firstOutputTimeoutMs = 10;
    network.mockImplementation(() => new Promise(() => {}));
    await expect(runOperation(kind)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    await vi.waitFor(() => expect(f.docs.get(gatewayAccountCooldownPath(kind === 'embedding' ? 'vertex' : 'glm', [kind === 'embedding' ? 'my-project' : 'reviewed-account-one']))).toMatchObject({ reason: 'transient' }));
    expect(network).toHaveBeenCalledOnce();
  });
  it.each(['image-first', 'pdf-first'])('keeps separate image and PDF input ceilings when both reviewed profiles coexist: %s', async order => {
    const images = operationFixture('vision-pdf'); const pdf = operationFixture('vision-pdf', true);
    for (const [key, value] of pdf.docs) if (key !== GATEWAY_CATALOG_PATH) images.docs.set(key, value);
    Object.assign(images.catalog.policies, pdf.catalog.policies); pdf.catalog.profiles[0].profile = { ...pdf.catalog.profiles[0].profile, id: 'pdf-profile' };
    images.catalog.profiles = order === 'image-first' ? [...images.catalog.profiles, ...pdf.catalog.profiles] : [...pdf.catalog.profiles, ...images.catalog.profiles]; mocks.db = images.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ model: 'glm-4.6v-flash', choices: [{ message: { content: 'Image' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'PDF' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } })));
    expect(await runOperation('vision-pdf')).toMatchObject({ provider: 'GLM' });
    expect(await runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(), () => maybeGatewayVision({ kind: 'vision-pdf', prompt: 'Summarize', attachments: [{ mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') }], streaming: false })))).toMatchObject({ provider: 'GEMINI' });
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('replans rejected GLM images to Gemini with independent full-context money and quota holds', async () => {
    const images = operationFixture('vision-pdf'); const paid = operationFixture('vision-pdf', true);
    for (const [key, value] of paid.docs) if (key !== GATEWAY_CATALOG_PATH) images.docs.set(key, value);
    const entry = paid.catalog.profiles[0]; entry.profile.id = 'paid-image-profile';
    const capacity = entry.profile.capabilities[0]; if (capacity.kind !== 'vision-pdf') throw new Error('fixture');
    capacity.formats = ['image/png']; capacity.maxPdfPages = 0;
    images.catalog.profiles.push(entry); images.catalog.policies['chat:text:vision-image'].logicalLimitNanoUsd = 400000000; mocks.db = images.db;
    network.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'Reviewed paid image answer' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } })));
    expect(await runOperation('vision-pdf')).toMatchObject({ ok: true, provider: 'GEMINI', content: 'Reviewed paid image answer' });
    expect(network).toHaveBeenCalledTimes(2);
    const attempts = [...images.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    const gemini = attempts.find(a => a.intent.candidate.profile.providerId === 'GEMINI');
    expect(gemini.claim.binding.budget.amountNanoUsd).toBe(315852800);
    expect(gemini.claim.binding.quota.find((q: any) => q.amount === 1049088)).toBeTruthy();
    expect(gemini.intent.request.capability.inputTokens).toBe(4096);
    expect(attempts.find(a => a.intent.candidate.profile.providerId === 'GLM')).toMatchObject({ phase: 'pending' });
  });
  it.each(['strict-free', 'shared-cap-zero'] as const)('blocks reviewed paid PDF before network when %s', async blocked => {
    const f = operationFixture('vision-pdf', true);
    if (blocked === 'shared-cap-zero') f.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 2, capNanoUsd: 0, updatedAt: Date.now(), source: 'safety' });
    await expect(runWithAuthenticatedInferenceGatewayRequest(req, () => runWithInferenceGatewayContext(context(blocked === 'strict-free' ? { mode: 'strict-free' } : {}),
      () => maybeGatewayVision({ kind: 'vision-pdf', prompt: 'Summarize', attachments: [{ mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') }], streaming: false })))).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['embedding', 'grounding-search', 'vision-pdf'] as const)('dispatches reviewed %s through the real shared issuer/ledger, not legacy', async kind => {
    const f = operationFixture(kind);
    network.mockResolvedValue(new Response(JSON.stringify(kind === 'embedding'
      ? { predictions: [{ embeddings: { values: Array(768).fill(0.1), statistics: { token_count: 2, truncated: false } } }] }
      : kind === 'grounding-search' ? { web: { results: [{ title: 'Current fact', url: 'https://example.com/source', description: 'Evidence' }] } }
      : { model: 'glm-4.6v-flash', choices: [{ message: { content: 'An image' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { headers: { 'content-type': 'application/json' } }));
    const result = await runOperation(kind); expect(result).toBeTruthy(); expect(network).toHaveBeenCalledOnce();
    const attempts = [...f.docs.values()].filter((v: any) => v.kind === 'gateway_attempt') as any[];
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ phase: 'settled', intent: { request: { capability: { kind }, privacy: { dataClass: 'health' }, quality: { tier: 'clinical' } } } });
    if (kind !== 'grounding-search') {
      const tokenHold = attempts[0].heldQuota.find((h: any) => h.amount > 1);
      expect(tokenHold?.amount).toBe(kind === 'embedding' ? 2048 : 4608);
      expect(f.docs.get(gatewayLedgerPath('quota-state', tokenHold.ledgerKey))).toMatchObject({ held: 0 });
      expect(f.docs.get(gatewayLedgerPath('quota-period', evidenceBinding([tokenHold.ledgerKey, tokenHold.window.id])))).toMatchObject({ spent: kind === 'embedding' ? 2 : 12 });
    }
    if (kind !== 'vision-pdf') {
      const day = civilDayWindow(Date.now(), 'Asia/Kolkata');
      expect(f.docs.get(`free_chat_chain/paid_day_${day.key}`)).toMatchObject({ heldNanoUsd: 0, pending: 0, conservativePending: 1,
        spentNanoUsd: kind === 'embedding' ? 125 : 5000000 });
    }
  });
  it.each(['embedding', 'grounding-search', 'vision-pdf'] as const)('does not infer %s authority from an existing reviewed text policy', async kind => {
    fixture(); await expect(runOperation(kind)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['embedding', 'grounding-search'] as const)('strict-free never dispatches paid %s or creates a separate allowance', async kind => {
    const f = operationFixture(kind); await expect(runOperation(kind, context({ mode: 'strict-free' }))).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(network).not.toHaveBeenCalled(); expect([...f.docs.keys()].filter(k => k.includes('paid_day_'))).toHaveLength(0);
  });
  it.each(['embedding', 'grounding-search'] as const)('honors shared cap exhaustion before %s dispatch', async kind => {
    const f = operationFixture(kind); f.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 2, capNanoUsd: 0, updatedAt: Date.now(), source: 'safety' });
    await expect(runOperation(kind)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
  it('keeps all auxiliary methods genuinely OFF without authentication or datastore', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
    expect(await maybeGatewayEmbedding('Hello')).toBeNull(); expect(await maybeGatewayGrounding('fact', { maxResults: 5 })).toBeNull();
    expect(await maybeGatewayVision(imagePayload())).toBeNull(); expect(network).not.toHaveBeenCalled();
  });
});


describe('private public-Free guest admission in the real runtime', () => {
  const principalId = 'nb-free-guest:11111111-1111-4111-8111-111111111111';
  async function admitted() {
    const request = mockReq({ headers: { 'x-nb-guest': 'offline-device-123456', 'x-user-id': 'forged-account' }, body: { uid: 'forged-account' } });
    const res = mockRes(); const next = vi.fn();
    await guestDailyQuota('chat', { identify: async () => null, store: { consume: async () => ({ allow: true, remaining: 9, durablePrincipalId: principalId }) } })(request, res, next);
    expect(next).toHaveBeenCalledOnce(); mocks.verify.mockResolvedValue(null); return { request, res };
  }
  async function guestRun(request: Request, overrides: Partial<InferenceGatewayContext> = {}) {
    return await runWithAuthenticatedInferenceGatewayRequest(request, (uid, guest) => {
      expect(uid).toBeNull();
      return runWithInferenceGatewayContext(context({ principalId: guest?.principalId ?? principalId, tenantId: guest?.principalId ?? principalId,
        deadlineAtMs: Math.min(Date.now() + 90000, guest?.expiresAtMs ?? Date.now() + 90000), ...overrides }), () => maybeGatewayText({ prompt: 'Hello' }));
    });
  }
  it.each([false, true])('uses a live scoped receipt for a %s paid fallback without turning it into an account UID', async paid => {
    const f = fixture(paid); const { request } = await admitted(); network.mockResolvedValue(response(paid));
    expect(await guestRun(request)).toMatchObject({ ok: true }); expect(network).toHaveBeenCalledOnce();
    const attempt = [...f.docs.values()].find((v: any) => v.kind === 'gateway_attempt') as any;
    expect(attempt.claim.binding.key).toMatchObject({ principalId, tenantId: principalId });
    expect(attempt.intent.request.payer).toEqual({ kind: 'platform', ownerId: 'reviewed-owner' });
  });
  it.each([{ tenantId: 'another-account' }, { surface: 'professional' }, { funding: 'existing-professional' }, { policyKey: 'professional:any' }, { principalId: 'verified-user' }] as Partial<InferenceGatewayContext>[])
    ('never gives guest admission private account/surface/funding authority: %j', async override => {
      fixture(); const { request } = await admitted(); await expect(guestRun(request, override)).rejects.toMatchObject({ reason: 'context-unverified' }); expect(network).not.toHaveBeenCalled();
    });
  it('will not accept a copied request, reuse the receipt, or outlive its deadline', async () => {
    fixture(); const { request } = await admitted();
    await expect(guestRun({ ...request } as Request)).rejects.toMatchObject({ reason: 'context-unverified' });
    expect(await guestRun(request)).toMatchObject({ ok: true });
    await expect(guestRun(request)).rejects.toMatchObject({ reason: 'context-unverified' }); expect(network).toHaveBeenCalledOnce();
    const second = await admitted(); await expect(guestRun(second.request, { deadlineAtMs: Date.now() + 200000 })).rejects.toMatchObject({ reason: 'context-unverified' });
  });
  it('a genuine public guest receipt cannot authorize private account data access', async () => {
    fixture(); const { request } = await admitted();
    await runWithAuthenticatedInferenceGatewayRequest(request, (_uid, guest) => runWithInferenceGatewayContext(context({ principalId, tenantId: principalId,
      deadlineAtMs: Math.min(Date.now() + 90000, guest!.expiresAtMs) }), () => {
      expect(() => assertGatewayAccountAccess(principalId)).toThrow(); expect(() => assertGatewayAccountAccess('victim-account')).toThrow();
    }));
    expect(network).not.toHaveBeenCalled();
  });
  it('pins an admitted guest request selected when rollout turns OFF before route entry', async () => {
    fixture(); const { request } = await admitted(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
    await expect(guestRun(request)).rejects.toMatchObject({ reason: 'disabled-after-selection' }); expect(network).not.toHaveBeenCalled();
  });
  it('rechecks receipt revocation after asynchronous final claim authorization before physical fetch', async () => {
    fixture(); const { request, res } = await admitted(); const original = GatewayAuthorityStore.prototype.authorizeClaim;
    vi.spyOn(GatewayAuthorityStore.prototype, 'authorizeClaim').mockImplementationOnce(async function(claim) { const result = await original.call(this, claim); res.emit('close'); return result; });
    await expect(guestRun(request)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' }); expect(network).not.toHaveBeenCalled();
  });
});
