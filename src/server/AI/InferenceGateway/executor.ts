/**
 * Trusted orchestration used by the default-off server gateway composition.
 * Matching JSON never authenticates evidence, receipts or usage. All ports must
 * remain server-owned; the Firestore adapter supplies durable atomic accounting.
 * Offline tests prove contracts, not live datastore/provider compliance.
 */
import { isCount, isIdentifier, isPositiveCount } from './capabilities';
import { planInference } from './policy';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { AttemptRecord, BudgetAuthorization, Candidate, EvidenceAuthority, Payer,
  PlanningResult, RoutingRequest, SelectionPlan } from './types';

export const PLATFORM_FREE_DAILY_LIMIT_NANO_USD = 10_000_000_000;
const DAY_MS = 86_400_000;

/** A locator, NOT authentication. readTrusted must authorize it against server identity. */
export interface ExecutionKey {
  readonly logicalRequestId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly payloadDigest: string;
}
export interface ExecutionSnapshot {
  /** Request/policy CAS fence including cancellation and history, NOT live capacity counters. */
  readonly revision: string;
  readonly request: RoutingRequest;
  readonly candidates: readonly Candidate[];
  readonly budget?: BudgetAuthorization;
}
export interface SpendScope {
  readonly id: string;
  readonly kind: 'platform-free-fallback' | 'funded-builder' | 'tenant-byok';
}
export interface DispatchBinding {
  readonly key: ExecutionKey;
  readonly physicalAttemptId: string;
  readonly snapshotRevision: string;
  readonly requestBinding: string;
  readonly profileBinding: string;
  readonly priceBinding?: string;
  readonly budgetAuthorizationBinding?: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly adapterId: string;
  readonly payer: Payer;
  readonly budgetScopeId: string;
  readonly quota: SelectionPlan['quotaReservations'];
  readonly budget?: SelectionPlan['budgetReservation'];
}
export interface AdmissionIntent {
  readonly binding: DispatchBinding;
  readonly plan: SelectionPlan;
  readonly request: RoutingRequest;
  readonly candidate: Candidate;
  readonly budget?: BudgetAuthorization;
}
export interface Reservation {
  readonly id: string;
  /** Exact admissionBinding(intent), not a signature or independently usable permit. */
  readonly intentBinding: string;
}
export interface DispatchClaim extends Reservation {
  readonly claimId: string;
  readonly binding: DispatchBinding;
  readonly queueWaitConsumedAtDispatchMs: number;
}
export type FinalOutcome = { readonly kind: 'completed' }
  | { readonly kind: 'definite-failure'; readonly failureClass: Extract<AttemptRecord,
      { outcome: 'definite-failure' }>['failureClass'] };
/** Authenticated generation rejection; it says NOTHING about final billed cost or quota. */
export interface AuthenticatedRejection {
  readonly evidenceRef: string;
  readonly binding: DispatchBinding;
  readonly kind: 'http-rejected';
  readonly status: 429;
  readonly generationRejected: true;
  readonly outputVisible: false;
  readonly receivedAtMs: number;
  readonly cooldownUntilMs?: number;
}
export interface AdapterResult {
  readonly binding: DispatchBinding;
  readonly outcome: FinalOutcome;
  readonly outputVisible: boolean;
  /** Merely a reference; adapter-supplied cost/usage numbers are never trusted. */
  readonly usageEvidenceRef?: string;
  readonly rejectionEvidenceRef?: string;
}
interface AuthoritativeUsageBase {
  readonly evidenceRef: string;
  readonly binding: DispatchBinding;
  readonly final: true;
  readonly outcome: FinalOutcome;
  readonly outputVisible: boolean;
  readonly quotaUsage: readonly { readonly ledgerKey: string; readonly amount: number }[];
}
/** A liability ceiling remains distinctly provisional, never an invoice or wallet charge. */
export type AuthoritativeUsage = AuthoritativeUsageBase & (
  | { readonly chargeBasis?: 'actual'; readonly actualNanoUsd: number;
      readonly conservativeCeilingNanoUsd?: never; readonly rateCardVersion?: never }
  | { readonly chargeBasis: 'conservative-ceiling'; readonly conservativeCeilingNanoUsd: number;
      readonly actualNanoUsd?: never; readonly rateCardVersion: string });
