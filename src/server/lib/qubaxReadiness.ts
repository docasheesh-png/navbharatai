import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { readTestChatAction, readTestChatApprovalImport, TEST_CHAT_READINESS_GATES,
  type TestChatAction, type TestChatApprovalImport, type TestChatApprovalReceipt, type TestChatReadiness, type TestChatReadinessGate } from '../../lib/testChatBot';
import { qubaxChatBinding, qubaxConfig, qubaxReviewedApprovalCeiling, qubaxWireBody, qubaxWorkload } from './qubax';
import { inspectQubaxCatalog, isQubaxCatalogImportShape, QUBAX_CATALOG_PATH, selectQubaxCandidate } from './qubaxSelector';
import { canonicalQubaxReview, qubaxReviewerKeys, verifyQubaxReview, verifyQubaxCatalogPublication } from './qubaxReviewSignature';
import { createTestChatPolicyFence } from './testChatPolicyFence';
import { testChatPayload, testChatRequestId, testChatUid } from './testChatPayload';
import { getServerDb } from './serverDb';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { freeChainConfig } from '../AI/FreeChain/config';
import { monthKey } from '../AI/FreeChain/masterPlan';
import { checkedAdd, civilDayWindow } from '../AI/FreeChain/quota';
import { FREE_CHAIN_COLLECTION, paidUserDocumentPath, readData, readPaidPolicy, readPaidUser, readSpendDay } from '../AI/FreeChain/paidLedger';
import { PAID_BUDGET_TIME_ZONE } from '../AI/FreeChain/spendCap';

export const QUBAX_REVIEW_AUDIT_COLLECTION = 'qubax_review_audit';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const gate = (state: TestChatReadinessGate['state'], code: string, message: string, action = ''): TestChatReadinessGate => ({ state, code, message, action });
const unknown = (code: string, action: string) => gate('unknown', code, 'This prerequisite has not been verified.', action);
const noStore = () => gate('unknown', 'storage-unavailable', 'The server could not read approval or budget storage.', 'Restore server access to the safety store, then check readiness again.');
export class QubaxAdminReviewError extends Error {
  constructor(readonly code: 'invalid' | 'trust-unavailable' | 'catalog-unavailable' | 'review-invalid' | 'approval-conflict' | 'catalog-conflict' | 'storage-unavailable' | 'capacity', readonly status = 409) { super(code); }
}
// Time-bounded metadata reads. Timed-out reads retain their slot until they settle, preventing detached-read accumulation.
let pendingReads = 0;
async function boundedRead<T>(work: () => Promise<T>): Promise<T> {
  if (pendingReads >= 8) throw new QubaxAdminReviewError('capacity', 503);
  pendingReads++;
  const promise = Promise.resolve().then(work);
  void promise.then(() => { pendingReads--; }, () => { pendingReads--; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new QubaxAdminReviewError('storage-unavailable', 503)), 10_000); })]); }
  finally { clearTimeout(timer); }
}
export const qubaxCatalogDigest = (catalog: unknown): string | null => catalog === undefined || catalog === null ? null : sha(canonicalQubaxReview(catalog));

