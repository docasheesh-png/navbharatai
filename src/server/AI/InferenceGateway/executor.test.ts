import { describe, expect, it, vi } from 'vitest';
import { admissionBinding, createInferenceExecutor, usageCommittedNanoUsd, PLATFORM_FREE_DAILY_LIMIT_NANO_USD } from './executor';
import type { AdapterResult, AdmissionIntent, AuthoritativeUsage, DispatchClaim, ExecutionPorts,
  ExecutionSnapshot, FinalOutcome, PendingAttempt, Reservation, SpendScope } from './executor';
import { planInference } from './policy';
import { evidenceBinding, quotaLedgerKey, withoutEvidence } from './profiles';
import type { BudgetAuthorization, Candidate, CapabilityRequest, CapabilitySupport, EvidenceKind,
  EvidenceRecord, ProviderProfile, RoutingRequest } from './types';

// Entirely synthetic adapters/evidence. This in-process serialized mock is NOT a
// datastore emulator: concurrency tests prove the coordinator uses the atomic port,
// not that Firestore/SQL/Redis transactions, replicas, or provider limits are sound.
const NOW = 1_000_000;
const DAY = 86_400_000;
const generation = { inputTokens: 100, outputTokens: 20, streaming: true, systemPrompt: true };
const support = { maxInputTokens: 1000, maxOutputTokens: 100, maxContextTokens: 1100, streaming: true, systemPrompt: true };
const capabilities: readonly CapabilityRequest[] = [
  { kind: 'text', ...generation },
  { kind: 'tool-json', ...generation, features: ['tool-calls'], schemaDialect: 'fixture-schema' },
  { kind: 'vision-pdf', ...generation, formats: ['application/pdf'], imageCount: 0, pdfPages: 2 },
  { kind: 'voice-session', inputFormat: 'fixture-in', outputFormat: 'fixture-out', bidirectional: true, interruption: true, maxDurationMs: 60_000 },
  { kind: 'embedding', inputTokens: 100, dimensions: 64, vectorSpaceId: 'fixture-space-v1' },
  { kind: 'grounding-search', queries: 2, maxResults: 10, citations: true, domainFiltering: true },
];
const supports: readonly CapabilitySupport[] = [
  { kind: 'text', ...support },
  { kind: 'tool-json', ...support, features: ['tool-calls'], schemaDialects: ['fixture-schema'] },
  { kind: 'vision-pdf', ...support, formats: ['application/pdf'], maxImages: 0, maxPdfPages: 10 },
  { kind: 'voice-session', inputFormats: ['fixture-in'], outputFormats: ['fixture-out'], bidirectional: true, interruption: true, maxDurationMs: 60_000 },
  { kind: 'embedding', maxInputTokens: 1000, dimensions: 64, vectorSpaceId: 'fixture-space-v1' },
  { kind: 'grounding-search', maxQueries: 10, maxResults: 20, citations: true, domainFiltering: true },
];
function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return { logicalRequestId: 'logical-1', nextPhysicalAttemptId: 'attempt-1', principalId: 'principal-1', tenantId: 'tenant-1',
    payloadDigest: 'a'.repeat(64), policyRevision: 'policy-1', termsPolicyId: 'terms-1', budgetScopeId: 'fallback-shared',
    surface: 'chat', quality: { tier: 'standard', gateId: 'synthetic-gate', gateVersion: '1' }, capability: capabilities[0],
    privacy: { dataClass: 'public', policyId: 'privacy-1', allowedProcessingRegions: ['fixture-region'], maxRetentionHours: 0,
      allowTraining: false, allowHumanReview: false }, payer: { kind: 'platform', ownerId: 'platform-1' },
    mode: 'free-first-authorized-paid', createdAtMs: NOW, deadlineAtMs: NOW + 120_000,
    maxQueueWaitMs: 5000, queueWaitConsumedMs: 0, queueEnteredAtMs: NOW, firstOutputTimeoutMs: 1000,
    attemptTimeoutMs: 90_000, cancellation: { id: 'cancel-1', cancelled: false }, outputVisible: false,
    maxPhysicalAttempts: 4, attempts: [], evidenceRef: 'request-ref', ...overrides };
}
function candidate(r: RoutingRequest, id: string, paid: boolean, cost = 2_000_000_000): Candidate {
  const p: ProviderProfile = { id, version: 'profile-1', providerId: 'fixture-provider', modelId: `model-${id}`,
    modelRevision: 'revision-1', adapterId: `adapter-${r.capability.kind}`, status: 'approved', serviceClass: 'production',
    product: 'inference-api', surfaces: [r.surface], qualityApprovals: [r.quality], termsApprovals: [r.termsPolicyId],
    capabilities: [supports.find(c => c.kind === r.capability.kind)!], credentialOwner: r.payer,
    quotaDimensions: [{ scope: { providerId: 'fixture-provider', kind: 'organization', id: 'fixture-org' }, meter: 'requests/day' },
      { scope: { providerId: 'fixture-provider', kind: 'model', id }, meter: 'tokens/minute' }],
    charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: `profile-${id}`,
    privacy: { dataClasses: ['public', 'personal', 'confidential', 'health'], training: 'none', humanReview: 'none',
      retentionHours: 0, processingRegions: ['fixture-region'] } };
  const requestBinding = evidenceBinding(withoutEvidence(r));
  const profileBinding = evidenceBinding(withoutEvidence(p));
  return { profile: p,
    quota: { requestBinding, profileBinding, logicalRequestId: r.logicalRequestId, profileId: id, profileVersion: p.version,
      dimensions: p.quotaDimensions.map(d => ({ ...d, required: 10, remaining: 100 })), evidenceRef: `quota-${id}` },
    availability: { requestBinding, profileBinding, profileId: id, profileVersion: p.version, coolingUntilMs: 0,
      predictedQueueMs: 0, predictedFirstOutputMs: 100, predictedCompletionMs: r.capability.kind === 'voice-session' ? 60_000 : 200,
      evidenceRef: `availability-${id}` },
    ...(paid ? { price: { requestBinding, profileBinding, logicalRequestId: r.logicalRequestId, profileId: id,
      profileVersion: p.version, rateCardVersion: 'synthetic-rate-1', currency: 'USD' as const, estimatedNanoUsd: cost / 2,
      ceilingNanoUsd: cost, coverage: 'all-request-usage' as const, capability: r.capability, evidenceRef: `price-${id}` } } : {}) };
}
function budget(r: RoutingRequest, ids: readonly string[]): BudgetAuthorization {
  return { id: 'budget-1', principalId: r.principalId, tenantId: r.tenantId, logicalRequestId: r.logicalRequestId,
    payer: r.payer, surface: r.surface, allowedProfileIds: ids, budgetScopeId: r.budgetScopeId, periodId: 'fixture-day',
    periodStartsAtMs: 0, periodEndsAtMs: DAY, maxAttemptNanoUsd: 10_000_000_000,
    remainingLogicalRequestNanoUsd: 10_000_000_000, remainingPeriodNanoUsd: 10_000_000_000,
    periodLimitNanoUsd: 10_000_000_000, evidenceRef: 'budget-ref' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 64; i++) await Promise.resolve(); }