/** Structural amount validation only. Authentication remains the durable evidence reader's job. */
export function usageCommittedNanoUsd(usage: AuthoritativeUsage): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  if (usage.chargeBasis === 'conservative-ceiling') {
    return !Object.hasOwn(usage, 'actualNanoUsd') && isCount(usage.conservativeCeilingNanoUsd)
      && isIdentifier(usage.rateCardVersion) ? usage.conservativeCeilingNanoUsd : undefined;
  }
  return (usage.chargeBasis === undefined || usage.chargeBasis === 'actual') && isCount(usage.actualNanoUsd)
    && !Object.hasOwn(usage, 'conservativeCeilingNanoUsd') && !Object.hasOwn(usage, 'rateCardVersion')
    ? usage.actualNanoUsd : undefined;
}
export interface UsageViolation {
  readonly cost: 'unexpected-free-charge' | 'maximum-cost-exceeded' | null;
  readonly quotaLedgerKeys: readonly string[];
}
export interface PendingAttempt {
  readonly claim: DispatchClaim;
  /** Durable, monotonic facts from the journal. Must not erase refusal or output. */
  readonly record: AttemptRecord;
}
export interface ExecutionPorts {
  readonly evidence: EvidenceAuthority;
  readonly scopes: readonly SpendScope[];
  /** Bounded per control-plane wait, at most 5000 ms. Not a generation/session deadline. */
  readonly controlPlaneTimeoutMs: number;
  readonly clock: {
    now(): number;
    /** Monotonic server clock; cancel removes this callback. No default timer here. */
    schedule(atMs: number, callback: () => void): () => void;
  };
  /**
   * Authorize key against server identity. For a reservation-aware refresh, verify
   * the durable receipt and its exclusively owned, outstanding holds; credit ONLY
   * those exact holds once when deriving current available quota/budget. Never
   * credit arbitrary client amounts, another attempt, settled usage or released
   * holds. Fresh evidence still authenticates the resulting current snapshot.
   */
  readTrusted(key: ExecutionKey, reservation?: Reservation): Promise<ExecutionSnapshot>;
  readonly ledger: {
    /**
     * ONE atomic transaction: authenticate/validate current revision and exact
     * request/profile/price/payer/tenant; enforce ALL overlapping quota dimensions;
     * reserve maximum total cost against shared period AND logical-request limits;
     * resolve the canonical server accounting day (not an arbitrary caller period).
     * The ONE platform-free pool is shared across providers, principals and tenants;
     * never subdivide it by credential, profile, provider, tenant or request IDs.
     * exclusively create the physical attempt and one active logical-request slot.
     * No partial holds on denial. Replays/concurrent callers never receive a fresh
     * dispatch right. Do not include credential IDs in quota or spend-pool keys.
     * Timed-out callers do not cancel committed writes: the service must recover
     * late/unknown admissions and claims by logical/physical attempt identity. A
     * durable recovery process owns these records even if this process exits.
     */
    reserve(intent: AdmissionIntent): Promise<{ readonly kind: 'held'; readonly reservation: Reservation }
      | { readonly kind: 'denied' }>;
    /**
     * ONE durable CAS: reservation is exclusively owned, all holds still exist,
     * exact request/profile/price/authorization remain current, fresh evidence is
     * valid, current capacity plus ONLY this owned hold is sufficient, no output/refusal/prior
     * uncertain attempt, cancellation is clear, queue/deadline/attempt limits fit.
     * Check trusted state at transaction commit, not just the supplied snapshot.
     * Persist dispatch intent and cumulative QUEUE time before any network call.
     * queueWaitConsumedMs is a caller-observed floor, not an exact clock value:
     * include transaction latency in the persisted/returned cumulative queue time.
     * Return denied only if this claim definitely did not commit.
     */
    claim(reservation: Reservation, intent: AdmissionIntent, queueWaitConsumedMs: number):
      Promise<{ readonly kind: 'claimed'; readonly claim: DispatchClaim } | { readonly kind: 'denied' }>;
    /**
     * CAS exclusively held -> never-invoked. Claimed release additionally needs a
     * durable exclusive non-invocation fence; without one, throw and retain holds.
     * A caller's reason, cancellation, or elapsed lease is not proof of no charge.
     */
    releaseUndispatched(reservation: Reservation, reason: string): Promise<void>;
    /** Must persist output before the adapter exposes it. Output is monotonic. */
    markOutputVisible(claim: DispatchClaim): Promise<void>;
    /**
     * Retain ALL holds indefinitely until authoritative reconciliation; never
     * TTL-release. Monotonic CAS: never overwrite settled state or erase known
     * output/completion/refusal, including a settlement whose response was lost.
     */
    retain(claim: DispatchClaim, record: AttemptRecord, reason: string): Promise<void>;
    /**
     * Atomic, idempotent settlement by physical attempt AND evidence identity.
     * Verify trusted usage again; book its explicit actual/ceiling basis, release only unused maximum
     * cost, account actual quota consumption, persist outcome, release active slot.
     * Previously settled evidence cannot be double charged or applied elsewhere.
     */
    settle(claim: DispatchClaim, usage: AuthoritativeUsage): Promise<void>;
    /**
     * ONE idempotent transaction: record the full authenticated actual cost/quota
     * even above holds (never clip or invent zero); mark the violated shared spend
     * or quota scope and profile/account ineligible before other admissions; retain
     * an actionable accounting incident for review. A genuine overage is a known
     * liability, not missing evidence. Never release admission between these writes.
     */
    settleAndQuarantine(claim: DispatchClaim, usage: AuthoritativeUsage, violation: UsageViolation): Promise<void>;
    /** Clears only generation activity after a verified rejection; ALL monetary/quota holds remain. */
    retainRejectedForRetry?(claim: DispatchClaim, rejection: AuthenticatedRejection): Promise<void>;
    readPending(key: ExecutionKey, physicalAttemptId: string): Promise<PendingAttempt | undefined>;
  };
  /** Wait only; must not dispatch, obtain credentials, or modify holds. */
  waitReady(reservation: Reservation, untilMs: number, signal: AbortSignal): Promise<void>;
  readonly adapter: {
    /**
     * Resolve credentials only for this exact tenant/payer/profile. Verify payload
     * digest before sending; reject substitution; enforce every capability/usage
     * ceiling; honor signal. No hidden SDK retries or fallback: one physical call.
     * The adapter must await markOutputVisible BEFORE exposing any partial output.
     */
    dispatch(intent: AdmissionIntent, claim: DispatchClaim, signal: AbortSignal,
      markOutputVisible: () => Promise<void>): Promise<AdapterResult>;
  };
  /** Resolve final usage and its explicit monetary basis from authenticated records, never an adapter assertion. */
  readAuthoritativeUsage(claim: DispatchClaim, evidenceRef: string): Promise<AuthoritativeUsage | undefined>;
  readAuthoritativeRejection?(claim: DispatchClaim, evidenceRef: string): Promise<AuthenticatedRejection | undefined>;
}
export type ExecutionResult =
  | { readonly kind: 'stopped'; readonly reason: string; readonly decision?: PlanningResult }
  | { readonly kind: 'completed' | 'terminal'; readonly physicalAttemptId: string; readonly holds: 'settled' | 'retained';
      readonly reason?: 'usage-ceiling-violation' }
  | { readonly kind: 'pending-reconciliation'; readonly physicalAttemptId: string; readonly reason: string };