/** Same current policy, strict ledger readers, per-user guard and IST windows as reservePaid/reserveMonthly; reads only. */
async function budgetReadiness(db: Firestore, action: TestChatAction, actor: string, amount: number | undefined, now: number): Promise<TestChatReadinessGate> {
  try {
    const cfg = freeChainConfig();
    if (cfg.errors.some(e => /PAID_DAILY_CAP|MONTHLY_CAP|PAID_PER_USER/.test(e))) return gate('blocked', 'budget-configuration', 'Shared budget configuration is invalid.', 'Correct the existing shared budget configuration; do not raise caps for this test.');
    const uidHash = sha(testChatUid(actor)), day = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
    const reads = await Promise.allSettled([
      () => db.doc(`${FREE_CHAIN_COLLECTION}/paid_budget_policy`).get(), () => db.doc(`${FREE_CHAIN_COLLECTION}/paid_day_${day.key}`).get(),
      () => db.doc(paidUserDocumentPath(day.key, uidHash)).get(), () => db.doc(`${FREE_CHAIN_COLLECTION}/paid_reservation_${sha(testChatRequestId(action))}`).get(),
      () => cfg.features.monthlyCap ? db.doc(`${FREE_CHAIN_COLLECTION}/state/paid_month/${monthKey(now)}`).get() : Promise.resolve(null),
    ].map(read => Promise.resolve().then(read)));
    // Keep the outer bounded-read slot until EVERY spawned read settles, including after a sibling rejection.
    const snapshots = reads.map(read => { if (read.status === 'rejected') throw new Error('budget read failed'); return read.value; });
    const [policySnap, daySnap, userSnap, requestSnap] = snapshots as import('firebase-admin/firestore').DocumentSnapshot[];
    const monthSnap = snapshots[4];
    if (requestSnap.exists) return gate('blocked', 'request-already-reserved', 'This request ID already has a paid reservation. No new call is authorized.', 'Do not replay an uncertain request. Reconcile its outcome before preparing another explicitly authorized test.');
    const policy = readPaidPolicy(readData(policySnap)), ledger = readSpendDay(readData(daySnap), day);
    const count = readPaidUser(readData(userSnap), day.key, uidHash);
    if (ledger.requests === Number.MAX_SAFE_INTEGER) return gate('blocked', 'budget-counter-exhausted', 'The daily paid-request counter cannot admit another request.', 'Ask the operator to reconcile the shared ledger; do not reset it to bypass liability.');
    if (count >= cfg.paidPerUserDaily) return gate('blocked', 'budget-user-limit', 'The shared per-user daily paid-attempt limit is exhausted.', 'Wait for the existing daily reset.');
    const cap = Math.min(cfg.paidCapNanoUsd, policy?.capNanoUsd ?? cfg.paidCapNanoUsd);
    const committed = checkedAdd(ledger.heldNanoUsd, ledger.spentNanoUsd);
    if (policy?.budgetMode !== 'uncapped' && (committed >= cap || (amount !== undefined && amount > cap - committed))) return gate('blocked', 'budget-daily', 'The shared daily budget cannot admit this request.', 'Wait for the existing budget reset or reconcile completed reservations with verified billing.');
    if (monthSnap) {
      const raw = readData(monthSnap);
      if (raw !== undefined && !object(raw)) throw new Error('invalid ledger');
      const data = (raw ?? {}) as Record<string, unknown>, held = data.heldNanoUsd ?? 0, spent = data.spentNanoUsd ?? 0;
      if (!Number.isSafeInteger(held) || Number(held) < 0 || !Number.isSafeInteger(spent) || Number(spent) < 0) throw new Error('invalid ledger');
      const monthly = checkedAdd(Number(held), Number(spent));
      if (policy?.budgetMode !== 'uncapped' && (monthly >= cfg.features.monthlyCapNanoUsd || (amount !== undefined && amount > cfg.features.monthlyCapNanoUsd - monthly))) return gate('blocked', 'budget-monthly', 'The shared monthly budget cannot admit this request.', 'Wait for the existing monthly reset or reconcile completed reservations with verified billing.');
      if (amount !== undefined) checkedAdd(monthly, amount);
    }
    if (amount === undefined) return unknown('budget-awaiting-ceiling', 'A verified supplier ceiling is required to compare this request against remaining shared budgets.');
    checkedAdd(committed, amount);
    return gate('pass', 'budget-available', 'Shared budgets currently have room. This read does not reserve funds or verify the provider balance.', 'Send still requires atomic admission and can be denied if another request consumes capacity.');
  } catch { return noStore(); }
}

