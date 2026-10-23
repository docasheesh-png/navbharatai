import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FirestoreInferenceLedger, gatewayLedgerPath, type GatewayAuthorityDocument,
  type GatewayQuotaPolicy } from './firestoreLedger';
import { admissionIntentFor } from './executor';
import type { AdmissionIntent, AuthenticatedRejection, AuthoritativeUsage, DispatchClaim, ExecutionKey, ExecutionSnapshot } from './executor';
import { planInference } from './policy';
import { evidenceBinding, quotaLedgerKey, withoutEvidence } from './profiles';
import type { BudgetAuthorization, Candidate, EvidenceKind, EvidenceRecord, RoutingRequest } from './types';
import { FreeChainStore } from '../FreeChain/store';
import { paidUserDocumentPath } from '../FreeChain/paidLedger';
import { createHash } from 'node:crypto';
import { civilDayWindow } from '../FreeChain/quota';
import { PAID_BUDGET_TIME_ZONE } from '../FreeChain/spendCap';

// Deterministic optimistic transaction simulator, NOT Firestore/emulator contention proof.
// It rejects every read-after-write, retries read-version conflicts, commits writes atomically,
// and can lose a response after commit. It intentionally has no credentials/network transport.
function database() {
  const docs = new Map<string, unknown>();
  const versions = new Map<string, number>();
  let retries = 0;
  let loseNextResponse = false;
  let beforeCommit: (() => void) | undefined;
  let onRead: ((path: string) => void) | undefined;
  const reads: string[] = [];
  let transactions = 0;
  const copy = <T>(v: T): T => structuredClone(v);
  const seed = (path: string, value: unknown) => { docs.set(path, copy(value)); versions.set(path, (versions.get(path) ?? 0) + 1); };
  const doc = (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => copy(docs.get(path)) }) });
  const db = {
    doc,
    async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      transactions++;
      for (let round = 0; round < 100; round++) {
        const read = new Map<string, number>();
        const pending = new Map<string, unknown>();
        const tx = {
          async get(ref: { path: string }) {
            if (pending.size) throw new Error('Firestore transactions require all reads before writes');
            reads.push(ref.path); onRead?.(ref.path);
            read.set(ref.path, versions.get(ref.path) ?? 0);
            const value = copy(docs.get(ref.path));
            return { exists: docs.has(ref.path), data: () => value };
          },
          set(ref: { path: string }, data: unknown) { pending.set(ref.path, copy(data)); return tx; },
          create(ref: { path: string }, data: unknown) {
            if (!read.has(ref.path)) throw new Error('Test requires a prior absence read');
            if (docs.has(ref.path)) throw new Error('Already exists');
            pending.set(ref.path, copy(data)); return tx;
          },
        };
        const result = await fn(tx as unknown as Transaction);
        const hook = beforeCommit; beforeCommit = undefined; hook?.();
        if ([...read].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
        for (const [path, value] of pending) seed(path, value);
        if (loseNextResponse && pending.size) { loseNextResponse = false; throw new Error('Commit response lost'); }
        return result;
      }
      throw new Error('Contention exhausted');
    },
  };
  return { reads, get transactions() { return transactions; }, onRead: (hook: (path: string) => void) => { onRead = hook; },
    db: db as unknown as Pick<Firestore, 'doc' | 'runTransaction'>, docs, seed,
    get retries() { return retries; }, loseResponse: () => { loseNextResponse = true; },
    beforeCommit: (hook: () => void) => { beforeCommit = hook; } };
}
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const MONEY = 1_000_000_000;
function fixture(state = database(), id = 'logical-one', cost = 2 * MONEY, startNow = NOW, principalId = `${id}-principal`) {
  let now = startNow;
  let clock = () => now;
  const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
  const r: RoutingRequest = {
    logicalRequestId: id, nextPhysicalAttemptId: `${id}-physical-1`, payloadDigest: 'a'.repeat(64),
    policyRevision: 'request-policy-v1', termsPolicyId: 'terms-v1', budgetScopeId: 'platform-free',
    principalId, tenantId: `${id}-tenant`, surface: 'chat',
    quality: { tier: 'standard', gateId: 'synthetic-quality', gateVersion: '1' },
    capability: { kind: 'text', inputTokens: 100, outputTokens: 20, streaming: true, systemPrompt: true },
    privacy: { dataClass: 'public', policyId: 'privacy-v1', allowedProcessingRegions: ['synthetic-region'],
      maxRetentionHours: 0, allowTraining: false, allowHumanReview: false },
    payer: { kind: 'platform', ownerId: 'platform-owner' }, mode: 'free-first-authorized-paid',
    createdAtMs: startNow, deadlineAtMs: startNow + 600_000, maxQueueWaitMs: 5000, queueWaitConsumedMs: 0,
    queueEnteredAtMs: startNow, firstOutputTimeoutMs: 1000, attemptTimeoutMs: 5000,
    cancellation: { id: `${id}-cancel`, cancelled: false }, outputVisible: false,
    maxPhysicalAttempts: 4, attempts: [], evidenceRef: `${id}-request-evidence`,
  };
  const key: ExecutionKey = { logicalRequestId: id, principalId: r.principalId, tenantId: r.tenantId, payloadDigest: r.payloadDigest };
  const profile: Candidate['profile'] = {
    id: 'synthetic-profile', version: '1', providerId: 'synthetic-provider', modelId: 'synthetic-model', modelRevision: '1',
    adapterId: 'synthetic-adapter', status: 'approved', serviceClass: 'production', product: 'inference-api',
    surfaces: ['chat'], qualityApprovals: [r.quality], termsApprovals: [r.termsPolicyId],
    capabilities: [{ kind: 'text', maxInputTokens: 1000, maxOutputTokens: 100, maxContextTokens: 1100,
      streaming: true, systemPrompt: true }], credentialOwner: r.payer,
    quotaDimensions: [
      { scope: { providerId: 'synthetic-provider', kind: 'account', id: 'shared-account' }, meter: 'requests/day' },
      { scope: { providerId: 'synthetic-provider', kind: 'model', id: 'synthetic-model' }, meter: 'tokens/minute' },
    ], charging: cost ? 'metered' : 'verified-free-no-overage', evidenceRef: 'synthetic-profile-evidence',
    privacy: { dataClasses: ['public'], training: 'none', humanReview: 'none', retentionHours: 0, processingRegions: ['synthetic-region'] },
  };
  const requestBinding = evidenceBinding(withoutEvidence(r));
  const profileBinding = evidenceBinding(withoutEvidence(profile));
  const candidate: Candidate = { profile,
    quota: { requestBinding, profileBinding, profileId: profile.id, profileVersion: profile.version,
      logicalRequestId: id, dimensions: profile.quotaDimensions.map(d => ({ ...d, required: 10, remaining: 100 })), evidenceRef: `${id}-quota-evidence` },
    availability: { requestBinding, profileBinding, profileId: profile.id, profileVersion: profile.version,
      coolingUntilMs: 0, predictedQueueMs: 0, predictedFirstOutputMs: 100, predictedCompletionMs: 200, evidenceRef: `${id}-availability-evidence` },
    ...(cost ? { price: { requestBinding, profileBinding, logicalRequestId: id, profileId: profile.id, profileVersion: profile.version,
      rateCardVersion: 'synthetic-rate-v1', currency: 'USD' as const, estimatedNanoUsd: cost, ceilingNanoUsd: cost,
      coverage: 'all-request-usage' as const, capability: r.capability, evidenceRef: `${id}-price-evidence` } } : {}),
  };
  const budget: BudgetAuthorization = { id: `${id}-budget`, principalId: r.principalId, tenantId: r.tenantId, logicalRequestId: id,
    payer: r.payer, surface: r.surface, allowedProfileIds: [profile.id], budgetScopeId: r.budgetScopeId,
    periodId: window.key, periodStartsAtMs: window.startAt, periodEndsAtMs: window.resetAt,
    maxAttemptNanoUsd: 10 * MONEY, remainingLogicalRequestNanoUsd: 10 * MONEY, remainingPeriodNanoUsd: 10 * MONEY,
    periodLimitNanoUsd: 10 * MONEY, evidenceRef: `${id}-budget-evidence` };
  const snapshot: ExecutionSnapshot = { revision: 'revision-one', request: r, candidates: [candidate], ...(cost ? { budget } : {}) };
  const authority: GatewayAuthorityDocument = { kind: 'gateway_authority', version: 1, key, snapshot,
    scope: { id: r.budgetScopeId, kind: 'platform-free-fallback' }, logicalLimitNanoUsd: 10 * MONEY, paidPolicyRevision: 1 };
  const evidence = new Map<string, EvidenceRecord>();
  function issue(kind: EvidenceKind, value: { evidenceRef: string }) {
    const record: EvidenceRecord = { kind, binding: evidenceBinding(withoutEvidence(value)), issuedAtMs: startNow - 1,
      expiresAtMs: startNow + 86_400_000, revoked: false };
    evidence.set(value.evidenceRef, record); state.seed(gatewayLedgerPath('evidence', value.evidenceRef), record);
  }
  function seal() {
    issue('request', authority.snapshot.request);
    for (const c of authority.snapshot.candidates) { issue('profile', c.profile); issue('quota', c.quota); issue('availability', c.availability); if (c.price) issue('price', c.price); }
    if (authority.snapshot.budget) issue('budget', authority.snapshot.budget);
    state.seed(gatewayLedgerPath('authority', id), authority);
  }
  seal();
  for (const d of profile.quotaDimensions) {
    const ledgerKey = quotaLedgerKey(d);
    if (!state.docs.has(gatewayLedgerPath('quota-policy', ledgerKey))) {
      const policy: GatewayQuotaPolicy = { kind: 'gateway_quota_policy', version: 1, ledgerKey, revision: 1,
        authority: 'gateway-exclusive', migrationId: 'verified-migration-one', limit: 100,
        window: { id: 'synthetic-period', startsAtMs: startNow - 60_000, endsAtMs: startNow + 86_400_000 } };
      state.seed(gatewayLedgerPath('quota-policy', ledgerKey), policy);
      state.seed(gatewayLedgerPath('quota-state', ledgerKey), { kind: 'gateway_quota_state', version: 1, ledgerKey,
        migrationId: policy.migrationId, held: 0, quarantined: false });
      state.seed(gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, policy.window.id])), {
        kind: 'gateway_quota_period', version: 1, ledgerKey, window: policy.window, spent: 0 });
    }
  }
  if (!state.docs.has('free_chat_chain/paid_budget_policy')) state.seed('free_chat_chain/paid_budget_policy', {
    kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10 * MONEY, updatedAt: startNow, source: 'admin',
  });
  const ledger = new FirestoreInferenceLedger(state.db, { now: () => clock(),
    principal: { principalId: r.principalId, tenantId: r.tenantId },
    platformScope: { id: 'platform-free', ownerId: 'platform-owner' }, adminEmails: () => [] });
  function intent(): AdmissionIntent {
    const plan = planInference({ ...authority.snapshot, nowMs: now, authority: { lookup: ref => evidence.get(ref) } });
    if (plan.kind !== 'plan') throw new Error(`Fixture is ineligible: ${plan.reason}`);
    return admissionIntentFor(key, authority.snapshot, plan);
  }
  async function reserve() { const i = intent(); const held = await ledger.reserve(i); if (held.kind !== 'held') throw new Error('Fixture reserve denied'); return { intent: i, reservation: held.reservation }; }
  async function claim() { const held = await reserve(); const result = await ledger.claim(held.reservation, held.intent, now - startNow);
    if (result.kind !== 'claimed') throw new Error('Fixture claim denied'); return { ...held, claim: result.claim }; }
  function usage(claim: DispatchClaim, actual = cost / 2, ref = `${id}-usage`): Extract<AuthoritativeUsage, { actualNanoUsd: number }> {
    const u: Extract<AuthoritativeUsage, { actualNanoUsd: number }> = { evidenceRef: ref, binding: claim.binding, final: true, outcome: { kind: 'completed' },
      outputVisible: false, actualNanoUsd: actual, quotaUsage: claim.binding.quota.map(q => ({ ledgerKey: q.ledgerKey, amount: q.amount / 2 })) };
    state.seed(gatewayLedgerPath('usage', ref), { kind: 'gateway_usage', version: 1, usage: u }); return u;
  }
  function updateRequest(patch: Partial<RoutingRequest>) {
    const next = { ...authority.snapshot.request, ...patch };
    const binding = evidenceBinding(withoutEvidence(next));
    authority.snapshot = { ...authority.snapshot, request: next, candidates: authority.snapshot.candidates.map(c => ({ ...c,
      quota: { ...c.quota, requestBinding: binding }, availability: { ...c.availability, requestBinding: binding },
      ...(c.price ? { price: { ...c.price, requestBinding: binding } } : {}) })) };
    seal();
  }
  function nextAttempt() {
    const logical = state.docs.get(gatewayLedgerPath('logical', id)) as { attempts: RoutingRequest['attempts']; queueWaitConsumedMs: number };
    updateRequest({ attempts: logical.attempts, nextPhysicalAttemptId: `${id}-physical-${logical.attempts.length + 1}`,
      queueWaitConsumedMs: logical.queueWaitConsumedMs, queueEnteredAtMs: now });
  }
  const day = () => state.docs.get(`free_chat_chain/paid_day_${window.key}`) as Record<string, unknown> | undefined;
  return { state, ledger, key, authority, seal, intent, reserve, claim, usage, day, window, nextAttempt, updateRequest, clock: (read: () => number) => { clock = read; }, now: (n: number) => { now = n; } };
}