function sharedState() {
  return { active: new Set<string>(), budget: new Map<string, number>(), quota: new Map<string, number>(), quarantined: new Set<string>() };
}
function harness(options: { request?: Partial<RoutingRequest>; profiles?: { id: string; paid: boolean; cost?: number }[];
  shared?: ReturnType<typeof sharedState>; scopes?: readonly SpendScope[] } = {}) {
  let now = NOW;
  let timerId = 0;
  let revision = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const records = new Map<string, EvidenceRecord>();
  const events: string[] = [];
  const state = options.shared ?? sharedState();
  const held = new Map<string, { intent: AdmissionIntent; reservation: Reservation; claim?: DispatchClaim; phase: string }>();
  const pending = new Map<string, PendingAttempt>();
  const settled = new Map<string, string>();
  const receipts = new Map<string, AuthoritativeUsage>();
  const profileSpecs = options.profiles ?? [{ id: 'free-a', paid: false }];
  const r = request(options.request);
  let snapshot: ExecutionSnapshot = { revision: String(revision), request: r,
    candidates: profileSpecs.map(p => candidate(r, p.id, p.paid, p.cost)), budget: budget(r, profileSpecs.map(p => p.id)) };
  const key = { logicalRequestId: r.logicalRequestId, principalId: r.principalId, tenantId: r.tenantId, payloadDigest: r.payloadDigest };
  function issue(kind: EvidenceKind, subject: { evidenceRef: string }) {
    records.set(subject.evidenceRef, { kind, binding: evidenceBinding(withoutEvidence(subject)),
      issuedAtMs: now - 100, expiresAtMs: now + 1_000_000, revoked: false });
  }
  function seal() {
    issue('request', snapshot.request);
    for (const c of snapshot.candidates) {
      issue('profile', c.profile); issue('quota', c.quota); issue('availability', c.availability); if (c.price) issue('price', c.price);
    }
    if (snapshot.budget) issue('budget', snapshot.budget);
  }
  seal();
  const scopeKey = (intent: AdmissionIntent) => evidenceBinding([intent.binding.payer, intent.binding.budgetScopeId,
    intent.binding.budget?.periodId ?? 'free']);
  const ports: ExecutionPorts = {
    evidence: { lookup: ref => records.get(ref) },
    controlPlaneTimeoutMs: 1000,
    scopes: options.scopes ?? [{ id: r.budgetScopeId, kind: r.payer.kind === 'tenant' ? 'tenant-byok' : 'platform-free-fallback' }],
    clock: { now: () => now, schedule: (at, callback) => {
      const id = ++timerId; timers.set(id, { at, callback }); return () => { timers.delete(id); };
    } },
    readTrusted: vi.fn(async () => { events.push('read'); return snapshot; }),
    waitReady: vi.fn(async () => { events.push('wait'); }),
    ledger: {
      reserve: vi.fn<ExecutionPorts['ledger']['reserve']>(async intent => {
        events.push('reserve');
        const id = `${intent.binding.key.logicalRequestId}:${intent.binding.physicalAttemptId}`;
        const pool = scopeKey(intent);
        const available = state.budget.get(pool) ?? PLATFORM_FREE_DAILY_LIMIT_NANO_USD;
        const cost = intent.binding.budget?.amountNanoUsd ?? 0;
        if (state.quarantined.has(intent.binding.providerId) || state.active.has(intent.binding.key.logicalRequestId) || held.has(id) || available < cost
          || intent.binding.quota.some(q => (state.quota.get(q.ledgerKey) ?? 100) < q.amount)) return { kind: 'denied' as const };
        // Atomic *mock* critical section: no await between checking and all writes.
        state.active.add(intent.binding.key.logicalRequestId); state.budget.set(pool, available - cost);
        for (const q of intent.binding.quota) state.quota.set(q.ledgerKey, (state.quota.get(q.ledgerKey) ?? 100) - q.amount);
        const reservation = { id, intentBinding: admissionBinding(intent) };
        held.set(id, { intent, reservation, phase: 'held' });
        return { kind: 'held' as const, reservation };
      }),
      claim: vi.fn<ExecutionPorts['ledger']['claim']>(async (reservation, intent, queueWaitConsumedAtDispatchMs) => {
        events.push('claim');
        const saved = held.get(reservation.id)!;
        const decision = planInference({ ...snapshot, authority: ports.evidence, nowMs: now });
        if (!saved || saved.phase !== 'held' || admissionBinding(intent) !== saved.reservation.intentBinding
          || reservation.intentBinding !== saved.reservation.intentBinding || evidenceBinding(withoutEvidence(snapshot.request)) !== intent.binding.requestBinding
          || snapshot.revision !== intent.binding.snapshotRevision || decision.kind !== 'plan') return { kind: 'denied' as const };
        const claim = { ...reservation, claimId: `claim-${reservation.id}`, binding: intent.binding, queueWaitConsumedAtDispatchMs: queueWaitConsumedAtDispatchMs };
        saved.phase = 'claimed'; saved.claim = claim;
        return { kind: 'claimed' as const, claim };
      }),
      releaseUndispatched: vi.fn(async reservation => {
        events.push('release');
        const saved = held.get(reservation.id)!;
        if (!saved || !['held', 'claimed'].includes(saved.phase)) throw new Error('Not exclusively undispatched');
        saved.phase = 'released'; state.active.delete(saved.intent.binding.key.logicalRequestId);
        const pool = scopeKey(saved.intent);
        state.budget.set(pool, state.budget.get(pool)! + (saved.intent.binding.budget?.amountNanoUsd ?? 0));
        for (const q of saved.intent.binding.quota) state.quota.set(q.ledgerKey, state.quota.get(q.ledgerKey)! + q.amount);
      }),
      markOutputVisible: vi.fn(async () => { events.push('output'); }),
      retain: vi.fn(async (claim, record) => {
        if (settled.has(claim.id)) return;
        events.push('retain'); held.get(claim.id)!.phase = 'pending'; pending.set(claim.binding.physicalAttemptId, { claim, record });
      }),
      settle: vi.fn<ExecutionPorts['ledger']['settle']>(async (claim, usage) => {
        events.push('settle');
        if (settled.has(claim.id)) {
          if (settled.get(claim.id) !== usage.evidenceRef) throw new Error('Conflicting settlement');
          return;
        }
        settled.set(claim.id, usage.evidenceRef); pending.delete(claim.binding.physicalAttemptId);
        const saved = held.get(claim.id)!; saved.phase = 'settled'; state.active.delete(claim.binding.key.logicalRequestId);
        const pool = scopeKey(saved.intent);
        state.budget.set(pool, state.budget.get(pool)! + (claim.binding.budget?.amountNanoUsd ?? 0) - usageCommittedNanoUsd(usage)!);
        for (const q of claim.binding.quota) {
          state.quota.set(q.ledgerKey, state.quota.get(q.ledgerKey)! + q.amount - usage.quotaUsage.find(u => u.ledgerKey === q.ledgerKey)!.amount);
        }
        const outcome = usage.outcome;
        const record = outcome.kind === 'completed' ? { physicalAttemptId: claim.binding.physicalAttemptId,
          profileId: claim.binding.profileId, outcome: 'completed' as const, outputVisible: usage.outputVisible }
          : { physicalAttemptId: claim.binding.physicalAttemptId, profileId: claim.binding.profileId,
            outcome: 'definite-failure' as const, failureClass: outcome.failureClass, outputVisible: usage.outputVisible };
        const next = { ...snapshot.request, attempts: [...snapshot.request.attempts, record],
          nextPhysicalAttemptId: `attempt-${snapshot.request.attempts.length + 2}`, queueEnteredAtMs: now,
          queueWaitConsumedMs: claim.queueWaitConsumedAtDispatchMs };
        snapshot = { ...snapshot, revision: String(++revision), request: next,
          // The trusted availability service cools a failed profile; no key rotation.
          candidates: profileSpecs.filter(p => !next.attempts.some(a => a.profileId === p.id))
            .map(p => candidate(next, p.id, p.paid, p.cost)), budget: budget(next, profileSpecs.map(p => p.id)) };
        seal();
      }),
      settleAndQuarantine: vi.fn(async (claim, usage) => {
        // Contract mock only. A production port needs ONE datastore transaction.
        events.push('quarantine'); state.quarantined.add(claim.binding.providerId);
        await ports.ledger.settle(claim, usage);
      }),
      readPending: vi.fn(async (_key, id) => pending.get(id)),
    },
    adapter: { dispatch: vi.fn(async (intent, claim) => {
      events.push('dispatch'); held.get(claim.id)!.phase = 'invoked'; return response(intent, claim);
    }) },
    readAuthoritativeUsage: vi.fn(async (_claim, ref) => { events.push('usage'); return receipts.get(ref); }),
  };
  function response(_intent: AdmissionIntent, claim: DispatchClaim, outcome: FinalOutcome = { kind: 'completed' }, visible = false): AdapterResult {
    const ref = `usage-${claim.id}`;
    receipts.set(ref, { evidenceRef: ref, binding: claim.binding, final: true, outcome, outputVisible: visible,
      actualNanoUsd: (claim.binding.budget?.amountNanoUsd ?? 0) / 2,
      quotaUsage: claim.binding.quota.map(q => ({ ...q, amount: q.amount / 2 })) });
    return { binding: claim.binding, outcome, outputVisible: visible, usageEvidenceRef: ref };
  }
  return { ports, key, events, records, state, held, pending, settled, receipts, response, seal,
    executor: createInferenceExecutor(ports), get snapshot() { return snapshot; }, set snapshot(s: ExecutionSnapshot) { snapshot = s; },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }, timers,
  };
}
const retry: FinalOutcome = { kind: 'definite-failure', failureClass: 'retryable-provider-failure' };