export async function checkTestChatReadiness(value: TestChatAction, actor: string): Promise<TestChatReadiness> {
  const action = readTestChatAction(value);
  if (!action) throw new QubaxAdminReviewError('invalid', 400);
  return boundedRead(async () => {
    const policyFence = createTestChatPolicyFence();
    try {
    const gates = Object.fromEntries(TEST_CHAT_READINESS_GATES.map(id => [id, unknown('not-checked', 'Complete the preceding prerequisites, then check again.')])) as TestChatReadiness['gates'];
    const result: TestChatReadiness = { provider: 'qubax', requestId: action.requestId, checkedAtMs: Date.now(), ready: false,
      readOnly: true, noProviderCall: true, noFallback: true, gates, model: null, expiresAtMs: null, reviewRequest: null,
      catalogDigest: null, lastSafeDiagnostic: null, providerBalance: 'not-checked' };
    let configured = false, credentialAtStart = '';
    let approvalSnapshot: Record<string, unknown> | undefined;
    try {
      const cfg = qubaxConfig(); configured = !!cfg.apiKey; credentialAtStart = cfg.apiKey;
      gates.configured = cfg.apiKey ? gate('pass', 'configured', 'A server-side Qubax credential is present. Its account and validity have not been verified.')
        : gate('blocked', 'credential-missing', 'No server-side Qubax credential is configured.', 'Have the deployment operator connect the intended existing secret. Never paste a key here.');
      gates.enabled = cfg.enabled ? gate('pass', 'enabled', 'The server Qubax switch is enabled.')
        : gate('blocked', 'provider-disabled', 'The server Qubax switch is disabled.', 'Have the authorized deployment operator review the provider switch.');
    } catch {
      gates.configured = gate('blocked', 'configuration-invalid', 'Qubax server configuration is invalid.', 'Correct the server configuration before requesting approval.');
    }
    const trusted = qubaxReviewerKeys(actor), catalogTrust = qubaxReviewerKeys(actor, process.env, 'qubax-catalog-review-v1');
    gates.reviewerTrust = trusted.size && catalogTrust.size ? gate('pass', 'reviewer-trust-configured', 'Independent purpose-scoped catalog and payload-review public keys are configured.')
      : gate('blocked', 'reviewer-trust-unavailable', !trusted.size ? 'No eligible independent payload-review public key is configured.' : 'No eligible independent catalog-review public key is configured.', 'Have the security operator provision an independently controlled reviewer public key. This panel cannot register keys or approve itself.');
    try { await policyFence.refresh(); assertLegacyInferenceAllowed('admin-test-chat-bot'); gates.dispatchPolicy = gate('pass', 'dispatch-policy-allowed', 'Current maintenance and inference policy permit this isolated route.'); }
    catch { gates.dispatchPolicy = gate('blocked', 'dispatch-policy-blocked', 'Maintenance or inference policy blocks this route.', 'Ask the authorized operator to review the existing policy; do not bypass it.'); }
    const db = getServerDb();
    if (!db) { for (const id of ['catalog', 'quality', 'supplierCeiling', 'payloadApproval', 'budget'] as const) gates[id] = noStore(); result.lastSafeDiagnostic = 'storage-unavailable'; return result; }
    const payload = testChatPayload(action), uid = testChatUid(actor);
    let catalog: unknown;
    try { catalog = (await db.doc(QUBAX_CATALOG_PATH).get()).data(); }
    catch { for (const id of ['catalog', 'quality', 'supplierCeiling', 'payloadApproval', 'budget'] as const) gates[id] = noStore(); result.lastSafeDiagnostic = 'storage-unavailable'; return result; }
    const now = Date.now(); result.checkedAtMs = now; result.catalogDigest = qubaxCatalogDigest(catalog);
    const inspected = inspectQubaxCatalog(catalog, qubaxWorkload(payload.body), now, true), selection = inspected.selection;
    gates.catalog = inspected.catalog === 'ready' ? gate('pass', 'catalog-current', 'Current independently reviewed catalog and exact comparable prices are present.')
      : gate('blocked', `catalog-${inspected.catalog}`, ({ missing: 'The reviewed Qubax catalog is missing.', invalid: 'The reviewed Qubax catalog is malformed or has no usable candidates.',
        unsigned: 'Catalog independent signature is missing, invalid, expired or revoked.', stale: 'Reviewed catalog source evidence is expired or has invalid timestamps.', 'pricing-unverified': 'No unique exact model has current, comparable reviewed Qubax and official prices.',
        'savings-unverified': 'The reviewed supplier ceiling or rate components do not meet the required savings boundary.' })[inspected.catalog],
      'Obtain a legitimate independently signed catalog package and import it below. Preserve original source timestamps; public price observations alone cannot authorize Chat.');
    gates.quality = inspected.quality === 'ready' ? gate('pass', 'quality-current', 'The candidate passes the current reviewed Hindi/text quality policy.')
      : gate(inspected.quality === 'unknown' ? 'unknown' : 'blocked', 'quality-unverified', 'Current reviewed benchmark quality has not been established.', 'Obtain real benchmark evidence and independent review in the signed catalog. Do not invent scores.');
    gates.supplierCeiling = inspected.supplierCeiling === 'ready' ? gate('pass', 'supplier-ceiling-reviewed', 'Current catalog records independently reviewed supplier enforcement for total cost and exact model/revision.')
      : gate(inspected.supplierCeiling === 'unknown' ? 'unknown' : 'blocked', 'supplier-ceiling-unverified', 'A supplier-enforced all-in per-request spending ceiling is not verified.', 'Obtain authoritative supplier enforcement covering fees, internal retries, failovers and exact model/revision. Estimates, account balance, monthly caps and signatures alone cannot provide it.');
    gates.budget = await budgetReadiness(db, action, actor, selection?.maximumNanoUsd, now);
    if (selection && configured) {
      result.model = selection.modelId; result.expiresAtMs = selection.expiresAtMs;
      const binding = qubaxChatBinding(uid, payload.body, selection, process.env, testChatRequestId(action));
      try {
        const approval = (await db.doc(`qubax_chat_approvals/${binding.id}`).get()).data();
        approvalSnapshot = approval;
        const ceiling = qubaxReviewedApprovalCeiling(approval, { uid, binding, selection, ...payload, requestId: testChatRequestId(action), now: Date.now() });
        if (ceiling !== undefined && approval?.importedReview) { gates.payloadApproval = gate('pass', 'payload-approved', 'This exact payload has an unexpired, unused independent approval.'); result.expiresAtMs = Math.min(selection.expiresAtMs, approval!.expiresAtMs); }
        else if (!approval) gates.payloadApproval = gate('blocked', 'payload-approval-missing', 'No independent approval exists for this exact payload, model, credential and evidence.', 'Copy the review package, obtain an independent signature, and import the signed approval.');
        else if (approval.state !== 'approved') gates.payloadApproval = gate('blocked', 'payload-approval-used-or-revoked', 'This approval has already been claimed, consumed or revoked.', 'Do not replay it. Reconcile any uncertain dispatch before a separately authorized request.');
        else if (Number.isSafeInteger(approval.expiresAtMs) && approval.expiresAtMs <= Date.now()) gates.payloadApproval = gate('blocked', 'payload-approval-expired', 'The exact-payload approval has expired.', 'Refresh current evidence and obtain a new independent review. Imports never renew an existing approval.');
        else gates.payloadApproval = gate('blocked', 'payload-approval-invalid', 'The stored approval does not match current payload, request, trust or disclosure requirements.', 'Obtain an independent approval for this exact current review package.');
      } catch { gates.payloadApproval = noStore(); }
      if (trusted.size) result.reviewRequest = { kind: 'qubax-admin-review-request-v1', approvalId: binding.id, payloadDigest: binding.payloadDigest,
        requestId: action.requestId, model: selection.modelId, modelRevision: selection.modelRevision, evidenceBinding: selection.evidenceBinding,
        maximumNanoUsd: selection.maximumNanoUsd, expiresAtMs: selection.expiresAtMs,
        body: qubaxWireBody(payload.body, selection.modelId), wirePayload: JSON.stringify(qubaxWireBody(payload.body, selection.modelId)) };
    } else gates.payloadApproval = unknown('payload-awaiting-prerequisites', 'Configure Qubax and import a current independently reviewed eligible catalog before preparing exact-payload review.');
    // No await follows this projection: never advertise old config/trust/policy as freshly ready.
    const finalNow = Date.now();
    const finalCatalog = inspectQubaxCatalog(catalog, qubaxWorkload(payload.body), finalNow, true);
    const finalSelection = finalCatalog.selection;
    if (selection && (!finalSelection || JSON.stringify(finalSelection) !== JSON.stringify(selection))) {
      gates.catalog = gate('blocked', `catalog-${finalCatalog.catalog === 'ready' ? 'changed' : finalCatalog.catalog}`,
        'The catalog review, trust or evidence changed or expired while readiness was being checked.', 'Check readiness again with current independent evidence.');
      result.reviewRequest = null; result.expiresAtMs = null;
    }
    const finalPayloadTrust = qubaxReviewerKeys(actor), finalCatalogTrust = qubaxReviewerKeys(actor, process.env, 'qubax-catalog-review-v1');
    if (!finalPayloadTrust.size || !finalCatalogTrust.size) {
      const missing = !finalPayloadTrust.size && !finalCatalogTrust.size ? 'payload-review or catalog-review'
        : !finalPayloadTrust.size ? 'payload-review' : 'catalog-review';
      gates.reviewerTrust = gate('blocked', 'reviewer-trust-unavailable', `No eligible independent ${missing} public key is configured.`, 'Have the security operator review the current purpose-scoped public keys, then check again.');
      result.reviewRequest = null;
    }
    try {
      const currentConfig = qubaxConfig();
      if (!currentConfig.enabled) { gates.enabled = gate('blocked', 'provider-disabled', 'The server Qubax switch is disabled.', 'Have the authorized deployment operator review the provider switch.'); result.reviewRequest = null; }
      if (!currentConfig.apiKey) gates.configured = gate('blocked', 'credential-missing', 'No server-side Qubax credential is configured.', 'Have the deployment operator connect the intended existing secret. Never paste a key here.');
      if (currentConfig.apiKey !== credentialAtStart) {
        gates.payloadApproval = gate('blocked', 'payload-approval-invalid', 'The credential configuration changed during this check.', 'Check again and obtain approval for the current exact binding.');
        result.reviewRequest = null;
      } else if (selection && gates.payloadApproval.state === 'pass') {
        const currentBinding = qubaxChatBinding(uid, payload.body, selection, process.env, testChatRequestId(action));
        if (qubaxReviewedApprovalCeiling(approvalSnapshot, { uid, binding: currentBinding, selection, ...payload, requestId: testChatRequestId(action), now: finalNow }) === undefined) {
          gates.payloadApproval = gate('blocked', 'payload-approval-invalid', 'Payload approval or reviewer trust changed or expired during this check.', 'Check readiness again and obtain a current independent approval.');
          result.reviewRequest = null;
        }
      }
    } catch {
      gates.configured = gate('blocked', 'configuration-invalid', 'Qubax configuration changed or became invalid during this check.', 'Ask the deployment operator to correct configuration, then check again.');
      result.reviewRequest = null;
    }
    try { policyFence.assertCurrent(); }
    catch { gates.dispatchPolicy = gate('blocked', 'dispatch-policy-blocked', 'Maintenance or inference policy changed during this check.', 'Review the existing policy, then check readiness again.'); result.reviewRequest = null; }
    result.checkedAtMs = finalNow;
    result.ready = !!selection && result.expiresAtMs! > result.checkedAtMs && TEST_CHAT_READINESS_GATES.every(id => gates[id].state === 'pass');
    result.lastSafeDiagnostic = TEST_CHAT_READINESS_GATES.map(id => gates[id]).find(g => g.state !== 'pass')?.code ?? null;
    return result;
    } finally { policyFence.close(); }
  });
}

