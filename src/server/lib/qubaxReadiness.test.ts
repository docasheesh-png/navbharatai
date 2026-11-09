import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
const fake = vi.hoisted(() => ({ db: vi.fn(), maintenance: vi.fn(), policy: vi.fn(), observe: vi.fn(), unsubscribe: vi.fn(), observeUnavailable: vi.fn(), unsubscribeUnavailable: vi.fn(), config: vi.fn() }));
vi.mock('./serverDb', () => ({ getServerDb: fake.db }));
vi.mock('./aiMaintenance', () => ({ MAINTENANCE_COLLECTION: 'platform_settings', MAINTENANCE_DOCUMENT: 'ai_maintenance',
  aiMaintenanceStore: { start: () => {}, read: async () => (await fake.maintenance()) ?? { enabled: false },
    onChange: (listener: unknown) => { fake.observe(listener); return () => fake.unsubscribe(); },
    onUnavailable: (listener: unknown) => { fake.observeUnavailable(listener); return () => fake.unsubscribeUnavailable(); } } }));
vi.mock('../AI/inferencePolicy', () => ({ assertLegacyInferenceAllowed: fake.policy }));
vi.mock('../AI/FreeChain/config', () => ({ freeChainConfig: fake.config }));
vi.mock('../AI/FreeChain/masterPlan', () => ({ monthKey: () => '2027-01' }));
import { checkTestChatReadiness, importTestChatApproval, importTestChatCatalog, qubaxCatalogDigest } from './qubaxReadiness';
import { canonicalQubaxReview, QUBAX_CATALOG_SIGNATURE_DOMAIN, QUBAX_REVIEW_SIGNATURE_DOMAIN, qubaxReviewerKeys, verifyQubaxReview } from './qubaxReviewSignature';
import { qubaxChatBinding, qubaxWireBody, qubaxWorkload, runApprovedQubaxChat } from './qubax';
import { inspectQubaxCatalog, selectQubaxCandidate, type QubaxCatalog } from './qubaxSelector';
import { createTestChatPolicyFence, assertTestChatMaintenanceAtClaim } from './testChatPolicyFence';
import { testChatPayload, testChatRequestId, testChatUid } from './testChatPayload';
import { civilDayWindow } from '../AI/FreeChain/quota';
import { isTestChatReadiness, TEST_CHAT_SYNTHETIC_PROMPT, type TestChatAction, type TestChatApprovalImport } from '../../lib/testChatBot';