// Synthetic reservation-aware snapshot service. It authenticates the exact mock
// journal receipt before crediting owned holds; the coordinator does no arithmetic.
function useCurrentOwnedCapacity(h: ReturnType<typeof harness>) {
  h.ports.readTrusted = vi.fn(async (_key, reservation) => {
    if (!reservation) return h.snapshot;
    const saved = h.held.get(reservation.id);
    if (!saved || saved.phase !== 'held' || saved.reservation.intentBinding !== reservation.intentBinding) {
      throw new Error('No exclusively owned outstanding hold');
    }
    const binding = saved.intent.binding;
    const pool = evidenceBinding([binding.payer, binding.budgetScopeId, binding.budget?.periodId ?? 'free']);
    h.snapshot = { ...h.snapshot, candidates: h.snapshot.candidates.map(c => ({ ...c, quota: { ...c.quota,
      evidenceRef: `${c.quota.evidenceRef}-fresh`, dimensions: c.quota.dimensions.map(q => {
        const ledgerKey = quotaLedgerKey(q);
        return { ...q, remaining: (h.state.quota.get(ledgerKey) ?? q.remaining)
          + (binding.quota.find(held => held.ledgerKey === ledgerKey)?.amount ?? 0) };
      }) } })), ...(h.snapshot.budget ? { budget: { ...h.snapshot.budget, evidenceRef: 'budget-fresh',
        remainingPeriodNanoUsd: (h.state.budget.get(pool) ?? 0) + (binding.budget?.amountNanoUsd ?? 0) } } : {}) };
    h.seal(); return h.snapshot;
  });
}