/** Record a legitimate independent review, never manufacture review or supplier evidence. No provider calls or budget writes. */
export async function importTestChatApproval(value: TestChatApprovalImport, actor: string): Promise<TestChatApprovalReceipt> {
  const input = readTestChatApprovalImport(value);
  if (!input) throw new QubaxAdminReviewError('invalid', 400);
  if (!qubaxReviewerKeys(actor).size) throw new QubaxAdminReviewError('trust-unavailable');
  const review = verifyQubaxReview(input.attestation, actor, Date.now());
  if (!review || review.requestId !== input.action.requestId) throw new QubaxAdminReviewError('review-invalid');
  const db = getServerDb(); if (!db) throw new QubaxAdminReviewError('storage-unavailable', 503);
  const payload = testChatPayload(input.action), uid = testChatUid(actor);
  try {
    return await db.runTransaction(async tx => {
      const now = Date.now();
      const catalog = (await tx.get(db.doc(QUBAX_CATALOG_PATH))).data();
      const selection = selectQubaxCandidate(catalog, qubaxWorkload(payload.body), now);
      if (!selection || !verifyQubaxCatalogPublication(catalog, now)) throw new QubaxAdminReviewError('catalog-unavailable');
      const cfg = qubaxConfig(); if (!cfg.enabled || !cfg.apiKey) throw new QubaxAdminReviewError('catalog-unavailable');
      const binding = qubaxChatBinding(uid, payload.body, selection, process.env, testChatRequestId(input.action));
      const currentReview = verifyQubaxReview(input.attestation, actor, now);
      if (!currentReview || review.approvalId !== binding.id || review.payloadDigest !== binding.payloadDigest
        || review.model !== selection.modelId || review.modelRevision !== selection.modelRevision || review.evidenceBinding !== selection.evidenceBinding
        || review.maximumNanoUsd !== selection.maximumNanoUsd || review.expiresAtMs > selection.expiresAtMs) throw new QubaxAdminReviewError('review-invalid');
      const ref = db.doc(`qubax_chat_approvals/${binding.id}`);
      if ((await tx.get(ref)).exists) throw new QubaxAdminReviewError('approval-conflict');
      const approved = { kind: 'qubax-exact-data-approval-v1', state: 'approved', uid, payloadDigest: binding.payloadDigest, gateway: binding.gateway,
        dataReview: review.dataReview, supplierContract: { currency: 'USD', hardCeilingEnforced: true, includesInternalRetriesFailoversAndFees: true,
          // This reference binds to already validated server catalog evidence. The signer cannot supply or change its ceiling.
          evidenceRef: `catalog-sha256:${qubaxCatalogDigest(catalog)}`, perHttpRequestCeilingNanoUsd: selection.maximumNanoUsd },
        reviewedAtMs: review.reviewedAtMs, expiresAtMs: review.expiresAtMs, importedReview: { actor, attestation: input.attestation } };
      if (!qubaxConfig().enabled || qubaxChatBinding(uid, payload.body, selection, process.env, testChatRequestId(input.action)).id !== binding.id
        || JSON.stringify(selectQubaxCandidate(catalog, qubaxWorkload(payload.body), Date.now())) !== JSON.stringify(selection)) throw new QubaxAdminReviewError('review-invalid');
      if (qubaxReviewedApprovalCeiling(approved, { uid, binding, selection, ...payload, requestId: testChatRequestId(input.action), now: Date.now() }) === undefined) throw new QubaxAdminReviewError('review-invalid');
      tx.create(ref, approved);
      // Atomically archived proof for historical verification; public keys are never restored as live trust roots. No prompts or credentials.
      const signer = qubaxReviewerKeys(actor).get(input.attestation.keyId)!;
      const signerPublicKeyPem = signer.key.export({ type: 'spki', format: 'pem' }).toString();
      tx.create(db.doc(`${QUBAX_REVIEW_AUDIT_COLLECTION}/payload_${binding.id}`), { kind: 'payload-import', actorHash: sha(actor), keyId: input.attestation.keyId,
        purpose: 'qubax-exact-payload-v1', attestation: input.attestation, signerPublicKeyPem, signerFingerprint: sha(signerPublicKeyPem),
        reviewDigest: sha(input.attestation.payload), approvalId: binding.id, atMs: now, expiresAtMs: review.expiresAtMs });
      return { imported: true as const, requestId: input.action.requestId, expiresAtMs: review.expiresAtMs, noProviderCall: true as const, noFallback: true as const };
    });
  } catch (error) { if (error instanceof QubaxAdminReviewError) throw error; throw new QubaxAdminReviewError('storage-unavailable', 503); }
}

