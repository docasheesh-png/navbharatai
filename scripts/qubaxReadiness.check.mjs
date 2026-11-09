#!/usr/bin/env node
/** Real Firestore transactions; ephemeral signed fixtures and intercepted inference only. */
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const endpoint = option('--emulator'), project = option('--project');
const PROJECT = 'demo-navbharatai-phase2';
// Fail before importing the application or initializing any database client.
assert.match(endpoint ?? '', /^127\.0\.0\.1:[0-9]+$/, 'Explicit loopback emulator required');
const port = Number(endpoint.split(':')[1]);
assert.ok(Number.isSafeInteger(port) && port > 1024 && port <= 65535, 'Invalid emulator port');
assert.equal(project, PROJECT, 'Explicit isolated demo project required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint, 'No production database fallback');
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
  assert.ok(process.env[name] === undefined || process.env[name] === PROJECT, 'Conflicting project environment');
}
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SERVICE_ACCOUNT_JSON', 'QUBAX_API_KEY', 'QUBAX_REVIEWER_KEYS_JSON', 'FIREBASE_CONFIG']) {
  assert.ok(!process.env[name], 'Run this drill in a credential-empty environment');
}

const require = createRequire(import.meta.url);
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = require('undici');
const previousDispatcher = getGlobalDispatcher(), networkFence = new MockAgent();
networkFence.disableNetConnect();
setGlobalDispatcher(networkFence);
const previousFetch = globalThis.fetch;
let fixtureCalls = 0, replyMode = 'success';
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.qubax.ai/v1/chat/completions', 'Unexpected network request is blocked');
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
  assert.deepEqual(init?.headers, { Authorization: 'Bearer synthetic-emulator-only-qubax', 'Content-Type': 'application/json' });
  const body = JSON.parse(init.body);
  assert.deepEqual(body, { messages: [{ role: 'user', content: 'What is 2 + 2? Reply with one number only.' }],
    max_tokens: 16, stream: false, model: 'fixture-dispatch-model' });
  fixtureCalls++;
  if (replyMode === 'lost') throw new Error('Synthetic response lost after intercepted dispatch');
  return new Response(JSON.stringify({ model: body.model, choices: [{ index: 0, message: { content: '4' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
};

process.env.NODE_ENV = 'test';
process.env.GCE_METADATA_HOST = '127.0.0.1:9';
process.env.QUBAX_ENABLED = '1';
process.env.QUBAX_API_KEY = 'synthetic-emulator-only-qubax';
process.env.FREE_CHAIN_MONTHLY_CAP_ENABLED = '1';
const { Firestore } = require('firebase-admin/firestore');
const db = new Firestore({ projectId: PROJECT, databaseId: `qubax-review-${randomUUID()}`, host: endpoint, ssl: false });
const { setServerDb } = await import('../src/server/lib/serverDb.ts');
setServerDb(db);
const { checkTestChatReadiness, importTestChatApproval, importTestChatCatalog, qubaxCatalogDigest } = await import('../src/server/lib/qubaxReadiness.ts');
const { canonicalQubaxReview, QUBAX_CATALOG_SIGNATURE_DOMAIN, QUBAX_REVIEW_SIGNATURE_DOMAIN, verifyQubaxCatalogPublication } = await import('../src/server/lib/qubaxReviewSignature.ts');
const { qubaxChatBinding, qubaxWorkload, runApprovedQubaxChat } = await import('../src/server/lib/qubax.ts');
const { QUBAX_CATALOG_PATH, selectQubaxCandidate } = await import('../src/server/lib/qubaxSelector.ts');
const { testChatPayload, testChatRequestId, testChatUid } = await import('../src/server/lib/testChatPayload.ts');
const { runTestChat } = await import('../src/server/lib/testChatBot.ts');
const { assertTestChatMaintenanceAtClaim } = await import('../src/server/lib/testChatPolicyFence.ts');
const { FreeChainStore } = await import('../src/server/AI/FreeChain/store.ts');
const { monthKey } = await import('../src/server/AI/FreeChain/masterPlan.ts');

const actor = 'synthetic-requesting-admin', started = Date.now();
const keys = { catalog: generateKeyPairSync('ed25519'), payload: generateKeyPairSync('ed25519') };
const roots = Object.entries(keys).map(([kind, pair]) => ({ keyId: `${kind}-reviewer`, reviewerId: `independent-${kind}-fixture-reviewer`,
  publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  purpose: kind === 'catalog' ? 'qubax-catalog-review-v1' : 'qubax-exact-payload-v1', enabled: true }));
const restoreTrust = () => { process.env.QUBAX_REVIEWER_KEYS_JSON = JSON.stringify(roots); };
restoreTrust();
const hash = value => createHash('sha256').update(value).digest('hex');
const freshAction = () => ({ provider: 'qubax', requestId: randomUUID(),
  messages: [{ role: 'user', content: 'What is 2 + 2? Reply with one number only.' }], confirmGatewayDisclosure: true });
function envelope(value, kind) {
  const payload = canonicalQubaxReview(value);
  const domain = kind === 'catalog' ? QUBAX_CATALOG_SIGNATURE_DOMAIN : QUBAX_REVIEW_SIGNATURE_DOMAIN;
  return { keyId: `${kind}-reviewer`, payload, signature: sign(null, Buffer.from(domain + payload), keys[kind].privateKey).toString('base64url') };
}
function catalog(observedAtMs = started - 10_000) {
  const evidence = { observedAtMs, expiresAtMs: started + 240_000, evidenceRef: 'fixture:synthetic-source-not-real-supplier-evidence' };
  const scope = { model: 'fixture-model', revision: 'fixture-revision', sku: 'fixture-sku', tokenizer: 'fixture-tokenizer',
    contextBand: 'under-8k', serviceTier: 'standard', currency: 'USD', billingBasis: 'per-million-tokens', modality: 'text' };
  const price = { ...evidence, scope, cacheReadNanoUsdPerMillionTokens: null, cacheWriteNanoUsdPerMillionTokens: null,
    requestFeeNanoUsd: 0, additionalFeesNanoUsd: 0, minimumChargeNanoUsd: 0, allFeesIncluded: true, reviewRef: 'fixture:price-review' };
  return { ...evidence, kind: 'qubax-reviewed-chat-catalog-v1', benchmarkRef: 'fixture:benchmark', independentReviewRef: 'fixture:independent-review', candidates: [{
    modelId: 'fixture-dispatch-model', maxInputTokens: 8000, maxOutputTokens: 4000,
    qubax: { ...price, source: 'qubax', inputNanoUsdPerMillionTokens: 1_000_000, outputNanoUsdPerMillionTokens: 1_000_000 },
    official: { ...price, source: 'official', inputNanoUsdPerMillionTokens: 1_000_000_000, outputNanoUsdPerMillionTokens: 1_000_000_000 },
    supplierContract: { ...evidence, reviewRef: 'fixture:synthetic-supplier-contract', hardCeilingEnforced: true,
      includesInternalRetriesFailoversAndFees: true, exactModelAndRevisionEnforced: true, perHttpRequestCeilingNanoUsd: 10_000 },
    quality: { policyId: 'qubax-chat-quality-v1', benchmarkRef: 'fixture:benchmark', reviewRef: 'fixture:synthetic-quality', reviewedAtMs: started - 60_000,
      expiresAtMs: started + 240_000, textScoreBps: 8500, hindiScoreBps: 8500, successRateBps: 9950, p95LatencyMs: 1000, sampleCount: 200, approved: true },
  }] };
}
function catalogInput(value, previousCatalogDigest = null) {
  return { action: freshAction(), attestation: envelope({ kind: 'qubax-admin-catalog-review-v1', catalog: value,
    previousCatalogDigest, reviewedAtMs: started, expiresAtMs: started + 180_000 }, 'catalog') };
}
async function approvalInput(action = freshAction()) {
  const active = (await db.doc(QUBAX_CATALOG_PATH).get()).data();
  const selection = selectQubaxCandidate(active, qubaxWorkload(testChatPayload(action).body));
  assert.ok(selection, 'Synthetic catalog must remain current during this bounded drill');
  const binding = qubaxChatBinding(testChatUid(actor), testChatPayload(action).body, selection, process.env, testChatRequestId(action));
  const review = { kind: 'qubax-admin-review-v1', approvalId: binding.id, payloadDigest: binding.payloadDigest,
    requestId: action.requestId, model: selection.modelId, modelRevision: selection.modelRevision, evidenceBinding: selection.evidenceBinding,
    maximumNanoUsd: selection.maximumNanoUsd, reviewedAtMs: Date.now(), expiresAtMs: Math.min(Date.now() + 120_000, selection.expiresAtMs),
    dataReview: { entirePayloadReviewed: true, gatewayAndAllDownstreamProcessorsReviewed: true, approvedDataClasses: ['public'],
      reviewRef: 'fixture:payload-review', disclosureAuthorityRef: 'fixture:disclosure', processorTermsRef: 'fixture:processors', protectionsRef: 'fixture:protections' } };
  return { input: { action, attestation: envelope(review, 'payload') }, approvalId: binding.id };
}
const approvalRef = id => db.doc(`qubax_chat_approvals/${id}`);
const expectCode = code => error => error?.code === code;
async function approve() { const value = await approvalInput(); await importTestChatApproval(value.input, actor); return value; }
let passed = 0;
const check = label => { passed++; console.log(`PASS ${passed}: ${label}`); };
const store = new FreeChainStore(db);

try {
  const empty = await checkTestChatReadiness(freshAction(), actor);
  assert.equal(empty.ready, false); assert.equal(empty.gates.catalog.code, 'catalog-missing');
  assert.equal((await db.listCollections()).length, 0); assert.equal(fixtureCalls, 0);
  check('read-only readiness creates no database records and performs no inference');

  const firstPackage = catalogInput(catalog());
  const competingCatalogs = await Promise.allSettled(Array.from({ length: 4 }, () => importTestChatCatalog(firstPackage, actor)));
  assert.equal(competingCatalogs.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(competingCatalogs.filter(result => result.status === 'rejected').every(result => result.reason.code === 'catalog-conflict'));
  const original = (await db.doc(QUBAX_CATALOG_PATH).get()).data();
  assert.equal(original.observedAtMs, started - 10_000);
  const catalogProofs = await db.collection('qubax_review_audit').where('kind', '==', 'catalog-import').get();
  assert.equal(catalogProofs.size, 1);
  const catalogProof = catalogProofs.docs[0].data();
  assert.deepEqual(catalogProof.attestation, firstPackage.attestation);
  assert.equal(catalogProof.signerPublicKeyPem, roots[0].publicKeyPem);
  assert.equal(catalogProof.signerFingerprint, hash(roots[0].publicKeyPem));
  assert.equal(fixtureCalls, 0);
  check('four real concurrent catalog transactions publish once with atomic public verification proof');

  await assert.rejects(importTestChatCatalog(catalogInput(catalog(), qubaxCatalogDigest(original)), actor), expectCode('catalog-conflict'));
  const replacementPackages = [catalogInput(catalog(started - 9000), qubaxCatalogDigest(original)), catalogInput(catalog(started - 8000), qubaxCatalogDigest(original))];
  const replacements = await Promise.allSettled(replacementPackages.map(value => importTestChatCatalog(value, actor)));
  assert.equal(replacements.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(replacements.filter(result => result.status === 'rejected')[0].reason.code, 'catalog-conflict');
  assert.equal((await db.collection('qubax_review_audit').where('kind', '==', 'catalog-import').get()).size, 2);
  check('catalog compare-and-set prevents stale concurrent replacement and source timestamp rollback');

  const exact = await approvalInput();
  const imports = await Promise.allSettled(Array.from({ length: 4 }, () => importTestChatApproval(exact.input, actor)));
  assert.equal(imports.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(imports.filter(result => result.status === 'rejected').every(result => result.reason.code === 'approval-conflict'));
  const stored = (await approvalRef(exact.approvalId).get()).data();
  const proof = (await db.doc(`qubax_review_audit/payload_${exact.approvalId}`).get()).data();
  assert.equal(stored.state, 'approved'); assert.deepEqual(proof.attestation, exact.input.attestation);
  assert.equal(proof.signerPublicKeyPem, roots[1].publicKeyPem);
  const ready = await checkTestChatReadiness(exact.input.action, actor);
  assert.equal(ready.ready, true); assert.equal(fixtureCalls, 0);
  check('four real concurrent payload imports create exactly one approval and one matching archived proof');

  const collision = await approvalInput();
  const collisionRef = db.doc(`qubax_review_audit/payload_${collision.approvalId}`);
  await collisionRef.create({ syntheticCollision: true });
  await assert.rejects(importTestChatApproval(collision.input, actor), expectCode('storage-unavailable'));
  assert.equal((await approvalRef(collision.approvalId).get()).exists, false);
  assert.deepEqual((await collisionRef.get()).data(), { syntheticCollision: true });
  check('a real audit-create failure rolls back approval creation instead of publishing partial authority');

  const responses = await Promise.allSettled(Array.from({ length: 4 }, () => runTestChat(exact.input.action, actor, new AbortController().signal)));
  assert.equal(responses.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(responses.find(result => result.status === 'fulfilled').value.syntheticMatch, true);
  assert.equal(fixtureCalls, 1);
  const used = (await approvalRef(exact.approvalId).get()).data();
  assert.equal(used.state, 'claimed'); assert.equal(used.attemptsStarted, 1);
  const spend = await store.spendSnapshot();
  assert.equal(spend.heldNanoUsd, 10_000); assert.equal(spend.spentNanoUsd, 0);
  assert.equal((await db.doc(`free_chat_chain/state/paid_month/${monthKey(Date.now())}`).get()).data().heldNanoUsd, 10_000);
  await assert.rejects(runTestChat(exact.input.action, actor, new AbortController().signal));
  await assert.rejects(importTestChatApproval(exact.input, actor), expectCode('approval-conflict'));
  assert.equal(fixtureCalls, 1);
  check('real competing one-use claims dispatch one synthetic response and retain daily/monthly maximum liability');

  const lost = await approve(); replyMode = 'lost';
  await assert.rejects(runTestChat(lost.input.action, actor, new AbortController().signal));
  await assert.rejects(runTestChat(lost.input.action, actor, new AbortController().signal));
  replyMode = 'success'; assert.equal(fixtureCalls, 2);
  assert.equal((await store.spendSnapshot()).heldNanoUsd, 20_000);
  assert.equal((await db.doc(`free_chat_chain/state/paid_month/${monthKey(Date.now())}`).get()).data().heldNanoUsd, 20_000);
  check('an ambiguous synthetic response retains both real budget holds and cannot be replayed');

  const revoked = await approve(); let released = 0;
  await assert.rejects(runApprovedQubaxChat({ db, uid: testChatUid(actor), requestId: testChatRequestId(revoked.input.action),
    ...testChatPayload(revoked.input.action), requireIndependentReview: true, signal: new AbortController().signal,
    reserve: async () => { await approvalRef(revoked.approvalId).update({ state: 'revoked' }); return { releaseUndispatched: async () => { released++; } }; },
  }), error => error?.code === 'QUBAX_APPROVAL_REVOKED' && error.dispatched === false);
  assert.equal(released, 1); assert.equal(fixtureCalls, 2);
  await assert.rejects(importTestChatApproval(revoked.input, actor), expectCode('approval-conflict'));
  check('a real persisted approval revocation before dispatch blocks inference and preserves the replay fence');

  const paused = await approve(); let releasedPaused = 0;
  const maintenance = db.doc('platform_settings/ai_maintenance');
  try {
    await assert.rejects(runApprovedQubaxChat({ db, uid: testChatUid(actor), requestId: testChatRequestId(paused.input.action),
      ...testChatPayload(paused.input.action), requireIndependentReview: true, signal: new AbortController().signal,
      validateFinalClaim: tx => assertTestChatMaintenanceAtClaim(db, tx),
      reserve: async () => { await maintenance.set({ enabled: true }); return { releaseUndispatched: async () => { releasedPaused++; } }; },
    }), error => error?.code === 'QUBAX_APPROVAL_REVOKED' && error.dispatched === false);
    assert.equal(releasedPaused, 1); assert.equal(fixtureCalls, 2);
    assert.equal((await approvalRef(paused.approvalId).get()).data().attemptsStarted, 0);
    await assert.rejects(importTestChatApproval(paused.input, actor), expectCode('approval-conflict'));
  } finally { await maintenance.set({ enabled: false }); }
  check('a maintenance pause persisted after claim is read by real atomic admission and blocks dispatch');

  // This seam delays only the completion boundary around REAL Firestore transactions.
  // It reproduces the last-await race; no in-memory transaction implementation is used.
  for (const purpose of ['catalog', 'payload']) {
    const late = await approve(); let transactions = 0, releasedLate = 0;
    const handle = { doc: path => db.doc(path), runTransaction: async callback => {
      const sequence = ++transactions;
      const result = await db.runTransaction(callback);
      if (sequence === 2) process.env.QUBAX_REVIEWER_KEYS_JSON = JSON.stringify(roots.filter(root => root.keyId !== `${purpose}-reviewer`));
      return result;
    } };
    try {
      await assert.rejects(runApprovedQubaxChat({ db: handle, uid: testChatUid(actor), requestId: testChatRequestId(late.input.action),
        ...testChatPayload(late.input.action), requireIndependentReview: true, signal: new AbortController().signal,
        reserve: async () => ({ releaseUndispatched: async () => { releasedLate++; } }),
      }), error => error?.code === 'QUBAX_APPROVAL_REVOKED' && error.dispatched === false);
      assert.equal(transactions, 2); assert.equal(releasedLate, 1); assert.equal(fixtureCalls, 2);
    } finally { restoreTrust(); }
    check(`${purpose} trust revoked at the final real transaction completion cannot dispatch`);
  }

  const replaced = await approve(); let transactions = 0, releasedReplaced = 0;
  const handle = { doc: path => db.doc(path), runTransaction: async callback => {
    if (++transactions === 2) {
      const active = (await db.doc(QUBAX_CATALOG_PATH).get()).data();
      await importTestChatCatalog(catalogInput(catalog(started - 7000), qubaxCatalogDigest(active)), actor);
    }
    return db.runTransaction(callback);
  } };
  await assert.rejects(runApprovedQubaxChat({ db: handle, uid: testChatUid(actor), requestId: testChatRequestId(replaced.input.action),
    ...testChatPayload(replaced.input.action), requireIndependentReview: true, signal: new AbortController().signal,
    reserve: async () => ({ releaseUndispatched: async () => { releasedReplaced++; } }),
  }), error => error?.code === 'QUBAX_APPROVAL_REVOKED' && error.dispatched === false);
  assert.equal(releasedReplaced, 1); assert.equal(fixtureCalls, 2);
  check('a catalog replaced before the final real admission transaction invalidates the old exact approval');

  const archived = await db.collection('qubax_review_audit').get();
  const serialized = JSON.stringify(archived.docs.map(document => document.data()));
  assert.ok(!serialized.includes('synthetic-emulator-only-qubax'));
  assert.ok(!serialized.includes('What is 2 + 2?'));
  assert.ok(!serialized.includes('BEGIN PRIVATE KEY'));
  process.env.QUBAX_REVIEWER_KEYS_JSON = '[]';
  const active = (await db.doc(QUBAX_CATALOG_PATH).get()).data();
  assert.equal(verifyQubaxCatalogPublication(active, Date.now()), false);
  assert.equal(selectQubaxCandidate(active, qubaxWorkload(testChatPayload(freshAction()).body)), null);
  assert.equal((await checkTestChatReadiness(freshAction(), actor)).ready, false);
  assert.equal(fixtureCalls, 2);
  check('archived public proofs exclude prompts/credentials and never restore revoked live trust');

  console.log(`Qubax readiness emulator drills: ${passed} passed; 0 failed. ${fixtureCalls} intercepted synthetic attempts; no provider calls, paid inference or production data.`);
} finally {
  setServerDb(null);
  await db.terminate();
  globalThis.fetch = previousFetch;
  setGlobalDispatcher(previousDispatcher);
  await networkFence.close();
}