const NOW = 1_800_000_000_000, actor = 'synthetic-requesting-admin';
const key = generateKeyPairSync('ed25519'), otherKey = generateKeyPairSync('ed25519');
const publicKeyPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const roots = [
  { keyId: 'payload-reviewer', reviewerId: 'independent-fixture-reviewer', publicKeyPem, purpose: 'qubax-exact-payload-v1', enabled: true },
  { keyId: 'catalog-reviewer', reviewerId: 'independent-fixture-reviewer', publicKeyPem, purpose: 'qubax-catalog-review-v1', enabled: true },
];
const action: TestChatAction = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35',
  messages: [{ role: 'user', content: TEST_CHAT_SYNTHETIC_PROMPT }], confirmGatewayDisclosure: true };
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function envelope(value: unknown, kind: 'catalog' | 'payload' = 'payload', signingKey = key.privateKey) {
  const payload = canonicalQubaxReview(value), domain = kind === 'catalog' ? QUBAX_CATALOG_SIGNATURE_DOMAIN : QUBAX_REVIEW_SIGNATURE_DOMAIN;
  return { keyId: `${kind}-reviewer`, payload, signature: sign(null, Buffer.from(domain + payload), signingKey).toString('base64url') };
}
function catalog(): QubaxCatalog {
  const evidence = { observedAtMs: NOW - 1000, expiresAtMs: NOW + 299_000, evidenceRef: 'fixture:reviewed-source' };
  const scope = { model: 'fixture-model', revision: 'fixture-revision', sku: 'fixture-sku', tokenizer: 'fixture-tokenizer', contextBand: 'under-8k',
    serviceTier: 'standard', currency: 'USD' as const, billingBasis: 'per-million-tokens' as const, modality: 'text' as const };
  const price = { ...evidence, scope, cacheReadNanoUsdPerMillionTokens: null, cacheWriteNanoUsdPerMillionTokens: null,
    requestFeeNanoUsd: 0, additionalFeesNanoUsd: 0, minimumChargeNanoUsd: 0, allFeesIncluded: true as const, reviewRef: 'fixture:price-review' };
  return { ...evidence, kind: 'qubax-reviewed-chat-catalog-v1', benchmarkRef: 'fixture:benchmark', independentReviewRef: 'fixture:catalog-review', candidates: [{
    modelId: 'fixture-dispatch-model', maxInputTokens: 8000, maxOutputTokens: 4000,
    qubax: { ...price, source: 'qubax', inputNanoUsdPerMillionTokens: 1_000_000, outputNanoUsdPerMillionTokens: 1_000_000 },
    official: { ...price, source: 'official', inputNanoUsdPerMillionTokens: 1_000_000_000, outputNanoUsdPerMillionTokens: 1_000_000_000 },
    supplierContract: { ...evidence, reviewRef: 'fixture:real-supplier-proof-not-production', hardCeilingEnforced: true,
      includesInternalRetriesFailoversAndFees: true, exactModelAndRevisionEnforced: true, perHttpRequestCeilingNanoUsd: 10_000 },
    quality: { policyId: 'qubax-chat-quality-v1', benchmarkRef: 'fixture:benchmark', reviewRef: 'fixture:quality', reviewedAtMs: NOW - 60_000,
      expiresAtMs: NOW + 3600_000, textScoreBps: 8500, hindiScoreBps: 8500, successRateBps: 9950, p95LatencyMs: 1000, sampleCount: 200, approved: true },
  }] };
}
function database() {
  const docs = new Map<string, any>();
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => docs.has(path) ? structuredClone(docs.get(path)) : undefined });
  const get = vi.fn(async (path: string) => snapshot(path));
  const doc = (path: string) => ({ path, get: () => get(path) });
  let queue = Promise.resolve();
  const writes = vi.fn();
  const runTransaction = vi.fn((callback: (tx: any) => Promise<unknown>) => {
    const result = queue.then(async () => {
      const pending: (() => void)[] = [];
      const tx = { get: async (r: { path: string }) => snapshot(r.path),
        create: (r: { path: string }, data: unknown) => { if (docs.has(r.path)) throw new Error('exists'); pending.push(() => { docs.set(r.path, structuredClone(data)); writes(r.path); }); },
        set: (r: { path: string }, data: unknown) => pending.push(() => { docs.set(r.path, structuredClone(data)); writes(r.path); }),
        update: (r: { path: string }, data: unknown) => pending.push(() => { docs.set(r.path, { ...docs.get(r.path), ...data as object }); writes(r.path); }),
      };
      const value = await callback(tx); for (const apply of pending) apply(); return value;
    });
    queue = result.then(() => {}, () => {}); return result;
  });
  return { docs, get, writes, runTransaction, db: { doc, runTransaction } as unknown as Firestore };
}
let f: ReturnType<typeof database>, network: ReturnType<typeof vi.fn>;
const catalogInput = (c: unknown = catalog(), previousCatalogDigest: string | null = null): TestChatApprovalImport => ({ action,
  attestation: envelope({ kind: 'qubax-admin-catalog-review-v1', catalog: c, previousCatalogDigest, reviewedAtMs: NOW, expiresAtMs: NOW + 60_000 }, 'catalog') });