describe('inactive coordinator authority and sequencing', () => {
  it('recomputes policy, reserves all dimensions, durably claims, dispatches once, and settles real usage', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] });
    expect(await h.executor.execute(h.key)).toEqual({ kind: 'completed', physicalAttemptId: 'attempt-1', holds: 'settled' });
    expect(h.events).toEqual(['read', 'reserve', 'wait', 'read', 'claim', 'dispatch', 'usage', 'settle']);
    const intent = vi.mocked(h.ports.ledger.reserve).mock.calls[0][0];
    expect(intent.plan.authorizedToDispatch).toBe(false);
    expect(intent.binding.quota).toHaveLength(2);
    expect(intent.binding.budget?.amountNanoUsd).toBe(2_000_000_000);
    expect([...h.state.budget.values()]).toEqual([9_000_000_000]);
    expect([...h.state.quota.values()]).toEqual([95, 95]);
    expect(h.timers.size).toBe(0);
  });
  it.each(['logicalRequestId', 'principalId', 'tenantId', 'payloadDigest'] as const)('rejects a forged key %s before admission', async field => {
    const h = harness();
    expect(await h.executor.execute({ ...h.key, [field]: field === 'payloadDigest' ? 'b'.repeat(64) : 'other' })).toMatchObject({ kind: 'stopped', reason: 'request-binding' });
    expect(h.ports.ledger.reserve).not.toHaveBeenCalled();
  });
  it('does not accept a SelectionPlan in place of authenticated request/evidence', async () => {
    const h = harness(); h.records.delete('request-ref');
    const result = await h.executor.execute({ ...h.key, authorizedToDispatch: true } as typeof h.key);
    expect(result).toMatchObject({ kind: 'stopped', reason: 'evidence' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it.each(capabilities)('supports the exact $kind adapter family without a text-only shortcut', async capability => {
    const h = harness({ request: { capability } });
    expect((await h.executor.execute(h.key)).kind).toBe('completed');
    expect(vi.mocked(h.ports.adapter.dispatch).mock.calls[0][0].request.capability).toEqual(capability);
  });
  it.each(['image-generation', 'image-enhancement'] as const)('preserves the existing %s exclusion', async surface => {
    const h = harness({ request: { surface } });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'image-pipeline-preserved' });
    expect(h.ports.ledger.reserve).not.toHaveBeenCalled();
  });
  it('prefers free before the cheapest quality-compatible paid fallback', async () => {
    const h = harness({ profiles: [{ id: 'paid-expensive', paid: true, cost: 4_000_000_000 },
      { id: 'free-a', paid: false }, { id: 'paid-cheap', paid: true, cost: 1_000_000_000 }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => h.response(intent, claim,
      intent.binding.profileId === 'free-a' ? retry : { kind: 'completed' }));
    expect((await h.executor.execute(h.key)).kind).toBe('completed');
    expect(vi.mocked(h.ports.adapter.dispatch).mock.calls.map(c => c[0].binding.profileId)).toEqual(['free-a', 'paid-cheap']);
  });
  it('cannot turn quota admission denial into blind provider fallback', async () => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'paid-a', paid: true }] });
    h.ports.ledger.reserve = vi.fn(async () => ({ kind: 'denied' as const }));
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'admission-denied-replan-required' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it('retains unknown admission outcome without retrying, releasing, or dispatching', async () => {
    const h = harness(); h.ports.ledger.reserve = vi.fn(async () => { throw new Error('Commit reply lost'); });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation', reason: 'reservation-uncertain' });
    expect(h.ports.ledger.reserve).toHaveBeenCalledTimes(1); expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('cannot dispatch when reservation, profile, tenant, or cost receipt binding differs', async () => {
    const h = harness(); h.ports.ledger.reserve = vi.fn(async () => ({ kind: 'held' as const, reservation: { id: 'other', intentBinding: '{}' } }));
    expect(await h.executor.execute(h.key)).toMatchObject({ reason: 'reservation-binding' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it.each(['profileVersion', 'adapterId', 'budgetScopeId', 'modelRevision'] as const)('rejects substituted dispatch claim %s', async field => {
    const h = harness(); const claim = h.ports.ledger.claim;
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => {
      const result = await claim(...args);
      return result.kind === 'claimed' ? { ...result, claim: { ...result.claim, binding: { ...result.claim.binding, [field]: 'substitution' } } } : result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ reason: 'dispatch-claim-binding' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
});

describe('waiting, cancellation, revocation, and dispatch boundary', () => {
  it('revalidates with exactly its own hold even when the remaining raw quota is zero', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] });
    h.snapshot = { ...h.snapshot, candidates: h.snapshot.candidates.map(c => ({ ...c, quota: { ...c.quota,
      dimensions: c.quota.dimensions.map(q => { h.state.quota.set(quotaLedgerKey(q), 10); return { ...q, remaining: 10 }; }) } })) };
    h.seal(); useCurrentOwnedCapacity(h);
    h.ports.waitReady = vi.fn(async () => { expect([...h.state.quota.values()]).toEqual([0, 0]); });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed', holds: 'settled' });
    const reservation = [...h.held.values()][0].reservation;
    expect(h.ports.readTrusted).toHaveBeenNthCalledWith(2, h.key, reservation);
    expect([...h.state.quota.values()]).toEqual([5, 5]);
    await expect(h.ports.readTrusted(h.key, reservation)).rejects.toThrow('No exclusively owned');
  });
  it('allows unrelated concurrent accounting changes without weakening exact owned holds', async () => {
    const state = sharedState();
    const a = harness({ shared: state, profiles: [{ id: 'paid-a', paid: true }] });
    const b = harness({ shared: state, request: { logicalRequestId: 'logical-other' }, profiles: [{ id: 'paid-a', paid: true }] });
    const gate = deferred<void>(); a.ports.waitReady = vi.fn(() => gate.promise); useCurrentOwnedCapacity(a);
    const run = a.executor.execute(a.key); await flush();
    const reservation = [...a.held.values()][0].reservation;
    await expect(a.ports.readTrusted(a.key, { ...reservation, intentBinding: '{}' })).rejects.toThrow('No exclusively owned');
    expect(await b.executor.execute(b.key)).toMatchObject({ kind: 'completed' });
    gate.resolve(); expect(await run).toMatchObject({ kind: 'completed', holds: 'settled' });
    const original = vi.mocked(a.ports.ledger.reserve).mock.calls[0][0];
    const refreshed = vi.mocked(a.ports.ledger.claim).mock.calls[0][1];
    expect(refreshed.budget?.remainingPeriodNanoUsd).toBe(9_000_000_000);
    expect(refreshed.candidate.quota.dimensions[0].remaining).toBe(95);
    expect(refreshed.candidate.quota.evidenceRef).not.toBe(original.candidate.quota.evidenceRef);
    expect(admissionBinding(refreshed)).toBe(admissionBinding(original));
    expect(vi.mocked(a.ports.adapter.dispatch).mock.calls[0][0]).toEqual(refreshed);
    expect([...state.budget.values()]).toEqual([8_000_000_000]);
    expect(a.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it.each(['profile-version', 'price-quote', 'budget-authorization', 'policy-fence', 'held-quota-amount'] as const)(
    'rejects freshly authenticated %s changes despite sufficient capacity', async change => {
      const h = harness({ profiles: [{ id: 'paid-a', paid: true }] });
      h.ports.waitReady = vi.fn(async () => {
        const c = h.snapshot.candidates[0];
        if (change === 'profile-version') {
          const profile = { ...c.profile, version: 'profile-2' };
          const bind = { profileVersion: profile.version, profileBinding: evidenceBinding(withoutEvidence(profile)) };
          h.snapshot = { ...h.snapshot, candidates: [{ ...c, profile, quota: { ...c.quota, ...bind },
            availability: { ...c.availability, ...bind }, price: { ...c.price!, ...bind } }] };
        } else if (change === 'price-quote') {
          h.snapshot = { ...h.snapshot, candidates: [{ ...c, price: { ...c.price!, estimatedNanoUsd: c.price!.estimatedNanoUsd + 1 } }] };
        } else if (change === 'budget-authorization') {
          h.snapshot = { ...h.snapshot, budget: { ...h.snapshot.budget!, maxAttemptNanoUsd: 9_000_000_000 } };
        } else if (change === 'held-quota-amount') {
          h.snapshot = { ...h.snapshot, candidates: [{ ...c, quota: { ...c.quota,
            dimensions: c.quota.dimensions.map(q => ({ ...q, required: q.required + 1 })) } }] };
        } else h.snapshot = { ...h.snapshot, revision: 'policy-fence-2' };
        h.seal();
      });
      expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'reservation-stale-replan-required' });
      expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
    });
  it('requires a new reservation when the authoritative accounting day rolls over during builder waiting', async () => {
    const h = harness({ request: { surface: 'builder', maxQueueWaitMs: DAY, deadlineAtMs: DAY + 120_000 },
      profiles: [{ id: 'paid-a', paid: true }] });
    h.ports.waitReady = vi.fn(async () => {
      h.advance(DAY - NOW);
      h.snapshot = { ...h.snapshot, budget: { ...h.snapshot.budget!, periodId: 'next-day', periodStartsAtMs: DAY, periodEndsAtMs: 2 * DAY } };
      h.seal();
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'reservation-stale-replan-required' });
    expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it('never dispatches a claim returning across IST midnight and retains claimed holds without a non-invocation fence', async () => {
    const periodStart = DAY - 19_800_000; const periodEnd = periodStart + DAY;
    const h = harness({ request: { createdAtMs: periodEnd - 100, queueEnteredAtMs: periodEnd - 100,
      deadlineAtMs: periodEnd + 120_000 }, profiles: [{ id: 'paid-a', paid: true }] });
    h.snapshot = { ...h.snapshot, budget: { ...h.snapshot.budget!, periodId: 'ist-day-fixture',
      periodStartsAtMs: periodStart, periodEndsAtMs: periodEnd } };
    h.advance(periodEnd - 100 - NOW); h.seal();
    const claim = h.ports.ledger.claim;
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => {
      const result = await claim(...args); h.advance(150);
      return result.kind === 'claimed' ? { ...result, claim: { ...result.claim, queueWaitConsumedAtDispatchMs: 150 } } : result;
    });
    h.ports.ledger.releaseUndispatched = vi.fn(async () => { throw new Error('Claimed; no durable non-invocation proof'); });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation', reason: 'undispatched-release-uncertain' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledWith(
      expect.anything(), 'no-eligible-candidate');
    expect(planInference({ ...h.snapshot, authority: h.ports.evidence, nowMs: h.ports.clock.now() })).toMatchObject({
      kind: 'blocked', rejected: [{ profileId: 'paid-a', reason: 'budget' }] });
    expect([...h.held.values()][0].phase).toBe('claimed'); expect([...h.state.budget.values()]).toEqual([8_000_000_000]);
  });
  it('releases all holds for cancellation before invocation', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] }); const abort = new AbortController();
    h.ports.waitReady = vi.fn(async () => { abort.abort(); });
    expect(await h.executor.execute(h.key, abort.signal)).toMatchObject({ kind: 'stopped', reason: 'cancelled' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce();
    expect([...h.state.budget.values()]).toEqual([10_000_000_000]);
  });
  it.each(['request-ref', 'profile-free-a', 'quota-free-a', 'availability-free-a'])('revalidates revoked %s after waiting', async ref => {
    const h = harness(); h.ports.waitReady = vi.fn(async () => { h.records.set(ref, { ...h.records.get(ref)!, revoked: true }); });
    expect((await h.executor.execute(h.key)).kind).toBe('stopped');
    expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it('revalidates a request cancelled in trusted state, without a local AbortSignal', async () => {
    const h = harness(); h.ports.waitReady = vi.fn(async () => {
      h.snapshot = { ...h.snapshot, request: { ...h.snapshot.request, cancellation: { id: 'cancel-1', cancelled: true } } }; h.seal();
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'cancelled' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
  });
  it.each(['payloadDigest', 'policyRevision', 'tenantId', 'budgetScopeId'] as const)('rejects a freshly signed %s change while holds exist', async field => {
    const h = harness(); h.ports.waitReady = vi.fn(async () => {
      const r = { ...h.snapshot.request, [field]: field === 'payloadDigest' ? 'b'.repeat(64) : 'different' };
      h.snapshot = { ...h.snapshot, request: r, candidates: [candidate(r, 'free-a', false)] }; h.seal();
    });
    expect((await h.executor.execute(h.key)).kind).toBe('stopped'); expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
    expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce();
  });
  it('rechecks revocation after an asynchronous durable claim returns', async () => {
    const h = harness(); const claim = h.ports.ledger.claim;
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => {
      const result = await claim(...args); h.records.set('profile-free-a', { ...h.records.get('profile-free-a')!, revoked: true }); return result;
    });
    expect((await h.executor.execute(h.key)).kind).toBe('stopped'); expect(h.ports.adapter.dispatch).not.toHaveBeenCalled();
    expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce();
  });
  it('accepts transaction queue latency above the supplied floor and carries it into fallback', async () => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
    const claim = h.ports.ledger.claim;
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => {
      h.advance(250); const result = await claim(...args);
      return result.kind === 'claimed' ? { ...result, claim: { ...result.claim,
        queueWaitConsumedAtDispatchMs: args[1].request.queueWaitConsumedMs + h.ports.clock.now() - args[1].request.queueEnteredAtMs } } : result;
    });
    h.ports.adapter.dispatch = vi.fn(async (intent, receipt) => h.response(intent, receipt,
      intent.binding.profileId === 'free-a' ? retry : { kind: 'completed' }));
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed' });
    expect(vi.mocked(h.ports.ledger.claim).mock.calls.map(c => c[2])).toEqual([0, 250]);
    expect(vi.mocked(h.ports.adapter.dispatch).mock.calls.map(c => c[1].queueWaitConsumedAtDispatchMs)).toEqual([250, 500]);
  });
  it.each([99, 5001, NaN])('rejects returned claim queue time %s outside the observed floor or queue limit', async consumed => {
    const h = harness(); const claim = h.ports.ledger.claim;
    h.ports.waitReady = vi.fn(async () => { h.advance(100); });
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => {
      const result = await claim(...args);
      return result.kind === 'claimed' ? { ...result, claim: { ...result.claim, queueWaitConsumedAtDispatchMs: consumed } } : result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation',
      reason: Number.isFinite(consumed) ? 'dispatch-claim-binding' : 'dispatch-claim-uncertain' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('treats cancellation while the claim response is pending as an unknown claim', async () => {
    const h = harness(); const claim = h.ports.ledger.claim; const abort = new AbortController();
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => { const result = await claim(...args); abort.abort(); return result; });
    expect(await h.executor.execute(h.key, abort.signal)).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-claim-uncertain' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
    const uncertain = harness(); uncertain.ports.ledger.claim = vi.fn(async () => { throw new Error('Lost commit reply'); });
    expect(await uncertain.executor.execute(uncertain.key)).toMatchObject({ reason: 'dispatch-claim-uncertain' });
    expect(uncertain.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('releases a known claim when cancellation arrives at the final pre-invocation check', async () => {
    const h = harness(); const abort = new AbortController(); const lookup = h.ports.evidence.lookup;
    h.ports.evidence.lookup = ref => {
      if ([...h.held.values()].some(value => value.phase === 'claimed')) abort.abort(); return lookup(ref);
    };
    expect(await h.executor.execute(h.key, abort.signal)).toMatchObject({ kind: 'stopped', reason: 'cancelled' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce();
  });
  it('keeps maximum-cost and quota holds after cancellation once dispatch was invoked', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] }); const abort = new AbortController(); const provider = deferred<AdapterResult>();
    h.ports.adapter.dispatch = vi.fn(() => provider.promise);
    const task = h.executor.execute(h.key, abort.signal); await flush(); abort.abort();
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-cancelled' });
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect([...h.state.budget.values()]).toEqual([8_000_000_000]);
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0];
    provider.resolve(h.response(args[0], args[1])); await flush();
    expect(h.ports.ledger.settle).not.toHaveBeenCalled(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
  });
  it('bounds a stalled queue independently of the session deadline', async () => {
    const h = harness(); h.ports.waitReady = vi.fn(() => new Promise<void>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(5001);
    expect(await task).toMatchObject({ kind: 'stopped', reason: 'queue-wait-failed' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).toHaveBeenCalledOnce();
  });
  it('rejects ordinary chat requesting over five seconds of cumulative queue time', async () => {
    const h = harness({ request: { maxQueueWaitMs: 5001 } });
    expect((await h.executor.execute(h.key)).kind).toBe('stopped'); expect(h.ports.ledger.reserve).not.toHaveBeenCalled();
  });
  it('does not incorrectly apply five seconds as the voice-session deadline', async () => {
    const h = harness({ request: { capability: capabilities[3] } });
    const provider = deferred<AdapterResult>(); h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await output(); return provider.promise;
    });
    const task = h.executor.execute(h.key); await flush(); h.advance(60_000);
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0]; provider.resolve(h.response(args[0], args[1], { kind: 'completed' }, true));
    expect(await task).toMatchObject({ kind: 'completed', holds: 'settled' });
  });
  it('never resets cumulative queue waiting after a physical attempt', async () => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
    h.ports.waitReady = vi.fn(async () => { h.advance(3000); });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => h.response(intent, claim, retry));
    expect((await h.executor.execute(h.key)).kind).toBe('stopped');
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
    expect(h.snapshot.request.queueWaitConsumedMs).toBe(3000);
  });
});

describe('output, final outcome, uncertainty, and authoritative reconciliation', () => {
  it('journals first output once for repeated streaming notifications', async () => {
    const h = harness();
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      for (let chunk = 0; chunk < 20; chunk++) await output();
      return h.response(intent, claim, { kind: 'completed' }, true);
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed', holds: 'settled' });
    expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce(); expect(h.timers.size).toBe(0);
  });
  it('coalesces concurrent notifications on one pending durable fence and rejects finished callbacks', async () => {
    const h = harness(); const journal = deferred<void>(); let exposed = 0; let callback!: () => Promise<void>;
    h.ports.ledger.markOutputVisible = vi.fn(() => journal.promise);
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      callback = output;
      await Promise.all([1, 2, 3].map(async () => { await output(); exposed++; }));
      return h.response(intent, claim, { kind: 'completed' }, true);
    });
    const task = h.executor.execute(h.key); await flush();
    expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce(); expect(exposed).toBe(0);
    journal.resolve(); expect(await task).toMatchObject({ kind: 'completed' }); expect(exposed).toBe(3);
    await expect(callback()).rejects.toThrow('no longer active'); expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce();
  });
  it('keeps a failed first-output fence sticky across concurrent and repeated notifications', async () => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
    const journal = deferred<void>(); const statuses: string[] = [];
    h.ports.ledger.markOutputVisible = vi.fn(() => journal.promise);
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      statuses.push(...(await Promise.allSettled([output(), output()])).map(r => r.status));
      statuses.push(...(await Promise.allSettled([output()])).map(r => r.status));
      return h.response(intent, claim, retry, true);
    });
    const task = h.executor.execute(h.key); await flush(); journal.reject(new Error('Journal unavailable'));
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'adapter-result-invalid' });
    expect(statuses).toEqual(['rejected', 'rejected', 'rejected']);
    expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
    expect(h.ports.ledger.settle).not.toHaveBeenCalled(); expect(h.pending.get('attempt-1')?.record.outputVisible).toBe(true);
  });
  it('checks cancellation again before reusing an already successful output fence', async () => {
    const h = harness(); const abort = new AbortController(); let repeated = false;
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await output(); abort.abort();
      await expect(output()).rejects.toThrow('no longer active'); repeated = true;
      return h.response(intent, claim, { kind: 'completed' }, true);
    });
    expect(await h.executor.execute(h.key, abort.signal)).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-cancelled' });
    await flush(); expect(repeated).toBe(true); expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce();
  });
  it.each(['cancelled', 'first-output-timeout'] as const)('does not expose coalesced output after %s while its fence is pending', async stop => {
    const h = harness({ request: { firstOutputTimeoutMs: 500 } }); const journal = deferred<void>();
    const abort = new AbortController(); let exposed = 0;
    h.ports.ledger.markOutputVisible = vi.fn(() => journal.promise);
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await Promise.all([1, 2].map(async () => { await output(); exposed++; }));
      return h.response(intent, claim, { kind: 'completed' }, true);
    });
    const task = h.executor.execute(h.key, abort.signal); await flush();
    if (stop === 'cancelled') abort.abort(); else h.advance(500);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: stop === 'cancelled' ? 'dispatch-cancelled' : 'dispatch-timeout' });
    journal.resolve(); await flush(); expect(exposed).toBe(0);
    expect(h.ports.ledger.markOutputVisible).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
  it.each(['safety-refusal', 'policy-denied', 'invalid-request'] as const)('never hops after %s, even without output', async failureClass => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => h.response(intent, claim, { kind: 'definite-failure', failureClass }));
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'terminal', holds: 'settled' });
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
  });
  it('never hops after partial visible output, even with proven retryable failure', async () => {
    const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await output(); return h.response(intent, claim, retry, true);
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'terminal', holds: 'settled' });
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce(); expect(h.events.indexOf('output')).toBeLessThan(h.events.indexOf('settle'));
  });
  it('cannot erase visible output from the adapter result or authoritative usage', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await output(); return h.response(intent, claim, retry, false);
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation', reason: 'adapter-result-invalid' });
    expect(h.ports.ledger.settle).not.toHaveBeenCalled(); expect(h.pending.get('attempt-1')?.record.outputVisible).toBe(true);
  });
  it('does not expose output if durable output journaling failed', async () => {
    const h = harness(); h.ports.ledger.markOutputVisible = vi.fn(async () => { throw new Error('Journal unavailable'); });
    let exposed = false;
    h.ports.adapter.dispatch = vi.fn(async (intent, claim, _signal, output) => {
      await output(); exposed = true; return h.response(intent, claim);
    });
    expect((await h.executor.execute(h.key)).kind).toBe('pending-reconciliation'); expect(exposed).toBe(false);
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('retains missing-usage holds rather than inventing zero cost or allowing fallback', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }, { id: 'paid-b', paid: true }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim, retry); h.receipts.clear(); return result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation', reason: 'final-usage-unverified' });
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce(); expect(h.ports.ledger.settle).not.toHaveBeenCalled();
    expect([...h.state.budget.values()]).toEqual([8_000_000_000]);
  });
  it('persists terminal refusal even if its usage is missing', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim, { kind: 'definite-failure', failureClass: 'safety-refusal' }); h.receipts.clear(); return result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'terminal', holds: 'retained' });
    expect(h.pending.get('attempt-1')?.record).toMatchObject({ outcome: 'definite-failure', failureClass: 'safety-refusal' });
  });
  it.each(['first-output', 'whole-attempt'] as const)('holds unknown usage after the %s timeout', async which => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (_intent, _claim, _signal, output) => {
      if (which === 'whole-attempt') await output(); return new Promise<AdapterResult>(() => {});
    });
    const task = h.executor.execute(h.key); await flush(); h.advance(which === 'first-output' ? 1000 : 90_000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-timeout' });
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
  it('does not infer definite failure from a synchronous or async adapter exception', async () => {
    for (const synchronous of [true, false]) {
      const h = harness(); h.ports.adapter.dispatch = vi.fn(() => {
        if (synchronous) throw new Error('Socket state unknown'); return Promise.reject(new Error('Socket state unknown'));
      });
      expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-error' });
      expect(h.pending.get('attempt-1')?.record.outcome).toBe('uncertain');
    }
  });
  it.each(['wrong-profile', 'wrong-payer', 'nonfinal', 'missing-dimension'] as const)('retains holds for %s in an unverified usage record', async flaw => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim); const u = h.receipts.get(result.usageEvidenceRef!)!;
      h.receipts.set(u.evidenceRef, flaw === 'wrong-profile' ? { ...u, binding: { ...u.binding, profileVersion: 'wrong' } }
            : flaw === 'wrong-payer' ? { ...u, binding: { ...u.binding, payer: { kind: 'platform', ownerId: 'other' } } }
              : flaw === 'nonfinal' ? { ...u, final: false } as unknown as AuthoritativeUsage
                : { ...u, quotaUsage: u.quotaUsage.slice(1) }); return result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed', holds: 'retained' });
    expect(h.ports.ledger.settle).not.toHaveBeenCalled();
  });
  it.each(['paid-overage', 'unexpected-free-charge', 'quota-overrun'] as const)('records %s honestly and quarantines rather than losing real usage', async flaw => {
    const h = harness({ profiles: [{ id: 'first', paid: flaw === 'paid-overage' }, { id: 'second', paid: true }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim, retry); const u = h.receipts.get(result.usageEvidenceRef!)!;
      h.receipts.set(u.evidenceRef, flaw === 'quota-overrun'
        ? { ...u, quotaUsage: u.quotaUsage.map(q => ({ ...q, amount: 12 })) }
        : { ...u, actualNanoUsd: flaw === 'paid-overage' ? 3_000_000_000 : 99 }); return result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'terminal', holds: 'settled', reason: 'usage-ceiling-violation' });
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce(); expect(h.ports.ledger.settleAndQuarantine).toHaveBeenCalledOnce();
    const [, usage, violation] = vi.mocked(h.ports.ledger.settleAndQuarantine).mock.calls[0];
    expect(usage.actualNanoUsd).toBe(flaw === 'paid-overage' ? 3_000_000_000 : flaw === 'unexpected-free-charge' ? 99 : 0);
    expect(violation.cost).toBe(flaw === 'paid-overage' ? 'maximum-cost-exceeded' : flaw === 'unexpected-free-charge' ? 'unexpected-free-charge' : null);
    expect(violation.quotaLedgerKeys.length).toBe(flaw === 'quota-overrun' ? 2 : 0);
    expect(h.state.quarantined).toContain('fixture-provider');
    expect([...h.state.budget.values()]).toEqual([10_000_000_000 - usageCommittedNanoUsd(usage)!]);
    expect(h.events.indexOf('quarantine')).toBeLessThan(h.events.indexOf('settle'));
  });
  it('reconciles only authenticated exact final usage, preserving idempotency and never auto-hopping', async () => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] }); const provider = deferred<AdapterResult>();
    h.ports.adapter.dispatch = vi.fn(() => provider.promise);
    const task = h.executor.execute(h.key); await flush(); h.advance(1000); await task;
    expect(await h.executor.reconcile(h.key, 'attempt-1', 'invented')).toMatchObject({ reason: 'reconciliation-unverified' });
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0]; const result = h.response(args[0], args[1]);
    provider.resolve(result); await flush();
    expect(await h.executor.reconcile({ ...h.key, tenantId: 'other' }, 'attempt-1', result.usageEvidenceRef!)).toMatchObject({ reason: 'reconciliation-binding' });
    expect(await h.executor.reconcile(h.key, 'attempt-1', result.usageEvidenceRef!)).toMatchObject({ kind: 'completed', holds: 'settled' });
    expect(await h.executor.reconcile(h.key, 'attempt-1', result.usageEvidenceRef!)).toMatchObject({ reason: 'no-pending-attempt' });
    expect(h.ports.ledger.settle).toHaveBeenCalledOnce(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
    expect([...h.state.budget.values()]).toEqual([9_000_000_000]);
  });
  it('cannot reconcile a terminal refusal into a retryable failure', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim, { kind: 'definite-failure', failureClass: 'safety-refusal' }); h.receipts.clear(); return result;
    });
    await h.executor.execute(h.key);
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0]; const ref = h.response(args[0], args[1], retry).usageEvidenceRef!;
    expect(await h.executor.reconcile(h.key, 'attempt-1', ref)).toMatchObject({ reason: 'reconciliation-unverified' });
    expect(h.ports.ledger.settle).not.toHaveBeenCalled();
  });
  it('authoritatively reconciles an unexpected free charge instead of freezing an understated zero hold', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim); h.receipts.clear(); return result;
    });
    await h.executor.execute(h.key);
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0]; const ref = h.response(args[0], args[1]).usageEvidenceRef!;
    h.receipts.set(ref, { ...h.receipts.get(ref)!, actualNanoUsd: 999 });
    expect(await h.executor.reconcile(h.key, 'attempt-1', ref)).toMatchObject({ kind: 'terminal', holds: 'settled', reason: 'usage-ceiling-violation' });
    expect(h.ports.ledger.settleAndQuarantine).toHaveBeenCalledOnce(); expect([...h.state.budget.values()]).toEqual([10_000_000_000 - 999]);
  });
});