function immutable<T>(value: T): T {
  const copy = JSON.parse(evidenceBinding(value)) as T;
  function freeze(v: unknown): void {
    if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  }
  freeze(copy);
  return copy;
}
function same(a: unknown, b: unknown): boolean { return evidenceBinding(a) === evidenceBinding(b); }

/** Pure comparison descriptor only. It neither authenticates nor authorizes dispatch. */
export function admissionBinding(intent: AdmissionIntent): string { return evidenceBinding(intent.binding); }

/** Shared with transaction adapters so authority/hold bindings have one definition. */
export function admissionIntentFor(key: ExecutionKey, snapshot: ExecutionSnapshot, plan: SelectionPlan): AdmissionIntent {
  const candidate = snapshot.candidates.find(c => c.profile.id === plan.profileId)!;
  const p = candidate.profile;
  let budgetAuthorizationBinding: string | undefined;
  if (snapshot.budget) {
    const { remainingLogicalRequestNanoUsd: _logical, remainingPeriodNanoUsd: _period, ...authorization } = withoutEvidence(snapshot.budget);
    budgetAuthorizationBinding = evidenceBinding(authorization);
  }
  return immutable({ binding: { key, physicalAttemptId: plan.physicalAttemptId, snapshotRevision: snapshot.revision,
    requestBinding: evidenceBinding(withoutEvidence(snapshot.request)), profileBinding: evidenceBinding(withoutEvidence(p)),
    ...(candidate.price ? { priceBinding: evidenceBinding(withoutEvidence(candidate.price)) } : {}),
    ...(budgetAuthorizationBinding ? { budgetAuthorizationBinding } : {}),
    profileId: p.id, profileVersion: p.version, providerId: p.providerId, modelId: p.modelId,
    modelRevision: p.modelRevision, adapterId: p.adapterId, payer: plan.payer, budgetScopeId: snapshot.request.budgetScopeId,
    quota: plan.quotaReservations, ...(plan.budgetReservation ? { budget: plan.budgetReservation } : {}) },
  plan, request: snapshot.request, candidate, ...(snapshot.budget ? { budget: snapshot.budget } : {}) });
}
function keyMatches(key: ExecutionKey, r: ExecutionKey): boolean {
  return key.logicalRequestId === r.logicalRequestId && key.principalId === r.principalId
    && key.tenantId === r.tenantId && key.payloadDigest === r.payloadDigest;
}
/** Immutable logical-request identity across attempts; cancellation state is still revalidated separately. */
export function logicalRequestBinding(r: RoutingRequest): string {
  const { nextPhysicalAttemptId: _attempt, attempts: _history, queueEnteredAtMs: _entered,
    queueWaitConsumedMs: _consumed, outputVisible: _visible, cancellation, evidenceRef: _evidence, ...stable } = r;
  return evidenceBinding({ ...stable, cancellationId: cancellation.id });
}
function terminal(outcome: FinalOutcome): boolean {
  return outcome.kind === 'definite-failure' && outcome.failureClass !== 'retryable-provider-failure';
}
function validOutcome(o: FinalOutcome): boolean {
  return !!o && (o.kind === 'completed' || (o.kind === 'definite-failure'
    && ['retryable-provider-failure', 'safety-refusal', 'policy-denied', 'invalid-request'].includes(o.failureClass)));
}
function attemptRecord(claim: DispatchClaim, outcome: FinalOutcome | undefined, visible: boolean): AttemptRecord {
  const identity = { physicalAttemptId: claim.binding.physicalAttemptId, profileId: claim.binding.profileId, outputVisible: visible };
  if (!outcome) return { ...identity, outcome: 'uncertain' };
  return outcome.kind === 'completed' ? { ...identity, outcome: 'completed' }
    : { ...identity, outcome: 'definite-failure', failureClass: outcome.failureClass };
}
function usageValid(u: AuthoritativeUsage, claim: DispatchClaim, ref: string): boolean {
  const b = claim.binding;
  if (!u || u.final !== true || u.evidenceRef !== ref || !isIdentifier(ref) || !same(u.binding, b)
    || !validOutcome(u.outcome) || typeof u.outputVisible !== 'boolean' || usageCommittedNanoUsd(u) === undefined || !Array.isArray(u.quotaUsage)
    || u.quotaUsage.length !== b.quota.length
    || (u.chargeBasis === 'conservative-ceiling' && (!b.budget || u.rateCardVersion !== b.budget.rateCardVersion
      || u.outcome.kind !== 'completed'))) return false;
  const usage = new Map(u.quotaUsage.map(q => [q.ledgerKey, q.amount]));
  return usage.size === b.quota.length && b.quota.every(q => {
    const n = usage.get(q.ledgerKey);
    return n !== undefined && isCount(n);
  });
}
function usageViolation(u: AuthoritativeUsage, claim: DispatchClaim): UsageViolation | undefined {
  const maximum = claim.binding.budget?.amountNanoUsd ?? 0;
  const cost = usageCommittedNanoUsd(u)! > maximum ? (claim.binding.budget ? 'maximum-cost-exceeded' : 'unexpected-free-charge') : null;
  const quotaLedgerKeys = claim.binding.quota.filter(q => u.quotaUsage.find(used => used.ledgerKey === q.ledgerKey)!.amount > q.amount)
    .map(q => q.ledgerKey);
  return cost || quotaLedgerKeys.length ? { cost, quotaLedgerKeys } : undefined;
}