function rejection(f: ReturnType<typeof fixture>, claim: DispatchClaim, ref = `${claim.binding.physicalAttemptId}-rejected`): AuthenticatedRejection {
  const proof: AuthenticatedRejection = { evidenceRef: ref, binding: claim.binding, kind: 'http-rejected',
    status: 429, generationRejected: true, outputVisible: false, receivedAtMs: NOW };
  f.state.seed(gatewayLedgerPath('rejection', ref), { kind: 'gateway_rejection', version: 1, rejection: proof });
  return proof;
}

function conservative(f: ReturnType<typeof fixture>, claim: DispatchClaim, ceiling = MONEY, ref = 'ceiling-proof'): AuthoritativeUsage {
  const { actualNanoUsd: _actual, ...common } = f.usage(claim, ceiling, ref);
  const usage = { ...common, chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: ceiling,
    rateCardVersion: 'synthetic-rate-v1' } as unknown as AuthoritativeUsage;
  f.state.seed(gatewayLedgerPath('usage', ref), { kind: 'gateway_usage', version: 1, usage }); return usage;
}
describe('inactive Firestore inference ledger', () => {
  it('books conservative ceilings distinctly and replaces exact usage once after lost responses', async () => {
    const f = fixture(); const h = await f.claim(); const upper = conservative(f, h.claim);
    f.state.loseResponse(); await expect(f.ledger.settle(h.claim, upper)).rejects.toThrow('Commit response lost');
    await f.ledger.settle(h.claim, upper);
    expect(f.day()).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: MONEY, pending: 0, conservativePending: 1 });
    expect(f.day()).not.toHaveProperty('expiresAt');
    expect(f.state.docs.get(gatewayLedgerPath('attempt', h.claim.binding.physicalAttemptId))).toMatchObject({
      settlement: { chargeBasis: 'conservative-ceiling', bookedNanoUsd: MONEY } });
    const actual = f.usage(h.claim, MONEY / 2, 'actual-proof');
    f.state.loseResponse(); await expect(f.ledger.reconcileActual(h.claim, actual)).rejects.toThrow('Commit response lost');
    await f.ledger.reconcileActual(h.claim, actual); await f.ledger.settle(h.claim, upper);
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY / 2, heldNanoUsd: 0, pending: 0, conservativePending: 0 });
    expect(f.day()).toHaveProperty('expiresAt');
    await expect(f.ledger.reconcileActual(h.claim, f.usage(h.claim, 0, 'second-actual'))).rejects.toThrow();
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY / 2 });
  });
  it('rejects mixed, malformed, wrong-rate-card and untrusted conservative evidence without refunds', async () => {
    for (const patch of [{ actualNanoUsd: 0 }, { actualNanoUsd: undefined }, { conservativeCeilingNanoUsd: -1 }, { rateCardVersion: 'wrong-rate' }, { chargeBasis: 'estimate' }]) {
      const f = fixture(); const h = await f.claim(); const good = conservative(f, h.claim);
      const usage = { ...good, ...patch } as AuthoritativeUsage;
      f.state.seed(gatewayLedgerPath('usage', usage.evidenceRef), { kind: 'gateway_usage', version: 1, usage });
      await expect(f.ledger.settle(h.claim, usage)).rejects.toThrow();
      expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, spentNanoUsd: 0, pending: 1 });
    }
    const f = fixture(); const h = await f.claim(); const upper = conservative(f, h.claim);
    f.state.docs.delete(gatewayLedgerPath('usage', upper.evidenceRef));
    await expect(f.ledger.settle(h.claim, upper)).rejects.toThrow();
  });
  it('preserves old 429 holds and newer slots when conservative and exact settlement race', async () => {
    const f = fixture(); const old = await f.claim();
    await f.ledger.retainRejectedForRetry(old.claim, rejection(f, old.claim));
    f.nextAttempt(); const current = await f.claim(); const upper = conservative(f, current.claim);
    await f.ledger.settle(current.claim, upper);
    const actual = f.usage(current.claim, MONEY / 2, 'current-actual');
    const older = f.usage(old.claim, MONEY / 4, 'old-actual');
    await Promise.all([f.ledger.reconcileActual(current.claim, actual), f.ledger.settle(old.claim, older), f.ledger.reconcileActual(current.claim, actual)]);
    expect(f.day()).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: MONEY * 3 / 4, pending: 0, conservativePending: 0 });
    for (const q of old.claim.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: 0 });
  });
  it('keeps unresolved conservative days through legacy writes and reconciles on the original day', async () => {
    const f = fixture(); const h = await f.claim(); await f.ledger.settle(h.claim, conservative(f, h.claim));
    const legacy = new FreeChainStore(f.state.db, { adminEmails: () => [] });
    const reservation = await legacy.reservePaid({ requestId: 'legacy-beside-ceiling', uid: 'legacy', maxCostNanoUsd: MONEY }, NOW);
    expect(reservation).not.toBeNull();
    expect(f.day()).toMatchObject({ conservativePending: 1 }); expect(f.day()).not.toHaveProperty('expiresAt');
    f.now(NOW + 86_400_000);
    await f.ledger.reconcileActual(h.claim, f.usage(h.claim, MONEY / 2, 'next-day-actual'));
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY / 2, heldNanoUsd: MONEY, pending: 1, conservativePending: 0 });
    expect(f.day()).not.toHaveProperty('expiresAt');
    const nextDay = civilDayWindow(NOW + 86_400_000, PAID_BUDGET_TIME_ZONE);
    expect(f.state.docs.get(`free_chat_chain/paid_day_${nextDay.key}`)).toBeUndefined();
  });
  it('records actual liability above the conservative bound and quarantines without double counting', async () => {
    const f = fixture(); const h = await f.claim(); await f.ledger.settle(h.claim, conservative(f, h.claim));
    const actual = f.usage(h.claim, MONEY * 3 / 2, 'bound-violated');
    await f.ledger.reconcileActual(h.claim, actual); await f.ledger.reconcileActual(h.claim, actual);
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY * 3 / 2, heldNanoUsd: 0, conservativePending: 0 });
    expect(f.state.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ capNanoUsd: 0, source: 'safety', revision: 2 });
    expect(f.state.docs.get(gatewayLedgerPath('incident', h.claim.binding.physicalAttemptId))).toMatchObject({
      violation: { cost: 'maximum-cost-exceeded' } });
  });
  it('never accepts replacement without a prior conservative booking or its durable evidence', async () => {
    const f = fixture(); const h = await f.claim();
    await expect(f.ledger.reconcileActual(h.claim, f.usage(h.claim))).rejects.toThrow();
    const upper = conservative(f, h.claim); await f.ledger.settle(h.claim, upper);
    f.state.docs.delete(gatewayLedgerPath('usage', upper.evidenceRef));
    await expect(f.ledger.reconcileActual(h.claim, f.usage(h.claim, 0, 'cannot-release'))).rejects.toThrow();
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY, conservativePending: 1 });
  });
  it('preserves a newer active slot while replacing an older conservative booking', async () => {
    const f = fixture(); const old = await f.claim();
    await f.ledger.retainRejectedForRetry(old.claim, rejection(f, old.claim));
    f.nextAttempt(); const current = await f.claim();
    const upper = conservative(f, old.claim); await f.ledger.settle(old.claim, upper);
    expect(await f.ledger.readPending(f.key, old.claim.binding.physicalAttemptId)).toBeUndefined();
    expect(await f.ledger.readReconcilable(f.key, old.claim.binding.physicalAttemptId)).toMatchObject({ claim: old.claim });
    await f.ledger.reconcileActual(old.claim, f.usage(old.claim, MONEY / 2, 'old-exact-new-active'));
    expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({
      activeAttemptId: current.claim.binding.physicalAttemptId, heldNanoUsd: 2 * MONEY, spentNanoUsd: MONEY / 2 });
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, spentNanoUsd: MONEY / 2, pending: 1, conservativePending: 0 });
  });
  it('retains the day until every conservative reconciliation finishes, including legacy settlement writes', async () => {
    const state = database(); const a = fixture(state, 'conservative-a'); const b = fixture(state, 'conservative-b');
    const first = await a.claim(); const second = await b.claim();
    await a.ledger.settle(first.claim, conservative(a, first.claim, MONEY, 'ceiling-a'));
    await b.ledger.settle(second.claim, conservative(b, second.claim, MONEY, 'ceiling-b'));
    const legacy = new FreeChainStore(state.db, { adminEmails: () => [] });
    const legacyHold = await legacy.reservePaid({ requestId: 'legacy-settled-after-ceilings', uid: 'legacy', maxCostNanoUsd: MONEY }, NOW);
    expect(legacyHold).not.toBeNull(); expect(await legacy.settlePaid(legacyHold!, 0, NOW)).toBe(true);
    expect(a.day()).toMatchObject({ conservativePending: 2, pending: 0 }); expect(a.day()).not.toHaveProperty('expiresAt');
    await a.ledger.reconcileActual(first.claim, a.usage(first.claim, MONEY / 2, 'actual-a'));
    expect(a.day()).toMatchObject({ conservativePending: 1 }); expect(a.day()).not.toHaveProperty('expiresAt');
    await b.ledger.reconcileActual(second.claim, b.usage(second.claim, MONEY / 2, 'actual-b'));
    expect(a.day()).toMatchObject({ conservativePending: 0 }); expect(a.day()).toHaveProperty('expiresAt');
  });
  it('retains every rejected hold while contention admits only one next attempt', async () => {
    const f = fixture(); const first = await f.claim(); const proof = rejection(f, first.claim);
    await Promise.all(Array.from({ length: 6 }, () => f.ledger.retainRejectedForRetry(first.claim, proof)));
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1, spentNanoUsd: 0 });
    f.nextAttempt(); const intent = f.intent();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.ledger.reserve(intent)));
    expect(results.filter(r => r.kind === 'held')).toHaveLength(1);
    expect(f.day()).toMatchObject({ heldNanoUsd: 4 * MONEY, pending: 2, spentNanoUsd: 0 });
    const logicalPath = gatewayLedgerPath('logical', f.key.logicalRequestId);
    expect(f.state.docs.get(logicalPath)).toMatchObject({ heldNanoUsd: 4 * MONEY, activeAttemptId: intent.binding.physicalAttemptId });
    for (const q of intent.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: 2 * q.amount });
    await f.ledger.retainRejectedForRetry(first.claim, proof);
    expect(f.state.docs.get(logicalPath)).toMatchObject({ activeAttemptId: intent.binding.physicalAttemptId });
    const held = results.find(r => r.kind === 'held')!;
    if (held.kind !== 'held') throw new Error('Missing hold');
    await f.ledger.releaseUndispatched(held.reservation, 'cancelled-before-dispatch');
    expect(f.state.docs.get(logicalPath)).toMatchObject({ heldNanoUsd: 2 * MONEY, activeAttemptId: null });
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('settles old rejected attempts without clearing or refunding newer active holds', async () => {
    const f = fixture(); const first = await f.claim();
    await f.ledger.retainRejectedForRetry(first.claim, rejection(f, first.claim));
    f.nextAttempt(); const second = await f.claim();
    const usage = f.usage(first.claim, MONEY, 'old-rejection-reconciled');
    await f.ledger.settle(first.claim, usage); await f.ledger.settle(first.claim, usage);
    const logicalPath = gatewayLedgerPath('logical', f.key.logicalRequestId);
    expect(f.state.docs.get(logicalPath)).toMatchObject({ heldNanoUsd: 2 * MONEY, spentNanoUsd: MONEY,
      activeAttemptId: second.claim.binding.physicalAttemptId });
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, spentNanoUsd: MONEY, pending: 1 });
    await f.ledger.settle(second.claim, f.usage(second.claim, MONEY, 'new-attempt-reconciled'));
    expect(f.state.docs.get(logicalPath)).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: 2 * MONEY, activeAttemptId: null });
    for (const q of first.claim.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: 0 });
  });
  it('preserves shared daily and per-logical ceilings across pending rejection holds', async () => {
    for (const logicalLimit of [10 * MONEY, 6 * MONEY]) {
      const f = fixture(undefined, `ceiling-${logicalLimit}`, 4 * MONEY);
      f.authority.logicalLimitNanoUsd = logicalLimit;
      f.authority.snapshot.budget!.remainingLogicalRequestNanoUsd = logicalLimit; f.seal();
      const first = await f.claim(); await f.ledger.retainRejectedForRetry(first.claim, rejection(f, first.claim));
      f.nextAttempt();
      if (logicalLimit === 6 * MONEY) expect(await f.ledger.reserve(f.intent())).toEqual({ kind: 'denied' });
      else {
        const second = await f.claim(); await f.ledger.retainRejectedForRetry(second.claim, rejection(f, second.claim));
        f.nextAttempt(); expect(await f.ledger.reserve(f.intent())).toEqual({ kind: 'denied' });
        expect(f.day()).toMatchObject({ heldNanoUsd: 8 * MONEY, spentNanoUsd: 0, pending: 2 });
      }
    }
  });
  it('requires exact durable rejection proof and never opens retries after output or cancellation', async () => {
    for (const gate of ['missing-proof', 'mismatched-binding', 'future-proof', 'visible', 'cancelled', 'terminal'] as const) {
      const f = fixture(undefined, gate); const h = await f.claim(); const proof = rejection(f, h.claim);
      if (gate === 'missing-proof') f.state.docs.delete(gatewayLedgerPath('rejection', proof.evidenceRef));
      if (gate === 'mismatched-binding') proof.binding = { ...proof.binding, profileId: 'another-profile' };
      if (gate === 'future-proof') {
        proof.receivedAtMs = NOW + 1;
        f.state.seed(gatewayLedgerPath('rejection', proof.evidenceRef), { kind: 'gateway_rejection', version: 1, rejection: proof });
      }
      if (gate === 'visible') await f.ledger.markOutputVisible(h.claim);
      if (gate === 'cancelled') await f.ledger.cancel(f.key, f.authority.snapshot.request.cancellation.id);
      if (gate === 'terminal') await f.ledger.retain(h.claim, { physicalAttemptId: h.claim.binding.physicalAttemptId,
        profileId: h.claim.binding.profileId, outcome: 'definite-failure', failureClass: 'safety-refusal', outputVisible: false }, 'refused');
      await expect(f.ledger.retainRejectedForRetry(h.claim, proof)).rejects.toThrow();
      expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
      expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({ activeAttemptId: h.claim.binding.physicalAttemptId });
    }
  });
  it.each([-1, 0.5, 7 * 86400000 + 1])('rejects invalid durable cooldown offset %s without releasing any hold', async delta => {
    const f = fixture(); const h = await f.claim(); const proof = { ...rejection(f, h.claim), cooldownUntilMs: NOW + delta };
    f.state.seed(gatewayLedgerPath('rejection', proof.evidenceRef), { kind: 'gateway_rejection', version: 1, rejection: proof });
    await expect(f.ledger.retainRejectedForRetry(h.claim, proof)).rejects.toThrow();
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
    expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({ activeAttemptId: h.claim.binding.physicalAttemptId });
  });
  it('retains authenticated longer cooldown on replay without double-counting holds', async () => {
    const f = fixture(); const h = await f.claim(); const proof = { ...rejection(f, h.claim), cooldownUntilMs: NOW + 3600000 };
    f.state.seed(gatewayLedgerPath('rejection', proof.evidenceRef), { kind: 'gateway_rejection', version: 1, rejection: proof });
    await f.ledger.retainRejectedForRetry(h.claim, proof); await f.ledger.retainRejectedForRetry(h.claim, proof);
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('blocks output from a rejected old claim and cancellation between attempts without refunding', async () => {
    const f = fixture(); const h = await f.claim(); const proof = rejection(f, h.claim);
    f.state.loseResponse(); await expect(f.ledger.retainRejectedForRetry(h.claim, proof)).rejects.toThrow('Commit response lost');
    await f.ledger.retainRejectedForRetry(h.claim, proof);
    await expect(f.ledger.markOutputVisible(h.claim)).rejects.toThrow();
    await f.ledger.cancel(f.key, f.authority.snapshot.request.cancellation.id);
    f.nextAttempt(); expect(await f.ledger.reserve(f.intent())).toEqual({ kind: 'denied' });
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('keeps free-tier quota occupied and enforces the physical-attempt bound', async () => {
    const f = fixture(undefined, 'free-rejections', 0);
    for (let i = 0; i < 4; i++) {
      const h = await f.claim(); await f.ledger.retainRejectedForRetry(h.claim, rejection(f, h.claim));
      for (const q of h.claim.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: (i + 1) * q.amount });
      f.nextAttempt();
    }
    expect(() => f.intent()).toThrow('Fixture is ineligible');
    expect(f.day()).toBeUndefined();
    const g = fixture(undefined, 'quota-full-rejections', 0); const h = await g.claim();
    await g.ledger.retainRejectedForRetry(h.claim, rejection(g, h.claim));
    for (const q of h.claim.binding.quota) {
      const path = gatewayLedgerPath('quota-policy', q.ledgerKey);
      g.state.seed(path, { ...(g.state.docs.get(path) as object), limit: q.amount });
    }
    g.nextAttempt(); expect(await g.ledger.reserve(g.intent())).toEqual({ kind: 'denied' });
  });
  it('retries cancellation contention without releasing a rejected claim slot', async () => {
    const f = fixture(); const h = await f.claim(); const proof = rejection(f, h.claim);
    const path = gatewayLedgerPath('logical', f.key.logicalRequestId);
    f.state.beforeCommit(() => f.state.seed(path, { ...(f.state.docs.get(path) as object), cancelled: true }));
    await expect(f.ledger.retainRejectedForRetry(h.claim, proof)).rejects.toThrow();
    expect(f.state.retries).toBeGreaterThan(0);
    expect(f.state.docs.get(path)).toMatchObject({ cancelled: true, activeAttemptId: h.claim.binding.physicalAttemptId, heldNanoUsd: 2 * MONEY });
  });
  it('settles concurrent pending attempts exactly once while keeping a newer held slot', async () => {
    const f = fixture(); const first = await f.claim(); const firstProof = rejection(f, first.claim);
    await f.ledger.retainRejectedForRetry(first.claim, firstProof);
    f.nextAttempt(); const second = await f.claim(); await f.ledger.retainRejectedForRetry(second.claim, rejection(f, second.claim));
    f.nextAttempt(); const third = await f.reserve();
    const a = f.usage(first.claim, MONEY, 'reconcile-a'); const b = f.usage(second.claim, MONEY, 'reconcile-b');
    await Promise.all([f.ledger.settle(first.claim, a), f.ledger.settle(second.claim, b), f.ledger.settle(first.claim, a)]);
    await f.ledger.retainRejectedForRetry(first.claim, firstProof);
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, spentNanoUsd: 2 * MONEY, pending: 1 });
    expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({
      heldNanoUsd: 2 * MONEY, spentNanoUsd: 2 * MONEY, activeAttemptId: third.intent.binding.physicalAttemptId });
    await expect(f.ledger.retainRejectedForRetry(first.claim, rejection(f, first.claim, 'conflicting-proof'))).rejects.toThrow();
  });
  it('atomically reserves every quota, the existing shared paid day, and one logical slot', async () => {
    const f = fixture(); const i = f.intent();
    const results = await Promise.all(Array.from({ length: 12 }, () => f.ledger.reserve(i)));
    expect(results.filter(r => r.kind === 'held')).toHaveLength(1);
    expect(f.state.retries).toBeGreaterThan(0);
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1, spentNanoUsd: 0 });
    for (const q of i.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: q.amount });
  });
  it('shares all existing legacy paid holds, across principals and concurrent routers', async () => {
    const state = database(); const a = fixture(state, 'one', 6 * MONEY); const b = fixture(state, 'two', 6 * MONEY);
    const results = await Promise.all([a.ledger.reserve(a.intent()), b.ledger.reserve(b.intent())]);
    expect(results.filter(r => r.kind === 'held')).toHaveLength(1);
    const legacy = new FreeChainStore(state.db, { adminEmails: () => [] });
    expect(await legacy.reservePaid({ requestId: 'legacy-overflow', uid: 'legacy-user', maxCostNanoUsd: 5 * MONEY }, NOW)).toBeNull();
    expect(await legacy.reservePaid({ requestId: 'legacy-fit', uid: 'legacy-user', maxCostNanoUsd: 4 * MONEY }, NOW)).not.toBeNull();
    expect(a.day()).toMatchObject({ heldNanoUsd: 10 * MONEY, pending: 2 });
  });
  it('shares the legacy UID daily guard and commits only one remaining turn across old/new routers', async () => {
    const state = database(); const uid = 'same-authenticated-uid';
    const f = fixture(state, 'shared-user-gateway', MONEY, NOW, uid);
    const uidHash = createHash('sha256').update(uid).digest('hex');
    const path = paidUserDocumentPath(f.window.key, uidHash);
    state.seed(path, { kind: 'paid_user', day: f.window.key, uidHash, requests: 19 });
    const legacy = new FreeChainStore(state.db, { adminEmails: () => [] });
    const [gateway, old] = await Promise.all([f.ledger.reserve(f.intent()), legacy.reservePaid({
      requestId: 'shared-user-legacy', uid, maxCostNanoUsd: MONEY }, NOW)]);
    expect(Number(gateway.kind === 'held') + Number(old !== null)).toBe(1);
    expect(state.docs.get(path)).toMatchObject({ requests: 20 });
    const next = fixture(state, 'same-user-next-request', MONEY, NOW, uid);
    expect(await next.ledger.reserve(next.intent())).toEqual({ kind: 'denied' });
    expect(await legacy.reservePaid({ requestId: 'same-user-legacy-next', uid, maxCostNanoUsd: 1 }, NOW)).toBeNull();
    expect(f.day()).toMatchObject({ pending: 1, heldNanoUsd: MONEY });
  });
  it('keeps released admissions counted in the legacy daily UID guard and rejects corrupt user counters', async () => {
    const f = fixture(); const h = await f.reserve(); const uidHash = createHash('sha256').update(f.key.principalId).digest('hex');
    const path = paidUserDocumentPath(f.window.key, uidHash);
    await f.ledger.releaseUndispatched(h.reservation, 'queue-failed');
    expect(f.state.docs.get(path)).toMatchObject({ requests: 1 });
    const g = fixture(); const gHash = createHash('sha256').update(g.key.principalId).digest('hex');
    g.state.seed(paidUserDocumentPath(g.window.key, gHash), { kind: 'paid_user', day: g.window.key, uidHash: 'wrong-identity', requests: 0 });
    expect(await g.ledger.reserve(g.intent())).toEqual({ kind: 'denied' }); expect(g.day()).toBeUndefined();
  });
  it('gives exactly one claim and never releases a replayed receipt after claim', async () => {
    const f = fixture(); const h = await f.reserve();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.ledger.claim(h.reservation, h.intent, 0)));
    expect(results.filter(r => r.kind === 'claimed')).toHaveLength(1);
    await expect(f.ledger.releaseUndispatched(h.reservation, 'cancelled')).rejects.toThrow();
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('retains uncertain commits and denies a fresh admission or claim right on replay', async () => {
    const f = fixture(); const i = f.intent(); f.state.loseResponse();
    await expect(f.ledger.reserve(i)).rejects.toThrow('Commit response lost');
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' });
    expect(f.day()).toMatchObject({ pending: 1 });
    const g = fixture(undefined, 'claim-lost'); const h = await g.reserve(); g.state.loseResponse();
    await expect(g.ledger.claim(h.reservation, h.intent, 0)).rejects.toThrow('Commit response lost');
    expect(await g.ledger.claim(h.reservation, h.intent, 0)).toEqual({ kind: 'denied' });
    expect(await g.ledger.readPending(g.key, h.intent.binding.physicalAttemptId)).toMatchObject({ record: { outcome: 'uncertain' } });
  });
  it('denies lower/zero or changed policy revisions at claim without dropping existing holds', async () => {
    const f = fixture(); const h = await f.reserve();
    f.state.seed('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 2,
      capNanoUsd: 0, updatedAt: NOW, source: 'admin' });
    expect(await f.ledger.claim(h.reservation, h.intent, 0)).toEqual({ kind: 'denied' });
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY });
  });
  it('retries a transaction whose current authority/evidence changed before commit', async () => {
    const f = fixture(); const i = f.intent();
    const path = gatewayLedgerPath('evidence', i.candidate.profile.evidenceRef);
    f.state.beforeCommit(() => f.state.seed(path, { ...(f.state.docs.get(path) as object), revoked: true }));
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' });
    expect(f.state.retries).toBeGreaterThan(0); expect(f.day()).toBeUndefined();
  });
  it.each(['funded-builder', 'tenant-byok'] as const)('fails closed for unimplemented %s spend authority', async kind => {
    const f = fixture(); const i = f.intent(); f.authority.scope = { id: 'platform-free', kind }; f.seal();
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' }); expect(f.day()).toBeUndefined();
  });
  it('requires explicit exclusive gateway quota migration, never a fresh empty allowance', async () => {
    const f = fixture(); const i = f.intent(); const path = gatewayLedgerPath('quota-policy', i.binding.quota[0].ledgerKey);
    f.state.seed(path, { ...(f.state.docs.get(path) as object), authority: 'legacy-free-chain' });
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' });
    const g = fixture(); g.state.docs.delete(gatewayLedgerPath('quota-state', g.intent().binding.quota[0].ledgerKey));
    expect(await g.ledger.reserve(g.intent())).toEqual({ kind: 'denied' });
  });
  it('persists cancellation before admission and across stale trusted snapshots', async () => {
    const f = fixture(); const i = f.intent(); await f.ledger.cancel(f.key, i.request.cancellation.id);
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' });
    const g = fixture(); const h = await g.reserve(); await g.ledger.cancel(g.key, h.intent.request.cancellation.id);
    expect(await g.ledger.claim(h.reservation, h.intent, 0)).toEqual({ kind: 'denied' });
    expect(g.day()).toMatchObject({ pending: 1 });
  });
  it('settles authenticated final usage once and cannot reuse receipt on a different attempt', async () => {
    const f = fixture(); const h = await f.claim(); const u = f.usage(h.claim);
    await Promise.all([f.ledger.settle(h.claim, u), f.ledger.settle(h.claim, u)]);
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY, heldNanoUsd: 0, pending: 0 });
    await expect(f.ledger.settle(h.claim, { ...u, actualNanoUsd: 0 })).rejects.toThrow();
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY });
    expect(await f.ledger.readPending(f.key, h.claim.binding.physicalAttemptId)).toBeUndefined();
  });
  it('preserves refusal and visible output when late uncertain or contradictory settlement arrives', async () => {
    const f = fixture(); const h = await f.claim(); await f.ledger.markOutputVisible(h.claim);
    const identity = { physicalAttemptId: h.claim.binding.physicalAttemptId, profileId: h.claim.binding.profileId, outputVisible: false };
    await f.ledger.retain(h.claim, { ...identity, outcome: 'definite-failure', failureClass: 'safety-refusal' }, 'refusal');
    await f.ledger.retain(h.claim, { ...identity, outcome: 'uncertain' }, 'late timeout');
    expect(await f.ledger.readPending(f.key, identity.physicalAttemptId)).toMatchObject({ record: {
      outcome: 'definite-failure', failureClass: 'safety-refusal', outputVisible: true } });
    const u = f.usage(h.claim); await f.ledger.settle(h.claim, u);
    await f.ledger.retain(h.claim, { ...identity, outcome: 'uncertain' }, 'lost response');
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY, heldNanoUsd: 0 });
    expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({ outputVisible: true, terminal: true });
  });
  it('records full overage and quarantines shared spend plus gateway account/profile atomically', async () => {
    const f = fixture(); const h = await f.claim(); const u = f.usage(h.claim, 3 * MONEY);
    const violation = { cost: 'maximum-cost-exceeded' as const, quotaLedgerKeys: [] };
    await Promise.all([f.ledger.settleAndQuarantine(h.claim, u, violation), f.ledger.settleAndQuarantine(h.claim, u, violation)]);
    expect(f.day()).toMatchObject({ spentNanoUsd: 3 * MONEY, heldNanoUsd: 0, pending: 0 });
    expect(f.state.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ source: 'safety', capNanoUsd: 0, revision: 2 });
    const legacy = new FreeChainStore(f.state.db, { adminEmails: () => [] });
    expect(await legacy.reservePaid({ requestId: 'legacy-after-incident', uid: 'other', maxCostNanoUsd: 1 }, NOW)).toBeNull();
    expect([...f.state.docs.keys()].filter(p => p.includes('/gateway_incident_'))).toHaveLength(1);
    for (const q of h.claim.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ quarantined: true });
  });
  it('unexpected free charges persist liability and block free gateway calls even after budget is raised', async () => {
    const state = database(); const f = fixture(state, 'free-incident', 0); const h = await f.claim(); const u = f.usage(h.claim, 17);
    await f.ledger.settleAndQuarantine(h.claim, u, { cost: 'unexpected-free-charge', quotaLedgerKeys: [] });
    expect(f.day()).toMatchObject({ spentNanoUsd: 17 });
    const legacy = new FreeChainStore(state.db, { adminEmails: () => [] });
    expect(await legacy.setPaidBudgetPolicy({ capNanoUsd: 10 * MONEY, expectedRevision: 2, actorUid: 'admin', reason: 'Restored reviewed monetary cap' }, NOW)).toMatchObject({ ok: true });
    const next = fixture(state, 'free-next', 0); expect(await next.ledger.reserve(next.intent())).toEqual({ kind: 'denied' });
  });
  it('does not expire pending holds or permit an attempt reserved before IST midnight to dispatch after it', async () => {
    const f = fixture(); const h = await f.reserve(); f.now(f.window.resetAt + 1);
    expect(await f.ledger.claim(h.reservation, h.intent, 0)).toEqual({ kind: 'denied' });
    for (const [path, value] of f.state.docs) if (path.includes('gateway_') || path.includes('paid_day_')) {
      expect(value).not.toHaveProperty('expiresAt'); expect(value).not.toHaveProperty('expireAt');
    }
    expect(f.day()).toMatchObject({ heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('does not authorize an arbitrary request-provided accounting period or substituted principal', async () => {
    const f = fixture(); const i = f.intent();
    await expect(f.ledger.reserve({ ...i, binding: { ...i.binding, key: { ...i.binding.key, principalId: 'attacker' } } })).resolves.toEqual({ kind: 'denied' });
    const fakeBudget = { ...f.authority.snapshot.budget!, periodId: 'invented-fresh-day' };
    f.authority.snapshot = { ...f.authority.snapshot, budget: fakeBudget }; f.seal();
    expect(await f.ledger.reserve(f.intent())).toEqual({ kind: 'denied' });
  });
  it('persists actual transaction queue time rather than requiring equality with a stale caller clock', async () => {
    const f = fixture(); const h = await f.reserve();
    f.state.onRead(() => f.now(NOW + 25));
    const result = await f.ledger.claim(h.reservation, h.intent, 0);
    expect(result).toMatchObject({ kind: 'claimed', claim: { queueWaitConsumedAtDispatchMs: 25 } });
    expect(f.state.docs.get(gatewayLedgerPath('logical', f.key.logicalRequestId))).toMatchObject({ queueWaitConsumedMs: 25 });
  });
  it.each(['queue', 'deadline', 'quota-window', 'ist-day'] as const)('rechecks the %s boundary crossed during transaction reads', async boundary => {
    const start = boundary === 'ist-day' ? Date.parse('2026-10-22T18:29:59.900Z') : NOW;
    const f = fixture(database(), `boundary-${boundary}`, 2 * MONEY, start);
    if (boundary === 'deadline') {
      f.authority.snapshot = { ...f.authority.snapshot, candidates: f.authority.snapshot.candidates.map(c => ({ ...c,
        availability: { ...c.availability, predictedFirstOutputMs: 10, predictedCompletionMs: 20 } })) };
      f.updateRequest({ deadlineAtMs: start + 50 });
    }
    if (boundary === 'quota-window') for (const q of f.intent().binding.quota) {
      const policyPath = gatewayLedgerPath('quota-policy', q.ledgerKey);
      const policy = f.state.docs.get(policyPath) as GatewayQuotaPolicy;
      const window = { ...policy.window, endsAtMs: start + 50 };
      f.state.seed(policyPath, { ...policy, window });
      f.state.seed(gatewayLedgerPath('quota-period', evidenceBinding([q.ledgerKey, window.id])), {
        kind: 'gateway_quota_period', version: 1, ledgerKey: q.ledgerKey, window, spent: 0 });
    }
    const held = await f.reserve();
    f.state.onRead(path => { if (path.includes('gateway_evidence_')) f.now(boundary === 'ist-day' ? f.window.resetAt + 1 : start + (boundary === 'queue' ? 5001 : 51)); });
    expect(await f.ledger.claim(held.reservation, held.intent, 0)).toEqual({ kind: 'denied' });
    expect(f.day()).toMatchObject({ pending: 1, heldNanoUsd: 2 * MONEY });
  });
  it.each(['reserve', 'claim'] as const)('uses one final transaction timestamp for %s, without a midnight split between eligibility and persistence', async operation => {
    const start = Date.parse('2026-10-22T18:29:59.900Z');
    const f = fixture(database(), `single-clock-${operation}`, 2 * MONEY, start);
    const i = f.intent();
    const held = operation === 'claim' ? await f.reserve() : undefined;
    let clockReads = 0;
    f.clock(() => ++clockReads >= 3 ? f.window.resetAt + 1 : start);
    if (operation === 'reserve') {
      const result = await f.ledger.reserve(i); expect(result.kind).toBe('held');
      if (result.kind !== 'held') throw new Error('Expected held admission');
      expect(f.state.docs.get(gatewayLedgerPath('attempt', i.binding.physicalAttemptId))).toMatchObject({ createdAtMs: start });
      await expect(f.ledger.releaseUndispatched(result.reservation, 'crossed-midnight-after-admission')).resolves.toBeUndefined();
    } else {
      const result = await f.ledger.claim(held!.reservation, i, 0);
      expect(result).toMatchObject({ kind: 'claimed', claim: { queueWaitConsumedAtDispatchMs: 0 } });
    }
  });
  it('rechecks trusted time after a retried transaction instead of committing the earlier eligible decision', async () => {
    const f = fixture(); const i = f.intent(); const path = gatewayLedgerPath('evidence', i.candidate.profile.evidenceRef);
    f.state.beforeCommit(() => { f.state.seed(path, f.state.docs.get(path)); f.now(NOW + 5001); });
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' });
    expect(f.state.retries).toBeGreaterThan(0); expect(f.day()).toBeUndefined();
  });
  it('handles a lost settlement response and late retain without double charge or resurrected holds', async () => {
    const f = fixture(); const h = await f.claim(); const u = f.usage(h.claim); f.state.loseResponse();
    await expect(f.ledger.settle(h.claim, u)).rejects.toThrow('Commit response lost');
    await f.ledger.retain(h.claim, { physicalAttemptId: h.claim.binding.physicalAttemptId, profileId: h.claim.binding.profileId,
      outputVisible: false, outcome: 'uncertain' }, 'response-lost');
    await f.ledger.settle(h.claim, u);
    expect(f.day()).toMatchObject({ pending: 0, heldNanoUsd: 0, spentNanoUsd: MONEY });
  });
  it('captures incoming data before asynchronous reads so later caller mutations cannot change the committed authority', async () => {
    const f = fixture(); const i = structuredClone(f.intent()); const pending = f.ledger.reserve(i);
    (i.binding.quota[0] as { amount: number }).amount = 99;
    expect(await pending).toMatchObject({ kind: 'held' });
    const path = gatewayLedgerPath('quota-state', i.binding.quota[0].ledgerKey);
    expect(f.state.docs.get(path)).toMatchObject({ held: 10 });
  });
  it('bounds selected evidence/quota fanout before opening a transaction', async () => {
    const f = fixture(); const i = f.intent();
    const tooMany = { ...i, binding: { ...i.binding, quota: Array.from({ length: 33 }, (_, n) => ({ ledgerKey: `key-${n}`, amount: 1 })) } };
    expect(await f.ledger.reserve(tooMany)).toEqual({ kind: 'denied' }); expect(f.state.transactions).toBe(0);
    const alternate = structuredClone(f.authority.snapshot.candidates[0]);
    f.authority.snapshot = { ...f.authority.snapshot, candidates: [...f.authority.snapshot.candidates,
      { ...alternate, profile: { ...alternate.profile, id: 'not-selected', evidenceRef: 'not-selected-evidence' } }] };
    // This unrelated candidate deliberately has no usable evidence and must cause no extra reads.
    f.state.seed(gatewayLedgerPath('authority', f.key.logicalRequestId), f.authority);
    expect(await f.ledger.reserve(i)).toMatchObject({ kind: 'held' });
    expect(f.state.reads).toHaveLength(13 + 3 * i.binding.quota.length);
    expect(f.state.reads).not.toContain(gatewayLedgerPath('evidence', 'not-selected-evidence'));
  });
  it.each([false, true])('bounds free transaction reads with optional budget evidence=%s, without consuming a paid user turn', async withBudget => {
    const f = fixture(database(), 'free-read-count', 0);
    if (withBudget) {
      const paid = fixture(database(), 'free-read-count');
      f.authority.snapshot = { ...f.authority.snapshot, budget: paid.authority.snapshot.budget }; f.seal();
    }
    const i = f.intent(); expect(await f.ledger.reserve(i)).toMatchObject({ kind: 'held' });
    expect(f.state.reads).toHaveLength(10 + Number(withBudget) + 3 * i.binding.quota.length);
    expect(f.state.reads.some(path => path.includes('/paid_user_'))).toBe(false);
    expect([...f.state.docs.keys()].some(path => path.includes('/paid_user_'))).toBe(false);
  });
  it('denies an exhausted overlapping dimension with no partial cost, slot or other quota hold', async () => {
    const f = fixture(); const i = f.intent(); const path = gatewayLedgerPath('quota-state', i.binding.quota[1].ledgerKey);
    f.state.seed(path, { ...(f.state.docs.get(path) as object), held: 100 });
    expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' }); expect(f.day()).toBeUndefined();
    expect(f.state.docs.get(gatewayLedgerPath('quota-state', i.binding.quota[0].ledgerKey))).toMatchObject({ held: 0 });
    expect(f.state.docs.has(gatewayLedgerPath('logical', f.key.logicalRequestId))).toBe(false);
  });
  it('credits only this exact owned hold, not other callers, at a saturated shared quota', async () => {
    const state = database(); const a = fixture(state, 'owner-a', 0); const b = fixture(state, 'owner-b', 0);
    for (const q of a.intent().binding.quota) {
      const path = gatewayLedgerPath('quota-policy', q.ledgerKey); state.seed(path, { ...(state.docs.get(path) as object), limit: 20 });
    }
    const ah = await a.reserve(); const bh = await b.reserve();
    expect(await b.ledger.claim(ah.reservation, bh.intent, 0)).toEqual({ kind: 'denied' });
    expect(await a.ledger.claim(ah.reservation, ah.intent, 0)).toMatchObject({ kind: 'claimed' });
    expect(await b.ledger.claim(bh.reservation, bh.intent, 0)).toMatchObject({ kind: 'claimed' });
    const c = fixture(state, 'owner-c', 0); expect(await c.ledger.reserve(c.intent())).toEqual({ kind: 'denied' });
  });
  it('releases only a never-claimed reservation, idempotently, without forgetting its attempt tombstone', async () => {
    const f = fixture(); const h = await f.reserve();
    await Promise.all([f.ledger.releaseUndispatched(h.reservation, 'queue-failed'), f.ledger.releaseUndispatched(h.reservation, 'queue-failed')]);
    expect(f.day()).toMatchObject({ pending: 0, heldNanoUsd: 0, spentNanoUsd: 0 });
    expect(await f.ledger.reserve(h.intent)).toEqual({ kind: 'denied' });
    for (const q of h.intent.binding.quota) expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: 0 });
  });
  it('preserves logical-request limits across retryable final attempts independently of daily room', async () => {
    const f = fixture(); f.authority.logicalLimitNanoUsd = 3 * MONEY;
    f.authority.snapshot = { ...f.authority.snapshot, budget: { ...f.authority.snapshot.budget!, remainingLogicalRequestNanoUsd: 3 * MONEY } }; f.seal();
    for (let index = 0; index < 2; index++) {
      const h = await f.claim(); const u = { ...f.usage(h.claim, MONEY, `retry-${index}`),
        outcome: { kind: 'definite-failure' as const, failureClass: 'retryable-provider-failure' as const } };
      f.state.seed(gatewayLedgerPath('usage', u.evidenceRef), { kind: 'gateway_usage', version: 1, usage: u });
      await f.ledger.settle(h.claim, u); f.nextAttempt();
    }
    expect(f.day()).toMatchObject({ spentNanoUsd: 2 * MONEY, heldNanoUsd: 0 });
    expect(await f.ledger.reserve(f.intent())).toEqual({ kind: 'denied' });
  });
  it('enforces a lower authenticated period ceiling against actual shared commitments, not stale remaining', async () => {
    const state = database(); const first = fixture(state, 'period-first', 4 * MONEY); await first.reserve();
    const second = fixture(state, 'period-second', 2 * MONEY);
    second.authority.snapshot = { ...second.authority.snapshot, budget: { ...second.authority.snapshot.budget!,
      periodLimitNanoUsd: 5 * MONEY, remainingPeriodNanoUsd: 5 * MONEY } }; second.seal();
    expect(await second.ledger.reserve(second.intent())).toEqual({ kind: 'denied' });
    expect(second.day()).toMatchObject({ heldNanoUsd: 4 * MONEY, pending: 1 });
  });
  it('does not silently replace missing, corrupted or expiring accounting authority with zero', async () => {
    for (const patch of [{ held: -1 }, { expiresAt: new Date(NOW) }, { migrationId: 'another-migration' }]) {
      const f = fixture(); const i = f.intent(); const path = gatewayLedgerPath('quota-state', i.binding.quota[0].ledgerKey);
      f.state.seed(path, { ...(f.state.docs.get(path) as object), ...patch });
      expect(await f.ledger.reserve(i)).toEqual({ kind: 'denied' }); expect(f.day()).toBeUndefined();
    }
    const f = fixture(); const h = await f.claim(); f.state.docs.delete(`free_chat_chain/paid_day_${f.window.key}`);
    await expect(f.ledger.settle(h.claim, f.usage(h.claim))).rejects.toThrow();
    expect(await f.ledger.readPending(f.key, h.claim.binding.physicalAttemptId)).toBeDefined();
  });
  it('charges full actual quota beyond the hold and quarantines every affected shared gateway scope', async () => {
    const f = fixture(undefined, 'quota-overage', 0); const h = await f.claim();
    const u = { ...f.usage(h.claim, 0), quotaUsage: h.claim.binding.quota.map(q => ({ ledgerKey: q.ledgerKey, amount: q.amount + 7 })) };
    f.state.seed(gatewayLedgerPath('usage', u.evidenceRef), { kind: 'gateway_usage', version: 1, usage: u });
    await expect(f.ledger.settle(h.claim, u)).rejects.toThrow();
    await f.ledger.settleAndQuarantine(h.claim, u, { cost: null, quotaLedgerKeys: u.quotaUsage.map(q => q.ledgerKey) });
    for (const q of u.quotaUsage) {
      expect(f.state.docs.get(gatewayLedgerPath('quota-state', q.ledgerKey))).toMatchObject({ held: 0, quarantined: true });
      expect(f.state.docs.get(gatewayLedgerPath('quota-period', evidenceBinding([q.ledgerKey, 'synthetic-period'])))).toMatchObject({ spent: 17 });
    }
    // A quota-only incident does not invent a monetary charge or change the shared money cap.
    expect(f.day()).toBeUndefined(); expect(f.state.docs.get('free_chat_chain/paid_budget_policy')).toMatchObject({ revision: 1, capNanoUsd: 10 * MONEY });
  });
  it('cannot reuse one authenticated receipt reference for another physical attempt', async () => {
    const state = database(); const a = fixture(state, 'receipt-a'); const b = fixture(state, 'receipt-b');
    const ah = await a.claim(); const bh = await b.claim();
    await a.ledger.settle(ah.claim, a.usage(ah.claim, MONEY, 'unique-provider-receipt'));
    const substituted = b.usage(bh.claim, MONEY, 'unique-provider-receipt');
    await expect(b.ledger.settle(bh.claim, substituted)).rejects.toThrow('Receipt has already been consumed');
    expect(b.day()).toMatchObject({ spentNanoUsd: MONEY, heldNanoUsd: 2 * MONEY, pending: 1 });
  });
  it('serializes a racing cancellation ahead of claim rather than authorizing stale work', async () => {
    const f = fixture(); const h = await f.reserve(); const path = gatewayLedgerPath('logical', f.key.logicalRequestId);
    f.state.beforeCommit(() => f.state.seed(path, { ...(f.state.docs.get(path) as object), cancelled: true }));
    expect(await f.ledger.claim(h.reservation, h.intent, 0)).toEqual({ kind: 'denied' });
    expect(f.state.retries).toBeGreaterThan(0); expect(f.day()).toMatchObject({ pending: 1 });
  });
  it('settles a long-running attempt on its original IST day after midnight without expiring holds', async () => {
    const f = fixture(); const h = await f.claim(); f.now(f.window.resetAt + 1000);
    await f.ledger.settle(h.claim, f.usage(h.claim));
    expect(f.day()).toMatchObject({ spentNanoUsd: MONEY, heldNanoUsd: 0 });
    const tomorrow = civilDayWindow(f.window.resetAt + 1000, PAID_BUDGET_TIME_ZONE);
    expect(f.state.docs.has(`free_chat_chain/paid_day_${tomorrow.key}`)).toBe(false);
  });
  it('has no production imports, default DB initialization or TTL release machinery', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./firestoreLedger.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/getServerDb|process\.env|setTimeout|setInterval/);
  });
});