async function prepare() {
  await importTestChatCatalog(catalogInput(), actor);
  return checkTestChatReadiness(action, actor);
}
async function approved() {
  const readiness = await prepare(), r = readiness.reviewRequest!;
  const input: TestChatApprovalImport = { action, attestation: envelope({ kind: 'qubax-admin-review-v1', approvalId: r.approvalId, payloadDigest: r.payloadDigest,
    requestId: r.requestId, model: r.model, modelRevision: r.modelRevision, evidenceBinding: r.evidenceBinding, maximumNanoUsd: r.maximumNanoUsd,
    reviewedAtMs: NOW, expiresAtMs: NOW + 30_000, dataReview: { entirePayloadReviewed: true, gatewayAndAllDownstreamProcessorsReviewed: true,
      approvedDataClasses: ['public'], reviewRef: 'fixture:payload-review', disclosureAuthorityRef: 'fixture:disclosure', processorTermsRef: 'fixture:all-processors', protectionsRef: 'fixture:protections' } }) };
  await importTestChatApproval(input, actor);
  return { input, r };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubEnv('QUBAX_ENABLED', '1'); vi.stubEnv('QUBAX_API_KEY', 'synthetic-never-live-qubax-secret'); vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify(roots));
  f = database(); fake.db.mockReturnValue(f.db); fake.maintenance.mockResolvedValue(undefined);
  fake.config.mockReturnValue({ errors: [], paidCapNanoUsd: 1_000_000, paidPerUserDaily: 10, features: { monthlyCap: true, monthlyCapNanoUsd: 10_000_000 } });
  network = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ model: 'fixture-dispatch-model', choices: [{ index: 0, message: { content: '4' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', network);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Qubax read-only readiness', () => {
  it('identifies missing catalog, credential, disabled provider and unavailable trust without writes or network', async () => {
    vi.stubEnv('QUBAX_ENABLED', '0'); vi.stubEnv('QUBAX_API_KEY', ''); vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', '');
    const result = await checkTestChatReadiness(action, actor);
    expect(result.ready).toBe(false); expect(isTestChatReadiness(result)).toBe(true);
    expect(result.gates.configured.code).toBe('credential-missing'); expect(result.gates.enabled.code).toBe('provider-disabled');
    expect(result.gates.catalog.code).toBe('catalog-missing'); expect(result.gates.reviewerTrust.state).toBe('blocked');
    expect(result.reviewRequest).toBeNull(); expect(f.runTransaction).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'stale', 'pricing', 'quality', 'ceiling', 'unsigned'] as const)('reports %s evidence without manufacturing a selection', async failure => {
    const c = catalog();
    if (failure === 'invalid') (c as any).kind = 'unreviewed';
    if (failure === 'stale') c.expiresAtMs = NOW;
    if (failure === 'pricing') c.candidates[0].qubax.expiresAtMs = NOW;
    if (failure === 'quality') c.candidates[0].quality.approved = false as true;
    if (failure === 'ceiling') c.candidates[0].supplierContract.hardCeilingEnforced = false as true;
    const publication = { actor, attestation: envelope({ kind: 'qubax-admin-catalog-review-v1', catalog: c, previousCatalogDigest: null, reviewedAtMs: NOW, expiresAtMs: NOW + 60_000 }, 'catalog') };
    f.docs.set('qubax_catalog/active', failure === 'unsigned' ? c : { ...c, publication });
    const result = await checkTestChatReadiness(action, actor);
    const expected = { invalid: ['catalog', 'catalog-invalid'], stale: ['catalog', 'catalog-stale'], pricing: ['catalog', 'catalog-pricing-unverified'],
      quality: ['quality', 'quality-unverified'], ceiling: ['supplierCeiling', 'supplier-ceiling-unverified'], unsigned: ['catalog', 'catalog-unsigned'] }[failure];
    expect((result.gates as any)[expected[0]].code).toBe(expected[1]); expect(result.ready).toBe(false); expect(result.reviewRequest).toBeNull();
    expect(network).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
  });
  it('exposes only a bounded exact review package and no credential binding, raw catalog, balance claim or reservation', async () => {
    const result = await prepare(); f.runTransaction.mockClear(); f.writes.mockClear();
    const second = await checkTestChatReadiness(action, actor);
    expect(second.reviewRequest).toMatchObject({ requestId: action.requestId, body: { messages: action.messages, max_tokens: 16, stream: false } });
    expect(second.gates.payloadApproval.code).toBe('payload-approval-missing'); expect(second.gates.budget.state).toBe('pass');
    expect(second.providerBalance).toBe('not-checked'); expect(second.expiresAtMs).toBe(NOW + 60_000);
    expect(second.catalogDigest).toBe(result.catalogDigest); expect(JSON.stringify(second)).not.toMatch(/synthetic-never-live|credentialBinding|supplierContract|fixture:quality/);
    expect(f.runTransaction).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it.each(['daily', 'monthly', 'user', 'duplicate', 'corrupt', 'counter'] as const)('checks actual %s budget authority without reservation', async failure => {
    await prepare(); const window = civilDayWindow(NOW, 'Asia/Kolkata'), uidHash = hash(testChatUid(actor));
    if (failure === 'daily') fake.config.mockReturnValue({ errors: [], paidCapNanoUsd: 0, paidPerUserDaily: 10, features: { monthlyCap: true, monthlyCapNanoUsd: 10_000_000 } });
    if (failure === 'monthly') f.docs.set('free_chat_chain/state/paid_month/2027-01', { heldNanoUsd: 10_000_000, spentNanoUsd: 0 });
    if (failure === 'user') f.docs.set(`free_chat_chain/paid_user_${window.key}_${uidHash}`, { kind: 'paid_user', day: window.key, uidHash, requests: 10 });
    if (failure === 'duplicate') f.docs.set(`free_chat_chain/paid_reservation_${hash(testChatRequestId(action))}`, { anyExistingReservation: true });
    if (failure === 'corrupt') f.docs.set('free_chat_chain/state/paid_month/2027-01', { heldNanoUsd: -1 });
    if (failure === 'counter') f.docs.set(`free_chat_chain/paid_day_${window.key}`, { ...window, version: 1, heldNanoUsd: 0, spentNanoUsd: 0, requests: Number.MAX_SAFE_INTEGER, pending: 0, alertedPercent: [] });
    f.writes.mockClear(); f.runTransaction.mockClear();
    const result = await checkTestChatReadiness(action, actor);
    expect(result.gates.budget.code).toBe({ daily: 'budget-daily', monthly: 'budget-monthly', user: 'budget-user-limit', duplicate: 'request-already-reserved', corrupt: 'storage-unavailable', counter: 'budget-counter-exhausted' }[failure]);
    expect(result.ready).toBe(false); expect(f.writes).not.toHaveBeenCalled(); expect(f.runTransaction).not.toHaveBeenCalled();
  });
  it('fails closed on storage, policy and independently missing catalog-purpose trust', async () => {
    fake.db.mockReturnValueOnce(null); expect((await checkTestChatReadiness(action, actor)).gates.catalog.code).toBe('storage-unavailable');
    fake.policy.mockImplementation(() => { throw new Error('secret-policy-detail'); });
    expect((await checkTestChatReadiness(action, actor)).gates.dispatchPolicy.code).toBe('dispatch-policy-blocked');
    vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[0]]));
    expect((await checkTestChatReadiness(action, actor)).gates.reviewerTrust.message).toContain('catalog-review');
    expect(network).not.toHaveBeenCalled();
  });
});

describe('independent signed catalog publication', () => {
  it('publishes original timestamps once with archived signature and public verification key, never a paid call', async () => {
    const input = catalogInput(); expect(await importTestChatCatalog(input, actor)).toMatchObject({ imported: true, noProviderCall: true });
    expect(f.docs.get('qubax_catalog/active').observedAtMs).toBe(NOW - 1000);
    const receipt = [...f.docs.entries()].find(([p]) => p.startsWith('qubax_review_audit/catalog_'))![1];
    expect(receipt.attestation).toEqual(input.attestation); expect(receipt.signerPublicKeyPem).toBe(publicKeyPem);
    expect(receipt.signerFingerprint).toBe(hash(publicKeyPem)); expect(JSON.stringify(receipt)).not.toContain(TEST_CHAT_SYNTHETIC_PROMPT);
    await expect(importTestChatCatalog(input, actor)).rejects.toMatchObject({ code: 'catalog-conflict' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['unknown-key', 'self-review', 'wrong-purpose', 'signature', 'no-ceiling', 'extra-field', 'bad-second', 'expired', 'overlong', 'duplicate-model'] as const)('rejects %s catalog without publication', async failure => {
    let input = catalogInput(); const c = catalog();
    if (failure === 'unknown-key') input.attestation.keyId = 'untrusted';
    if (failure === 'self-review') vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify(roots.map(r => ({ ...r, reviewerId: actor }))));
    if (failure === 'wrong-purpose') input.attestation.keyId = 'payload-reviewer';
    if (failure === 'signature') input.attestation.signature = sign(null, Buffer.from(QUBAX_CATALOG_SIGNATURE_DOMAIN + input.attestation.payload), otherKey.privateKey).toString('base64url');
    if (failure === 'no-ceiling') { c.candidates[0].supplierContract.hardCeilingEnforced = false as true; input = catalogInput(c); }
    if (failure === 'extra-field') { (c as any).privateMessages = action.messages; input = catalogInput(c); }
    if (failure === 'bad-second') { const bad = structuredClone(c.candidates[0]); bad.modelId = 'second'; (bad.quality as any).reviewRef = { private: 'not-a-reference' }; c.candidates.push(bad); input = catalogInput(c); }
    if (failure === 'duplicate-model') { c.candidates.push(structuredClone(c.candidates[0])); input = catalogInput(c); }
    if (failure === 'expired' || failure === 'overlong') { const payload = JSON.parse(input.attestation.payload); payload.expiresAtMs = failure === 'expired' ? NOW : NOW + 300_001; input.attestation = envelope(payload, 'catalog'); }
    await expect(importTestChatCatalog(input, actor)).rejects.toBeDefined(); expect(f.writes).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('atomically rejects concurrent stale publications and rollback of original source times', async () => {
    const results = await Promise.allSettled([importTestChatCatalog(catalogInput(), actor), importTestChatCatalog(catalogInput(), actor)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const current = f.docs.get('qubax_catalog/active');
    await expect(importTestChatCatalog(catalogInput(catalog(), qubaxCatalogDigest(current)), actor)).rejects.toMatchObject({ code: 'catalog-conflict' });
  });
  it('bounds selection and exact approval to signed publication expiry and revokes cached selection with its trust root', async () => {
    await prepare(); const c = f.docs.get('qubax_catalog/active');
    expect(selectQubaxCandidate(c, qubaxWorkload(testChatPayload(action).body), NOW)?.expiresAtMs).toBe(NOW + 60_000);
    expect(selectQubaxCandidate(c, qubaxWorkload(testChatPayload(action).body), NOW + 60_000)).toBeNull();
    vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[0]]));
    expect(selectQubaxCandidate(c, qubaxWorkload(testChatPayload(action).body), NOW)).toBeNull();
  });
});

describe('exact independently signed payload approvals', () => {
  it('records only exact binding/evidence, archives review, then reports ready without spending', async () => {
    const { r } = await approved(); const readiness = await checkTestChatReadiness(action, actor);
    expect(readiness.ready).toBe(true); expect(isTestChatReadiness(readiness)).toBe(true); expect(readiness.expiresAtMs).toBe(NOW + 30_000);
    const stored = f.docs.get(`qubax_chat_approvals/${r.approvalId}`);
    expect(stored.state).toBe('approved'); expect(stored.importedReview.attestation.keyId).toBe('payload-reviewer');
    expect(JSON.stringify([...f.docs.values()])).not.toContain(TEST_CHAT_SYNTHETIC_PROMPT);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['payload', 'request', 'model', 'ceiling', 'expiry', 'classes', 'signature', 'untrusted', 'noncanonical'] as const)('rejects a %s mismatch with no new approval', async failure => {
    const { input, r } = await approved(); f.docs.delete(`qubax_chat_approvals/${r.approvalId}`); f.docs.delete(`qubax_review_audit/payload_${r.approvalId}`); f.writes.mockClear();
    const review = JSON.parse(input.attestation.payload);
    if (failure === 'payload') review.payloadDigest = 'a'.repeat(64);
    if (failure === 'request') review.requestId = '2d2efc71-6d00-4514-83c0-e31461ea9f35';
    if (failure === 'model') review.model = 'different';
    if (failure === 'ceiling') review.maximumNanoUsd++;
    if (failure === 'expiry') review.expiresAtMs = NOW + 60_001;
    if (failure === 'classes') review.dataReview.approvedDataClasses = ['health'];
    input.attestation = envelope(review);
    if (failure === 'signature') input.attestation.signature = envelope(review, 'payload', otherKey.privateKey).signature;
    if (failure === 'untrusted') input.attestation.keyId = 'untrusted';
    if (failure === 'noncanonical') input.attestation.payload = ' ' + input.attestation.payload;
    await expect(importTestChatApproval(input, actor)).rejects.toBeDefined(); expect(f.writes).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('does not overwrite an expired, revoked, claimed or previously approved exact record', async () => {
    const { input, r } = await approved();
    for (const state of ['approved', 'claimed', 'revoked']) {
      f.docs.get(`qubax_chat_approvals/${r.approvalId}`).state = state;
      await expect(importTestChatApproval(input, actor)).rejects.toMatchObject({ code: 'approval-conflict' });
    }
  });
  it('distinguishes expired and consumed approval status and never trusts unsigned admin records', async () => {
    const { r } = await approved(), record = f.docs.get(`qubax_chat_approvals/${r.approvalId}`);
    record.expiresAtMs = NOW;
    expect((await checkTestChatReadiness(action, actor)).gates.payloadApproval.code).toBe('payload-approval-expired');
    record.state = 'claimed'; expect((await checkTestChatReadiness(action, actor)).gates.payloadApproval.code).toBe('payload-approval-used-or-revoked');
    record.state = 'approved'; record.expiresAtMs = NOW + 30_000; delete record.importedReview;
    expect((await checkTestChatReadiness(action, actor)).gates.payloadApproval.code).toBe('payload-approval-invalid');
  });
  it('claims at most one physical call concurrently, rejects a changed request ID and leaves ambiguous liability held', async () => {
    const { r } = await approved(); const payload = testChatPayload(action), reserve = vi.fn(async () => ({ releaseUndispatched: vi.fn() }));
    const options = { db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...payload, requireIndependentReview: true, reserve, signal: new AbortController().signal };
    const results = await Promise.all([runApprovedQubaxChat(options), runApprovedQubaxChat(options)]);
    expect(results.filter(r => r.kind === 'response')).toHaveLength(1); expect(network).toHaveBeenCalledOnce(); expect(reserve).toHaveBeenCalledOnce();
    expect(network.mock.calls[0][1]!.body).toBe(r.wirePayload);
    expect(hash(r.wirePayload)).toBe(r.payloadDigest); expect(JSON.stringify(r.body)).toBe(r.wirePayload);
    expect(JSON.parse(network.mock.calls[0][1]!.body as string)).toMatchObject({ max_tokens: 16, messages: action.messages });
    expect(await runApprovedQubaxChat({ ...options, requestId: 'test-chat:qubax:2d2efc71-6d00-4514-83c0-e31461ea9f35' })).toMatchObject({ kind: 'skipped' });
    expect(network).toHaveBeenCalledOnce();
  });
  it('revokes an imported payload signature between claim and dispatch without network or replay', async () => {
    await approved(); const release = vi.fn();
    const result = runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...testChatPayload(action), requireIndependentReview: true,
      reserve: async () => ({ releaseUndispatched: release }), signal: new AbortController().signal,
      revalidate: async () => { vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[1]])); } });
    await expect(result).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED', dispatched: false });
    expect(network).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  });
  it('binds admin approval IDs to request IDs while preserving legacy Chat binding', async () => {
    const selection = selectQubaxCandidate(catalog(), qubaxWorkload(testChatPayload(action).body), NOW)!;
    const body = testChatPayload(action).body, uid = testChatUid(actor);
    const legacy = qubaxChatBinding(uid, body, selection);
    expect(qubaxChatBinding(uid, body, selection, process.env, testChatRequestId(action)).id).not.toBe(legacy.id);
    expect(inspectQubaxCatalog(catalog(), qubaxWorkload(body), NOW).selection).not.toBeNull();
  });
  it('rejects duplicate roots even when disabled, private keys, self-review and cross-purpose signatures', () => {
    vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([{ ...roots[0], enabled: false }, roots[0]])); expect(qubaxReviewerKeys(actor).size).toBe(0);
    vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([{ ...roots[0], publicKeyPem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) }])); expect(qubaxReviewerKeys(actor).size).toBe(0);
    vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify(roots)); expect(verifyQubaxReview(catalogInput().attestation, actor, NOW)).toBeNull();
  });
});