const executionTimeouts = new WeakSet<object>();
/** Only this coordinator can brand deadline/first-output cancellation, never a client abort. */
export function isInferenceExecutorTimeout(reason: unknown): boolean {
  return !!reason && typeof reason === 'object' && executionTimeouts.has(reason);
}
function executionTimeoutReason(): object { const reason = Object.freeze({ kind: 'inference-executor-timeout' }); executionTimeouts.add(reason); return reason; }

type Bounded<T> = { kind: 'value'; value: T } | { kind: 'cancelled' | 'timeout' | 'error' };
/** All rejection paths are observed; an abort is NOT evidence that the provider did no work. */
function bounded<T>(ports: ExecutionPorts, untilMs: number, outer: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>, firstOutputMs?: number):
  { result: Promise<Bounded<T>>; firstOutput: () => void } {
  const controller = new AbortController();
  let finish: (result: Bounded<T>) => void = () => {};
  let cancelFirst = () => {};
  const result = new Promise<Bounded<T>>(resolve => {
    let ended = false;
    let cancelDeadline = () => {};
    const onAbort = () => finish({ kind: 'cancelled' });
    finish = result => {
      if (ended) return;
      ended = true; cancelDeadline(); cancelFirst(); outer?.removeEventListener('abort', onAbort);
      controller.abort(result.kind === 'timeout' ? executionTimeoutReason() : undefined); resolve(result);
    };
    if (outer?.aborted) { finish({ kind: 'cancelled' }); return; }
    if (ports.clock.now() >= untilMs) { finish({ kind: 'timeout' }); return; }
    outer?.addEventListener('abort', onAbort, { once: true });
    try {
      cancelDeadline = ports.clock.schedule(untilMs, () => finish({ kind: 'timeout' }));
      if (firstOutputMs !== undefined) cancelFirst = ports.clock.schedule(firstOutputMs, () => finish({ kind: 'timeout' }));
      void operation(controller.signal).then(value => finish({ kind: 'value', value }), () => finish({ kind: 'error' }));
    }
    catch { finish({ kind: 'error' }); }
  });
  return { result, firstOutput: () => cancelFirst() };
}