describe('bounded control-plane waits and durable unknown-write ownership', () => {
  it('requires an explicit finite control-plane timeout policy', () => {
    const h = harness();
    for (const timeout of [0, -1, 5001, NaN, Infinity]) {
      expect(() => createInferenceExecutor({ ...h.ports, controlPlaneTimeoutMs: timeout })).toThrow('control-plane timeout');
    }
  });
  it('bounds a hung authenticated snapshot and responds to cancellation without waiting for timeout', async () => {
    const h = harness(); h.ports.readTrusted = vi.fn(() => new Promise<ExecutionSnapshot>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'stopped', reason: 'trusted-snapshot-unavailable' });
    const abort = new AbortController(); const cancelled = h.executor.execute(h.key, abort.signal); await flush(); abort.abort();
    expect(await cancelled).toMatchObject({ kind: 'stopped', reason: 'cancelled' });
    expect(h.ports.ledger.reserve).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
  it('keeps a timed-out admission recoverable when its durable commit completes late', async () => {
    const h = harness(); const gate = deferred<void>(); const reserve = h.ports.ledger.reserve;
    h.ports.ledger.reserve = vi.fn(async intent => { await gate.promise; return reserve(intent); });
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'reservation-uncertain' });
    gate.resolve(); await flush();
    expect(h.state.active).toContain(h.key.logicalRequestId); expect(h.held.size).toBe(1);
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('does not release or invoke a timed-out claim that commits after the caller stops waiting', async () => {
    const h = harness(); const gate = deferred<void>(); const claim = h.ports.ledger.claim;
    h.ports.ledger.claim = vi.fn<ExecutionPorts['ledger']['claim']>(async (...args) => { await gate.promise; return claim(...args); });
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'dispatch-claim-uncertain' });
    gate.resolve(); await flush(); expect([...h.held.values()][0].phase).toBe('claimed');
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('retains final-outcome holds when the authoritative usage service hangs', async () => {
    const h = harness(); h.ports.readAuthoritativeUsage = vi.fn(() => new Promise<AuthoritativeUsage | undefined>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'completed', holds: 'retained' });
    expect(h.ports.ledger.settle).not.toHaveBeenCalled(); expect(h.ports.ledger.retain).toHaveBeenCalledOnce();
  });
  it('bounds a hung settlement without describing an uncertain write as rolled back', async () => {
    const h = harness(); h.ports.ledger.settle = vi.fn(() => new Promise<void>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'completed', holds: 'retained' });
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
  });
  it('keeps an authenticated billing anomaly explicit when settle-and-quarantine hangs', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim); const ref = result.usageEvidenceRef!;
      h.receipts.set(ref, { ...h.receipts.get(ref)!, actualNanoUsd: 999 }); return result;
    });
    h.ports.ledger.settleAndQuarantine = vi.fn(() => new Promise<void>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'terminal', holds: 'retained', reason: 'usage-ceiling-violation' });
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
  });
  it('does not regress a completed settlement when only its response was lost', async () => {
    const h = harness(); const settle = h.ports.ledger.settle;
    h.ports.ledger.settle = vi.fn<ExecutionPorts['ledger']['settle']>(async (...args) => { await settle(...args); throw new Error('Response lost'); });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed', holds: 'retained' });
    expect([...h.held.values()][0].phase).toBe('settled'); expect(h.pending.size).toBe(0); expect(h.settled.size).toBe(1);
  });
  it('bounds a hung retain journal without leaking an unhandled rejection or releasing money', async () => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async () => { throw new Error('Unknown provider outcome'); });
    h.ports.ledger.retain = vi.fn(() => new Promise<void>(() => {}));
    const task = h.executor.execute(h.key); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'journal-uncertain' });
    expect(h.ports.ledger.releaseUndispatched).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
  it('bounds a hung undispatched cleanup and reports that its release is uncertain', async () => {
    const h = harness(); const abort = new AbortController();
    h.ports.waitReady = vi.fn(async () => { abort.abort(); });
    h.ports.ledger.releaseUndispatched = vi.fn(() => new Promise<void>(() => {}));
    const task = h.executor.execute(h.key, abort.signal); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'undispatched-release-uncertain' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
  it.each(['journal', 'usage'] as const)('bounds a hung reconciliation %s port', async phase => {
    const h = harness(); h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim); h.receipts.clear(); return result;
    });
    await h.executor.execute(h.key);
    if (phase === 'journal') h.ports.ledger.readPending = vi.fn(() => new Promise<PendingAttempt | undefined>(() => {}));
    else h.ports.readAuthoritativeUsage = vi.fn(() => new Promise<AuthoritativeUsage | undefined>(() => {}));
    const task = h.executor.reconcile(h.key, 'attempt-1', 'eventual-usage'); await flush(); h.advance(1000);
    expect(await task).toMatchObject({ kind: 'pending-reconciliation', reason: 'reconciliation-uncertain' });
    expect(h.ports.ledger.settle).not.toHaveBeenCalled(); expect(h.timers.size).toBe(0);
  });
});