it('retains read capacity after a rejected budget read until every sibling settles', async () => {
  await prepare();
  const waiting: (() => void)[] = [];
  const original = f.get.getMockImplementation()!;
  f.get.mockImplementation(async path => {
    if (path.includes('/paid_budget_policy')) throw new Error('synthetic unavailable');
    if (path.includes('/paid_day_')) await new Promise<void>(resolve => waiting.push(resolve));
    return original(path);
  });
  vi.useFakeTimers();
  try {
    const work = Array.from({ length: 8 }, () => checkTestChatReadiness(action, actor).catch(error => error));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await Promise.all(work)).toEqual(Array.from({ length: 8 }, () => expect.objectContaining({ code: 'storage-unavailable' })));
    await expect(checkTestChatReadiness(action, actor)).rejects.toMatchObject({ code: 'capacity' });
  } finally {
    for (const settle of waiting) settle();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  }
});

it.each(['catalog-key', 'payload-key', 'credential', 'expiry'] as const)('blocks %s changes while the final claim commit resolves', async failure => {
  await approved(); const original = f.runTransaction.getMockImplementation()!;
  let calls = 0;
  f.runTransaction.mockImplementation(callback => {
    calls++;
    const call = original(callback);
    return calls === 2 ? call.then(value => {
      if (failure === 'catalog-key') vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[0]]));
      if (failure === 'payload-key') vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[1]]));
      if (failure === 'credential') vi.stubEnv('QUBAX_API_KEY', 'different-synthetic-credential');
      if (failure === 'expiry') vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
      return value;
    }) : call;
  });
  const release = vi.fn();
  await expect(runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...testChatPayload(action), requireIndependentReview: true,
    reserve: async () => ({ releaseUndispatched: release }), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED', dispatched: false });
  expect(network).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
});
it('rechecks catalog replacement in the final atomic approval admission', async () => {
  await approved(); const original = f.runTransaction.getMockImplementation()!; let calls = 0;
  f.runTransaction.mockImplementation(callback => {
    calls++;
    if (calls === 2) f.docs.delete('qubax_catalog/active');
    return original(callback);
  });
  await expect(runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...testChatPayload(action), requireIndependentReview: true,
    reserve: async () => ({ releaseUndispatched: vi.fn() }), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED', dispatched: false });
  expect(network).not.toHaveBeenCalled();
});

it.each(['catalog-root', 'payload-root', 'credential', 'disabled', 'invalid-config', 'expiry', 'policy', 'maintenance', 'unavailable', 'read-unavailable'] as const)('does not return stale ready after %s changes during an approval read', async change => {
  await approved(); fake.unsubscribe.mockClear(); fake.unsubscribeUnavailable.mockClear();
  const original = f.get.getMockImplementation()!;
  let unblock: () => void = () => {}, entered: () => void = () => {};
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const reading = new Promise<void>(resolve => { entered = resolve; });
  f.get.mockImplementation(async path => {
    if (path.startsWith('qubax_chat_approvals/')) { entered(); await pending; }
    return original(path);
  });
  const work = checkTestChatReadiness(action, actor); await reading;
  if (change === 'catalog-root') vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[0]]));
  if (change === 'payload-root') vi.stubEnv('QUBAX_REVIEWER_KEYS_JSON', JSON.stringify([roots[1]]));
  if (change === 'credential') vi.stubEnv('QUBAX_API_KEY', 'changed-synthetic-credential');
  if (change === 'disabled') vi.stubEnv('QUBAX_ENABLED', '0');
  if (change === 'invalid-config') vi.stubEnv('QUBAX_MAX_INFLIGHT', 'invalid');
  if (change === 'expiry') vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
  if (change === 'policy') fake.policy.mockImplementation(() => { throw new Error('policy-revoked'); });
  if (change === 'maintenance' || change === 'unavailable') fake.observe.mock.lastCall![0]({ enabled: change === 'maintenance', unavailable: change === 'unavailable' });
  if (change === 'read-unavailable') fake.observeUnavailable.mock.lastCall![0]();
  unblock(); const result = await work;
  expect(result.ready).toBe(false); expect(result.reviewRequest).toBeNull(); expect(isTestChatReadiness(result)).toBe(true);
  expect(fake.unsubscribe).toHaveBeenCalledOnce(); expect(fake.unsubscribeUnavailable).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
});
it.each(['maintenance', 'unavailable', 'policy', 'read-unavailable'] as const)('blocks observed %s revocation while the final claim commit resolves', async change => {
  await approved(); const fence = createTestChatPolicyFence(); await fence.refresh();
  const original = f.runTransaction.getMockImplementation()!; let calls = 0;
  f.runTransaction.mockImplementation(callback => {
    const work = original(callback); calls++;
    return calls === 2 ? work.then(value => {
      if (change === 'policy') fake.policy.mockImplementation(() => { throw new Error('policy-revoked'); });
      else if (change === 'read-unavailable') fake.observeUnavailable.mock.lastCall![0]();
      else fake.observe.mock.lastCall![0]({ enabled: change === 'maintenance', unavailable: change === 'unavailable' });
      return value;
    }) : work;
  });
  const release = vi.fn();
  try {
    await expect(runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...testChatPayload(action), requireIndependentReview: true,
      validateFinalClaim: tx => assertTestChatMaintenanceAtClaim(f.db, tx), beforeHttpDispatch: () => fence.assertCurrent(),
      reserve: async () => ({ releaseUndispatched: release }), signal: new AbortController().signal })).rejects.toMatchObject({ dispatched: false });
    expect(network).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  } finally { fence.close(); }
});
it.each([{ enabled: true }, { enabled: 'false' }, { enabled: false, unavailable: true }, {}])('rejects authoritative maintenance state %j in final admission', async state => {
  await approved(); f.docs.set('platform_settings/ai_maintenance', state);
  await expect(runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(action), ...testChatPayload(action), requireIndependentReview: true,
    validateFinalClaim: tx => assertTestChatMaintenanceAtClaim(f.db, tx),
    reserve: async () => ({ releaseUndispatched: vi.fn() }), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED', dispatched: false });
  expect(network).not.toHaveBeenCalled();
});
it('latches an unavailable maintenance read without changing the general maintenance policy', async () => {
  const fence = createTestChatPolicyFence();
  try {
    fake.maintenance.mockResolvedValue({ enabled: false, unavailable: true });
    await expect(fence.refresh()).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED' });
    fake.maintenance.mockResolvedValue({ enabled: false });
    expect(() => fence.assertCurrent()).toThrow();
  } finally { fence.close(); }
  expect(fake.unsubscribe).toHaveBeenCalledOnce();
  expect(fake.unsubscribeUnavailable).toHaveBeenCalledOnce();
});
it('uses the same exact model and usage request for streaming wire hashing', () => {
  const body = { messages: action.messages, max_tokens: 16, stream: true };
  const selection = selectQubaxCandidate(catalog(), qubaxWorkload(body), NOW)!;
  const wire = JSON.stringify(qubaxWireBody(body, selection.modelId));
  expect(JSON.parse(wire)).toMatchObject({ model: selection.modelId, stream_options: { include_usage: true } });
  expect(qubaxChatBinding(testChatUid(actor), body, selection).payloadDigest).toBe(hash(wire));
});

describe('owner environment values never replace independent Qubax authority', () => {
  const modes = [
    { name: 'ordinary public Chat', strict: false, privateHistory: false },
    { name: 'ordinary private-history Chat', strict: false, privateHistory: true },
    { name: 'strict Admin public test', strict: true, privateHistory: false },
    { name: 'strict Admin private-history test', strict: true, privateHistory: true },
  ];
  describe.each(modes)('$name', mode => {
    it.each(['catalog', 'quality', 'savings', 'approval', 'ceiling'] as const)('cannot bypass missing or inadequate %s evidence', async failure => {
      // These are the complete historical owner-env activation inputs. They are configuration,
      // not an independent review, official price baseline or upstream monetary guarantee.
      vi.stubEnv('QUBAX_MODEL', 'fixture-dispatch-model');
      vi.stubEnv('QUBAX_MAX_USD_PER_REQUEST', '0.00001');
      const requested: TestChatAction = mode.privateHistory ? { ...action, messages: [
        { role: 'user', content: 'Synthetic confidential clinical-history fixture: discuss the example context.' },
        { role: 'assistant', content: 'Synthetic prior assistant context, not a real patient record.' },
        { role: 'user', content: 'Continue using that private example context.' },
      ] } : action;
      const payload = testChatPayload(requested);
      expect(payload.privateTurn).toBe(mode.privateHistory); expect(payload.healthTurn).toBe(mode.privateHistory);
      if (failure !== 'catalog') {
        const c = catalog();
        if (failure === 'quality') c.candidates[0].quality.approved = false as true;
        if (failure === 'savings') {
          c.candidates[0].qubax.inputNanoUsdPerMillionTokens = 200_000_000;
          c.candidates[0].qubax.outputNanoUsdPerMillionTokens = 200_000_000;
          c.candidates[0].supplierContract.perHttpRequestCeilingNanoUsd = 1_000_000;
        }
        if (failure === 'ceiling') c.candidates[0].supplierContract.hardCeilingEnforced = false as true;
        // Invalid evidence is placed directly into the synthetic store to exercise the real
        // selector and dispatch checks too, rather than merely testing import rejection.
        const publication = { actor, attestation: envelope({ kind: 'qubax-admin-catalog-review-v1', catalog: c,
          previousCatalogDigest: null, reviewedAtMs: NOW, expiresAtMs: NOW + 60_000 }, 'catalog') };
        f.docs.set('qubax_catalog/active', { ...c, publication });
      }
      const readiness = await checkTestChatReadiness(requested, actor);
      expect(readiness.ready).toBe(false);
      const blockedGate = { catalog: 'catalog', quality: 'quality', savings: 'catalog', approval: 'payloadApproval', ceiling: 'supplierCeiling' } as const;
      expect(readiness.gates[blockedGate[failure]].state).not.toBe('pass');
      const reserve = vi.fn(async () => ({ releaseUndispatched: vi.fn() }));
      // Deliberately no expectedSelection: an absent optional claim must never select an owner bypass.
      const result = await runApprovedQubaxChat({ db: f.db, uid: testChatUid(actor), requestId: testChatRequestId(requested),
        ...payload, requireIndependentReview: mode.strict, reserve, signal: new AbortController().signal });
      expect(result).toMatchObject({ kind: 'skipped', reason: failure === 'approval'
        ? 'qubax-data-approval-or-ceiling-unavailable' : 'qubax-price-or-quality-unverified' });
      expect(reserve).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
    });
  });
});