/** Only trusted composition may construct this object. It is deliberately not registered anywhere. */
export function createInferenceExecutor(ports: ExecutionPorts) {
  if (!isPositiveCount(ports.controlPlaneTimeoutMs) || ports.controlPlaneTimeoutMs > 5000) {
    throw new Error('Invalid trusted control-plane timeout policy');
  }
  const stopped = (reason: string, decision?: PlanningResult): ExecutionResult => ({ kind: 'stopped', reason, ...(decision ? { decision } : {}) });
  const pending = (id: string, reason: string): ExecutionResult => ({ kind: 'pending-reconciliation', physicalAttemptId: id, reason });
  async function control<T>(operation: () => Promise<T>, signal?: AbortSignal, deadlineAtMs?: number): Promise<T> {
    const until = Math.min(ports.clock.now() + ports.controlPlaneTimeoutMs, deadlineAtMs ?? Number.MAX_SAFE_INTEGER);
    const result = await bounded(ports, until, signal, operation).result;
    if (result.kind !== 'value') throw new Error(`Control-plane ${result.kind}`);
    return result.value;
  }

  function policy(snapshot: ExecutionSnapshot): PlanningResult {
    const r = snapshot.request;
    const scopes = ports.scopes.filter(s => s.id === r.budgetScopeId);
    const scope = scopes[0];
    const incompatible = scopes.length !== 1 || !['platform-free-fallback', 'funded-builder', 'tenant-byok'].includes(scope.kind)
      || ports.scopes.filter(s => s.kind === 'platform-free-fallback').length > 1
      || (scope.kind === 'tenant-byok' ? r.payer.kind !== 'tenant'
      : r.payer.kind !== 'platform') || (scope.kind === 'funded-builder' && r.surface !== 'builder');
    const b = snapshot.budget;
    if (incompatible || (r.surface === 'chat' && r.maxQueueWaitMs > 5000)
      || (scope.kind === 'platform-free-fallback' && b && (b.periodLimitNanoUsd > PLATFORM_FREE_DAILY_LIMIT_NANO_USD
        || b.periodEndsAtMs - b.periodStartsAtMs !== DAY_MS))) return { kind: 'blocked', reason: 'budget', rejected: [] };
    return planInference({ ...snapshot, authority: ports.evidence, nowMs: ports.clock.now() });
  }
  async function release(reservation: Reservation, reason: string, id: string): Promise<ExecutionResult> {
    try { await control(() => ports.ledger.releaseUndispatched(reservation, reason)); return stopped(reason); }
    catch { return pending(id, 'undispatched-release-uncertain'); }
  }
  async function retain(claim: DispatchClaim, record: AttemptRecord, reason: string): Promise<ExecutionResult> {
    try { await control(() => ports.ledger.retain(claim, record, reason)); }
    catch { return pending(claim.binding.physicalAttemptId, 'journal-uncertain'); }
    if (record.outcome === 'completed') return { kind: 'completed', physicalAttemptId: record.physicalAttemptId, holds: 'retained' };
    if (record.outcome === 'definite-failure' && record.failureClass !== 'retryable-provider-failure') {
      return { kind: 'terminal', physicalAttemptId: record.physicalAttemptId, holds: 'retained' };
    }
    return pending(record.physicalAttemptId, reason);
  }

  async function execute(input: ExecutionKey, signal?: AbortSignal): Promise<ExecutionResult> {
    let key: ExecutionKey;
    try {
      key = immutable({ logicalRequestId: input.logicalRequestId, principalId: input.principalId,
        tenantId: input.tenantId, payloadDigest: input.payloadDigest });
      if (![key.logicalRequestId, key.principalId, key.tenantId].every(isIdentifier)
        || !/^[a-f0-9]{64}$/.test(key.payloadDigest)) return stopped('invalid-key');
    } catch { return stopped('invalid-key'); }
    let stable: string | undefined;
    let history: readonly AttemptRecord[] | undefined;
    let queueFloor = 0;
    // A second guard independent of mutable snapshot counts. No unbounded retry loop.
    for (let dispatches = 0; dispatches < 4; dispatches++) {
      if (signal?.aborted) return stopped('cancelled');
      let snapshot: ExecutionSnapshot;
      let plan: SelectionPlan;
      let intent: AdmissionIntent;
      try {
        snapshot = immutable(await control(() => ports.readTrusted(key), signal));
        if (!isIdentifier(snapshot.revision) || !keyMatches(key, snapshot.request)) return stopped('request-binding');
        const currentStable = logicalRequestBinding(snapshot.request);
        if ((stable !== undefined && stable !== currentStable) || (history && !same(history, snapshot.request.attempts))
          || snapshot.request.queueWaitConsumedMs < queueFloor) return stopped('request-state-regression');
        stable = currentStable;
        const decision = policy(snapshot);
        if (decision.kind !== 'plan') return stopped(decision.reason, decision);
        plan = decision;
        intent = admissionIntentFor(key, snapshot, plan);
      } catch { return stopped(signal?.aborted ? 'cancelled' : 'trusted-snapshot-unavailable'); }
      if (signal?.aborted) return stopped('cancelled');
      let reservation: Reservation;
      try {
        const admitted = await control(() => ports.ledger.reserve(intent), signal, plan.deadlineAtMs);
        if (admitted.kind === 'denied') return stopped('admission-denied-replan-required');
        if (admitted.kind !== 'held') return pending(plan.physicalAttemptId, 'reservation-uncertain');
        reservation = immutable(admitted.reservation);
        if (!isIdentifier(reservation.id) || reservation.intentBinding !== admissionBinding(intent)) {
          return pending(plan.physicalAttemptId, 'reservation-binding');
        }
      } catch { return pending(plan.physicalAttemptId, 'reservation-uncertain'); }
      // Real queue waiting is separately bounded; it never truncates a voice/build session to five seconds.
      const wait = bounded(ports, Math.min(plan.queueUntilMs + 1, plan.deadlineAtMs), signal,
        s => ports.waitReady(reservation, plan.queueUntilMs, s));
      const ready = await wait.result;
      if (ready.kind !== 'value') return release(reservation, ready.kind === 'cancelled' ? 'cancelled' : 'queue-wait-failed', plan.physicalAttemptId);
      let refreshed: AdmissionIntent;
      let queueConsumed: number;
      try {
        const fresh = immutable(await control(() => ports.readTrusted(key, reservation), signal, plan.deadlineAtMs));
        const decision = policy(fresh);
        if (!keyMatches(key, fresh.request) || decision.kind !== 'plan') {
          return release(reservation, decision.kind === 'plan' ? 'request-binding' : decision.reason, plan.physicalAttemptId);
        }
        refreshed = admissionIntentFor(key, fresh, decision);
        // Recompute ALL current policy. Compare immutable authority and exact held
        // resources, not historical remaining counters/availability/evidence IDs.
        // Current capacity and exclusive own-hold attribution are checked by claim.
        if (admissionBinding(refreshed) !== reservation.intentBinding) {
          return release(reservation, 'reservation-stale-replan-required', plan.physicalAttemptId);
        }
        snapshot = fresh; intent = refreshed; plan = decision;
        queueConsumed = fresh.request.queueWaitConsumedMs + ports.clock.now() - fresh.request.queueEnteredAtMs;
        if (!isCount(queueConsumed) || queueConsumed > fresh.request.maxQueueWaitMs || signal?.aborted
          || ports.clock.now() >= plan.deadlineAtMs) return release(reservation, signal?.aborted ? 'cancelled' : 'deadline', plan.physicalAttemptId);
      } catch { return release(reservation, 'revalidation-failed', plan.physicalAttemptId); }
      let claim: DispatchClaim;
      try {
        const claimed = await control(() => ports.ledger.claim(reservation, refreshed, queueConsumed), signal, plan.deadlineAtMs);
        if (claimed.kind === 'denied') return release(reservation, 'dispatch-claim-denied', plan.physicalAttemptId);
        if (claimed.kind !== 'claimed') return pending(plan.physicalAttemptId, 'dispatch-claim-uncertain');
        claim = immutable(claimed.claim);
        if (!isIdentifier(claim.claimId) || claim.id !== reservation.id || claim.intentBinding !== reservation.intentBinding
          || !same(claim.binding, intent.binding) || !isCount(claim.queueWaitConsumedAtDispatchMs)
          || claim.queueWaitConsumedAtDispatchMs < queueConsumed
          || claim.queueWaitConsumedAtDispatchMs > snapshot.request.maxQueueWaitMs) {
          return pending(plan.physicalAttemptId, 'dispatch-claim-binding');
        }
      } catch { return pending(plan.physicalAttemptId, 'dispatch-claim-uncertain'); }
      // Still before local invocation. A ledger without an exclusive durable
      // non-invocation fence must retain claimed holds rather than infer a refund.
      const finalPolicy = policy(snapshot);
      if (signal?.aborted || ports.clock.now() >= plan.deadlineAtMs || ports.clock.now() > plan.queueUntilMs
        || finalPolicy.kind !== 'plan' || !same(finalPolicy, plan)) {
        return release(reservation, signal?.aborted ? 'cancelled' : finalPolicy.kind !== 'plan'
          ? finalPolicy.reason : 'dispatch-policy-changed', plan.physicalAttemptId);
      }
      let outputVisible = false;
      let outputJournalFailed = false;
      let firstOutputJournal: Promise<void> | undefined;
      let invocationFinished = false;
      let firstOutput = () => {};
      const startedAt = ports.clock.now();
      const running = bounded(ports, Math.min(startedAt + plan.attemptTimeoutMs, plan.deadlineAtMs), signal,
        s => ports.adapter.dispatch(intent, claim, s, async () => {
          if (invocationFinished || s.aborted) throw new Error('Attempt is no longer active');
          outputVisible = true; // Conservative even if the subsequent durable write fails.
          try {
            // One durable first-output fence per attempt, not a write per chunk.
            // Cache rejections too: repeated/concurrent notifications never retry
            // a failed or uncertain journal write and cannot expose output first.
            firstOutputJournal ??= control(() => ports.ledger.markOutputVisible(claim), s, plan.deadlineAtMs);
            await firstOutputJournal;
            if (invocationFinished || s.aborted) throw new Error('Attempt is no longer active');
            firstOutput();
          } catch (error) { outputJournalFailed = true; throw error; }
        }), startedAt + plan.firstOutputTimeoutMs);
      firstOutput = running.firstOutput;
      const dispatched = await running.result;
      invocationFinished = true;
      if (dispatched.kind !== 'value') return retain(claim, attemptRecord(claim, undefined, outputVisible), `dispatch-${dispatched.kind}`);
      let result: AdapterResult;
      try {
        result = immutable(dispatched.value);
        if (!same(result.binding, claim.binding) || !validOutcome(result.outcome)
          || typeof result.outputVisible !== 'boolean' || outputJournalFailed || (outputVisible && !result.outputVisible)) {
          return retain(claim, attemptRecord(claim, undefined, outputVisible), 'adapter-result-invalid');
        }
      } catch { return retain(claim, attemptRecord(claim, undefined, outputVisible), 'adapter-result-invalid'); }
      outputVisible ||= result.outputVisible;
      const record = attemptRecord(claim, result.outcome, outputVisible);
      if (!outputVisible && result.outcome.kind === 'definite-failure' && result.outcome.failureClass === 'retryable-provider-failure'
        && result.rejectionEvidenceRef && ports.readAuthoritativeRejection && ports.ledger.retainRejectedForRetry) {
        try {
          const rejection = await control(() => ports.readAuthoritativeRejection!(claim, result.rejectionEvidenceRef!), signal);
          if (!rejection || rejection.evidenceRef !== result.rejectionEvidenceRef || !isIdentifier(rejection.evidenceRef)
            || !same(rejection.binding, claim.binding) || rejection.kind !== 'http-rejected' || rejection.status !== 429
            || rejection.generationRejected !== true || rejection.outputVisible !== false || !isCount(rejection.receivedAtMs)
            || rejection.receivedAtMs > ports.clock.now() || rejection.receivedAtMs < snapshot.request.createdAtMs
            || (rejection.cooldownUntilMs !== undefined && (!isCount(rejection.cooldownUntilMs)
              || rejection.cooldownUntilMs < rejection.receivedAtMs || rejection.cooldownUntilMs > rejection.receivedAtMs + 7 * 86_400_000))) {
            return retain(claim, attemptRecord(claim, undefined, false), 'rejection-evidence-unverified');
          }
          await control(() => ports.ledger.retainRejectedForRetry!(claim, rejection), signal);
          // Billing is still unresolved and fully reserved. This proof permits only
          // another bounded generation attempt, with fresh independent maximum holds.
          history = [...snapshot.request.attempts, record]; queueFloor = claim.queueWaitConsumedAtDispatchMs;
          if (signal?.aborted) return stopped('cancelled');
          continue;
        } catch { return retain(claim, attemptRecord(claim, undefined, false), 'rejection-journal-uncertain'); }
      }
      let usage: AuthoritativeUsage | undefined;
      let violation: UsageViolation | undefined;
      let settlementStarted = false;
      try {
        if (result.usageEvidenceRef) usage = await control(() => ports.readAuthoritativeUsage(claim, result.usageEvidenceRef!), signal);
        if (!usage || !usageValid(usage, claim, result.usageEvidenceRef!) || !same(usage.outcome, result.outcome)
          || (outputVisible && !usage.outputVisible)) {
          // Missing usage is never zero. A retryable failure without proof becomes uncertain.
          return retain(claim, result.outcome.kind === 'definite-failure' && !terminal(result.outcome)
            ? attemptRecord(claim, undefined, outputVisible) : record, 'final-usage-unverified');
        }
        usage = immutable(usage);
        violation = usageViolation(usage, claim);
        settlementStarted = true;
        if (violation) {
          await control(() => ports.ledger.settleAndQuarantine(claim, usage!, immutable(violation!)), signal);
          return { kind: 'terminal', physicalAttemptId: plan.physicalAttemptId, holds: 'settled', reason: 'usage-ceiling-violation' };
        }
        await control(() => ports.ledger.settle(claim, usage!), signal);
      } catch {
        const retained = await retain(claim, record.outcome === 'definite-failure' && !terminal(result.outcome)
          ? attemptRecord(claim, undefined, outputVisible) : record, violation ? 'usage-quarantine-uncertain'
            : settlementStarted ? 'settlement-uncertain' : 'final-usage-unavailable');
        return violation && retained.kind !== 'pending-reconciliation'
          ? { kind: 'terminal', physicalAttemptId: plan.physicalAttemptId, holds: 'retained', reason: 'usage-ceiling-violation' } : retained;
      }
      if (result.outcome.kind === 'completed') return { kind: 'completed', physicalAttemptId: plan.physicalAttemptId, holds: 'settled' };
      if (terminal(result.outcome) || outputVisible || usage.outputVisible) return { kind: 'terminal', physicalAttemptId: plan.physicalAttemptId, holds: 'settled' };
      if (signal?.aborted) return stopped('cancelled');
      history = [...snapshot.request.attempts, record];
      queueFloor = claim.queueWaitConsumedAtDispatchMs;
    }
    return stopped('attempt-limit');
  }

  /** No dispatch/fallback here, even after reconciliation. A future request must freshly authorize policy. */
  async function reconcile(key: ExecutionKey, physicalAttemptId: string, evidenceRef: string, signal?: AbortSignal): Promise<ExecutionResult> {
    try {
      if (!isIdentifier(physicalAttemptId) || !isIdentifier(evidenceRef)) return stopped('invalid-reconciliation-key');
      const saved = await control(() => ports.ledger.readPending(key, physicalAttemptId), signal);
      if (!saved) return stopped('no-pending-attempt');
      const { claim, record } = immutable(saved);
      if (!keyMatches(key, claim.binding.key) || claim.binding.physicalAttemptId !== physicalAttemptId
        || record.physicalAttemptId !== physicalAttemptId || record.profileId !== claim.binding.profileId) return stopped('reconciliation-binding');
      const usage = await control(() => ports.readAuthoritativeUsage(claim, evidenceRef), signal);
      if (!usage || !usageValid(usage, claim, evidenceRef) || (record.outputVisible && !usage.outputVisible)
        || (record.outcome === 'completed' && usage.outcome.kind !== 'completed')
        || (record.outcome === 'definite-failure' && record.failureClass !== 'retryable-provider-failure'
          && !same(usage.outcome, { kind: 'definite-failure', failureClass: record.failureClass }))) {
        return pending(physicalAttemptId, 'reconciliation-unverified');
      }
      const violation = usageViolation(usage, claim);
      if (violation) {
        await control(() => ports.ledger.settleAndQuarantine(claim, immutable(usage), immutable(violation)), signal);
        return { kind: 'terminal', physicalAttemptId, holds: 'settled', reason: 'usage-ceiling-violation' };
      }
      await control(() => ports.ledger.settle(claim, immutable(usage)), signal);
      return usage.outcome.kind === 'completed' ? { kind: 'completed', physicalAttemptId, holds: 'settled' }
        : { kind: 'terminal', physicalAttemptId, holds: 'settled' };
    } catch { return pending(physicalAttemptId, 'reconciliation-uncertain'); }
  }
  return Object.freeze({ execute, reconcile });
}