describe('bounded physical attempts and shared mock-ledger contracts', () => {
  it('allows at most the trusted request limit, even if candidates remain', async () => {
    const h = harness({ request: { maxPhysicalAttempts: 2 }, profiles: [1, 2, 3].map(n => ({ id: `free-${n}`, paid: false })) });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => h.response(intent, claim, retry));
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'stopped', reason: 'attempt-limit' });
    expect(h.ports.adapter.dispatch).toHaveBeenCalledTimes(2);
  });
  it('rejects durable history or queue-accounting regression between fallback attempts', async () => {
    for (const field of ['history', 'queue'] as const) {
      const h = harness({ profiles: [{ id: 'free-a', paid: false }, { id: 'free-b', paid: false }] });
      h.ports.waitReady = vi.fn(async () => { h.advance(100); });
      h.ports.adapter.dispatch = vi.fn(async (intent, claim) => h.response(intent, claim, retry));
      const settle = h.ports.ledger.settle;
      h.ports.ledger.settle = vi.fn<ExecutionPorts['ledger']['settle']>(async (...args) => {
        await settle(...args); h.snapshot = { ...h.snapshot, request: { ...h.snapshot.request,
          ...(field === 'history' ? { attempts: [] } : { queueWaitConsumedMs: 0 }) } }; h.seal();
      });
      expect(await h.executor.execute(h.key)).toMatchObject({ reason: 'request-state-regression' });
      expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce();
    }
  });
  it('two coordinator replicas cannot both physically dispatch the same active logical request', async () => {
    const h = harness(); const provider = deferred<AdapterResult>(); h.ports.adapter.dispatch = vi.fn(() => provider.promise);
    const a = h.executor.execute(h.key); const b = createInferenceExecutor(h.ports).execute(h.key); await flush();
    expect(h.ports.adapter.dispatch).toHaveBeenCalledOnce(); expect(await b).toMatchObject({ reason: 'admission-denied-replan-required' });
    const args = vi.mocked(h.ports.adapter.dispatch).mock.calls[0]; provider.resolve(h.response(args[0], args[1]));
    expect((await a).kind).toBe('completed');
  });
  it('reserves a shared daily maximum across different profiles and logical requests, not per provider', async () => {
    const shared = sharedState();
    const a = harness({ shared, request: { logicalRequestId: 'logical-a' }, profiles: [{ id: 'paid-a', paid: true, cost: 6_000_000_000 }] });
    const b = harness({ shared, request: { logicalRequestId: 'logical-b' }, profiles: [{ id: 'paid-b', paid: true, cost: 6_000_000_000 }] });
    const provider = deferred<AdapterResult>(); a.ports.adapter.dispatch = vi.fn(() => provider.promise);
    const task = a.executor.execute(a.key); await flush();
    expect(await b.executor.execute(b.key)).toMatchObject({ reason: 'admission-denied-replan-required' });
    expect(b.ports.adapter.dispatch).not.toHaveBeenCalled(); expect([...shared.budget.values()]).toEqual([4_000_000_000]);
    const args = vi.mocked(a.ports.adapter.dispatch).mock.calls[0]; provider.resolve(a.response(args[0], args[1])); await task;
  });
  it('reserves every overlapping account/org/model dimension, not just the selected model', async () => {
    const h = harness();
    h.state.quota.set(quotaLedgerKey(h.snapshot.candidates[0].profile.quotaDimensions[0]), 9);
    expect(await h.executor.execute(h.key)).toMatchObject({ reason: 'admission-denied-replan-required' });
    expect(h.ports.adapter.dispatch).not.toHaveBeenCalled(); expect(h.state.budget.size).toBe(0);
  });
  it.each(['cap', 'period'] as const)('does not accept a signed fallback budget with an invalid daily %s', async flaw => {
    const h = harness({ profiles: [{ id: 'paid-a', paid: true }] });
    h.snapshot = { ...h.snapshot, budget: { ...h.snapshot.budget!, ...(flaw === 'cap'
      ? { periodLimitNanoUsd: PLATFORM_FREE_DAILY_LIMIT_NANO_USD + 1 } : { periodEndsAtMs: DAY * 2 }) } }; h.seal();
    expect((await h.executor.execute(h.key)).kind).toBe('stopped'); expect(h.ports.ledger.reserve).not.toHaveBeenCalled();
  });
  it('keeps the existing funded-builder budget separate from the new platform-free pool', async () => {
    const h = harness({ request: { surface: 'builder', budgetScopeId: 'builder-funded' },
      scopes: [{ id: 'builder-funded', kind: 'funded-builder' }], profiles: [{ id: 'paid-builder', paid: true }] });
    h.snapshot = { ...h.snapshot, budget: { ...h.snapshot.budget!, periodLimitNanoUsd: 100_000_000_000 } }; h.seal();
    expect((await h.executor.execute(h.key)).kind).toBe('completed');
    expect(vi.mocked(h.ports.ledger.reserve).mock.calls[0][0].binding.budgetScopeId).toBe('builder-funded');
  });
  it('binds tenant-BYOK execution to its own tenant and payer without entering platform pools', async () => {
    const h = harness({ request: { surface: 'developer-api', budgetScopeId: 'tenant-own',
      payer: { kind: 'tenant', ownerId: 'tenant-owner', tenantId: 'tenant-1' } },
    scopes: [{ id: 'tenant-own', kind: 'tenant-byok' }], profiles: [{ id: 'tenant-profile', paid: true }] });
    expect((await h.executor.execute(h.key)).kind).toBe('completed');
    expect(vi.mocked(h.ports.adapter.dispatch).mock.calls[0][0].binding.payer).toEqual({ kind: 'tenant', ownerId: 'tenant-owner', tenantId: 'tenant-1' });
  });
  it('fails closed on an unknown or duplicate server scope configuration', async () => {
    for (const scopes of [[], [{ id: 'fallback-shared', kind: 'platform-free-fallback' as const },
      { id: 'fallback-shared', kind: 'funded-builder' as const }], [{ id: 'fallback-shared', kind: 'platform-free-fallback' as const },
      { id: 'second-free-pool', kind: 'platform-free-fallback' as const }],
    [{ id: 'fallback-shared', kind: 'unrecognized' } as unknown as SpendScope]]) {
      const h = harness({ scopes }); expect((await h.executor.execute(h.key)).kind).toBe('stopped');
      expect(h.ports.ledger.reserve).not.toHaveBeenCalled();
    }
  });
});