/** Separate reviewer purpose; compare-and-create publication prevents replay, stale overwrite and timestamp refresh. */
export async function importTestChatCatalog(value: TestChatApprovalImport, actor: string): Promise<TestChatApprovalReceipt> {
  const input = readTestChatApprovalImport(value, 128_000);
  if (!input) throw new QubaxAdminReviewError('invalid', 400);
  const trusted = qubaxReviewerKeys(actor, process.env, 'qubax-catalog-review-v1').get(input.attestation.keyId);
  if (!trusted) throw new QubaxAdminReviewError('trust-unavailable');
  let signed: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.attestation.payload);
    if (!object(parsed) || Object.keys(parsed).sort().join(',') !== 'catalog,expiresAtMs,kind,previousCatalogDigest,reviewedAtMs'
      || parsed.kind !== 'qubax-admin-catalog-review-v1' || canonicalQubaxReview(parsed) !== input.attestation.payload
      || (parsed.previousCatalogDigest !== null && (typeof parsed.previousCatalogDigest !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.previousCatalogDigest)))
      || !Number.isSafeInteger(parsed.reviewedAtMs) || !Number.isSafeInteger(parsed.expiresAtMs)
      || !isQubaxCatalogImportShape(parsed.catalog)
      || !verifyQubaxCatalogPublication({ ...parsed.catalog, publication: { actor, attestation: input.attestation } }, Date.now())) throw new Error('invalid');
    signed = parsed;
  } catch { throw new QubaxAdminReviewError('review-invalid'); }
  const db = getServerDb(); if (!db) throw new QubaxAdminReviewError('storage-unavailable', 503);
  try {
    return await db.runTransaction(async tx => {
      const now = Date.now(), catalog = signed.catalog as Record<string, unknown>;
      const selection = selectQubaxCandidate(catalog, qubaxWorkload(testChatPayload(input.action).body), now);
      if (!verifyQubaxCatalogPublication({ ...catalog, publication: { actor, attestation: input.attestation } }, now)
        || Number(signed.reviewedAtMs) > now || Number(signed.expiresAtMs) <= now || Number(signed.expiresAtMs) > Number(signed.reviewedAtMs) + 300_000
        || !selection || Number(signed.expiresAtMs) > selection.expiresAtMs
        || new Set((catalog.candidates as { modelId: string }[]).map(c => c.modelId)).size !== (catalog.candidates as unknown[]).length
        || !(catalog.candidates as unknown[]).every(entry => selectQubaxCandidate({ ...catalog, candidates: [entry] }, qubaxWorkload(testChatPayload(input.action).body), now))) throw new QubaxAdminReviewError('review-invalid');
      const ref = db.doc(QUBAX_CATALOG_PATH), previous = (await tx.get(ref)).data();
      if (qubaxCatalogDigest(previous) !== signed.previousCatalogDigest
        || (previous && (!Number.isSafeInteger(previous.observedAtMs) || Number(catalog.observedAtMs) <= previous.observedAtMs))) throw new QubaxAdminReviewError('catalog-conflict');
      const digest = sha(input.attestation.payload), auditRef = db.doc(`${QUBAX_REVIEW_AUDIT_COLLECTION}/catalog_${digest}`);
      if ((await tx.get(auditRef)).exists) throw new QubaxAdminReviewError('catalog-conflict');
      // A storage wait cannot extend review authority or preserve a revoked deployment key.
      if (!verifyQubaxCatalogPublication({ ...catalog, publication: { actor, attestation: input.attestation } }, Date.now())
        || !selectQubaxCandidate(catalog, qubaxWorkload(testChatPayload(input.action).body), Date.now())) throw new QubaxAdminReviewError('review-invalid');
      // Keep the signed document byte-equivalent in canonical form; no reader may refresh source dates.
      tx.set(ref, { ...catalog, publication: { actor, attestation: input.attestation } });
      const signer = qubaxReviewerKeys(actor, process.env, 'qubax-catalog-review-v1').get(input.attestation.keyId)!;
      const signerPublicKeyPem = signer.key.export({ type: 'spki', format: 'pem' }).toString();
      tx.create(auditRef, { kind: 'catalog-import', actorHash: sha(actor), keyId: input.attestation.keyId, reviewDigest: digest, atMs: now,
        purpose: 'qubax-catalog-review-v1', attestation: input.attestation, signerPublicKeyPem, signerFingerprint: sha(signerPublicKeyPem) });
      return { imported: true as const, requestId: input.action.requestId, expiresAtMs: Number(signed.expiresAtMs), noProviderCall: true as const, noFallback: true as const };
    });
  } catch (error) { if (error instanceof QubaxAdminReviewError) throw error; throw new QubaxAdminReviewError('storage-unavailable', 503); }
}