describe('explicit monetary evidence basis', () => {
  it.each(['valid', 'mixed', 'mixed-undefined', 'wrong-rate', 'fractional', 'free', 'noncompleted'] as const)('accepts only an authenticated compatible conservative ceiling: %s', async flaw => {
    const h = harness({ profiles: [{ id: 'first', paid: flaw !== 'free' }] });
    h.ports.adapter.dispatch = vi.fn(async (intent, claim) => {
      const result = h.response(intent, claim); const original = h.receipts.get(result.usageEvidenceRef!)!;
      const { actualNanoUsd: _actual, ...base } = original;
      const ceiling = { ...base, chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: flaw === 'fractional' ? 0.5 : 123,
        rateCardVersion: flaw === 'wrong-rate' ? 'other' : 'synthetic-rate-1',
        ...(flaw === 'mixed' ? { actualNanoUsd: 0 } : flaw === 'mixed-undefined' ? { actualNanoUsd: undefined } : {}),
        ...(flaw === 'noncompleted' ? { outcome: retry } : {}) } as AuthoritativeUsage;
      h.receipts.set(original.evidenceRef, ceiling); return result;
    });
    expect(await h.executor.execute(h.key)).toMatchObject({ kind: 'completed', holds: flaw === 'valid' ? 'settled' : 'retained' });
    expect(h.ports.ledger.settle).toHaveBeenCalledTimes(flaw === 'valid' ? 1 : 0);
    if (flaw === 'valid') {
      const usage = vi.mocked(h.ports.ledger.settle).mock.calls[0][1];
      expect(usage).not.toHaveProperty('actualNanoUsd'); expect(usageCommittedNanoUsd(usage)).toBe(123);
    }
  });
});
