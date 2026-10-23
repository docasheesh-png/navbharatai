import { modelSlotIdentity, modelSlotPath, modelSlotBinding, readModelSlotPolicy, readModelSlotState, readHeldModelSlot, type GatewayModelSlotPolicy, type GatewayModelSlotState, type HeldModelSlot } from './modelConcurrency';
/**
 * Firestore hold/claim ledger composed by the server-only runtime. No default DB,
 * credential selection, timers or provider calls. All inputs to the constructor are
 * trusted server composition, never request body configuration.
 *
 * Authority/evidence/usage documents require server-only authenticated writers and
 * reviewed Firestore access controls BEFORE integration. This module does not create
 * those authorities. Matching JSON is not authentication; datastore provenance is.
 *
 * Reviewed local-capacity policies bound gateway pressure only, never complete upstream
 * allowance. Unknown upstream remaining is safe only under separately reviewed zero-price
 * or provider-hard-stop protection. Existing exclusive-ledger test contracts remain supported.
 * Missing policy/state/period documents deny, never imply fresh provider capacity.
 * Paid accounting already uses the ONE existing platform-free IST-day ledger.
 * Admission and claim must be on the same canonical IST day. Long sessions may settle
 * later against their original attempt day; this is not an invoice-day guarantee.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FREE_CHAIN_COLLECTION, paidUserDocumentPath, readData, readPaidPolicy, readPaidUser, readSpendDay, writePaidUser, writeSpendDay } from '../FreeChain/paidLedger';
import { checkedAdd, civilDayWindow, FreeChainDataError, nonnegativeInteger, validTime, type DayWindow } from '../FreeChain/quota';
import { DEFAULT_PAID_PER_USER_DAILY_LIMIT, OWNER_PAID_DAILY_CEILING_NANO_USD, PAID_BUDGET_TIME_ZONE, type PaidBudgetPolicy, type SpendDay } from '../FreeChain/spendCap';
import { admissionBinding, admissionIntentFor, logicalRequestBinding } from './executor';
import type { AdmissionIntent, AuthenticatedRejection, AuthoritativeUsage, DispatchClaim, ExecutionKey, ExecutionPorts,
  ExecutionSnapshot, FinalOutcome, PendingAttempt, Reservation, SpendScope, UsageViolation } from './executor';
import { isIdentifier } from './capabilities';
import { planInference } from './policy';
import { evidenceBinding, withoutEvidence } from './profiles';
import type { AttemptRecord, EvidenceRecord } from './types';

type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
type Raw = Record<string, unknown>;
type DocumentKind = 'authority' | 'evidence' | 'logical' | 'attempt' | 'quota-policy' | 'quota-state'
  | 'quota-period' | 'usage' | 'rejection' | 'receipt' | 'profile-quarantine' | 'incident';
/** Canonical hashed paths contain no credential IDs, provider secrets or raw payloads. */
export function gatewayLedgerPath(kind: DocumentKind, identity: string): string {
  return `${FREE_CHAIN_COLLECTION}/gateway_${kind.replaceAll('-', '_')}_${hash(identity)}`;
}
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const same = (a: unknown, b: unknown): boolean => evidenceBinding(a) === evidenceBinding(b);
const capture = <T>(value: T): T => JSON.parse(evidenceBinding(value)) as T;
class Denied extends Error {}
function demand(condition: unknown, message = 'Invalid or unavailable gateway authority'): asserts condition {
  if (!condition) throw new Denied(message);
}
function raw(value: unknown, kind?: string): Raw {
  demand(value && typeof value === 'object' && !Array.isArray(value));
  const r = value as Raw;
  demand(!('expiresAt' in r) && !('expireAt' in r), 'Authority or pending state must not have TTL');
  if (kind) demand(r.kind === kind && r.version === 1);
  return r;
}
function count(value: unknown): number { demand(nonnegativeInteger(value)); return value; }
function subtract(a: number, b: number): number { demand(nonnegativeInteger(a) && nonnegativeInteger(b) && a >= b); return a - b; }
function validKey(key: ExecutionKey): boolean {
  return !!key && [key.logicalRequestId, key.principalId, key.tenantId].every(isIdentifier) && /^[a-f0-9]{64}$/.test(key.payloadDigest);
}
function validRecord(a: AttemptRecord): boolean {
  return !!a && isIdentifier(a.physicalAttemptId) && isIdentifier(a.profileId) && typeof a.outputVisible === 'boolean'
    && (a.outcome === 'uncertain' || a.outcome === 'completed' || (a.outcome === 'definite-failure'
      && ['retryable-provider-failure', 'safety-refusal', 'policy-denied', 'invalid-request'].includes(a.failureClass)));
}
function terminal(a: AttemptRecord): boolean { return a.outcome === 'definite-failure' && a.failureClass !== 'retryable-provider-failure'; }
function mergeRecord(previous: AttemptRecord, next: AttemptRecord): AttemptRecord {
  demand(validRecord(previous) && validRecord(next) && previous.physicalAttemptId === next.physicalAttemptId && previous.profileId === next.profileId);
  const rank = (a: AttemptRecord) => terminal(a) ? 3 : a.outcome === 'completed' ? 2 : a.outcome === 'definite-failure' ? 1 : 0;
  return { ...(rank(next) > rank(previous) ? next : previous), outputVisible: previous.outputVisible || next.outputVisible };
}
function outcomeRecord(claim: DispatchClaim, outcome: FinalOutcome, outputVisible: boolean): AttemptRecord {
  const identity = { physicalAttemptId: claim.binding.physicalAttemptId, profileId: claim.binding.profileId, outputVisible };
  demand(outcome && (outcome.kind === 'completed' || (outcome.kind === 'definite-failure'
    && ['retryable-provider-failure', 'safety-refusal', 'policy-denied', 'invalid-request'].includes(outcome.failureClass))));
  return outcome.kind === 'completed' ? { ...identity, outcome: 'completed' }
    : { ...identity, outcome: 'definite-failure', failureClass: outcome.failureClass };
}

/** No writer is supplied. This is a trusted ingress/policy service prerequisite. */
export interface GatewayAuthorityDocument {
  kind: 'gateway_authority'; version: 1;
  key: ExecutionKey;
  snapshot: ExecutionSnapshot;
  scope: SpendScope;
  logicalLimitNanoUsd: number;
  /** Shared policy revision reviewed by this request's current budget authority. */
  paidPolicyRevision: number;
  /** Production issuer binds the complete current server-reviewed catalog and exclusive account fences. */
  configurationBinding?: string;
  sourceBindings?: readonly { path: string; binding: string }[];
  modelSlots?: Record<string, GatewayModelSlotPolicy>;
}
export interface GatewayQuotaPolicy {
  kind: 'gateway_quota_policy'; version: 1;
  ledgerKey: string;
  revision: number;
  authority: 'gateway-exclusive' | 'gateway-local-capacity' | 'legacy-free-chain';
  /** Local pressure limits never assert complete upstream remaining quota. */
  accountingBasis?: 'gateway-local-only';
  /** Server-owned migration approval; must match existing imported state. No enrollment writer here. */
  migrationId: string;
  limit: number;
  window: { id: string; startsAtMs: number; endsAtMs: number };
}
interface QuotaState {
  kind: 'gateway_quota_state'; version: 1; ledgerKey: string; migrationId: string;
  /** Includes outstanding holds from ALL windows, without expiry. */
  held: number; quarantined: boolean;
}
interface QuotaPeriod {
  kind: 'gateway_quota_period'; version: 1; ledgerKey: string; window: GatewayQuotaPolicy['window']; spent: number;
}
interface HeldQuota {
  ledgerKey: string; amount: number; migrationId: string; policyRevision: number;
  window: GatewayQuotaPolicy['window'];
}
interface LogicalState {
  kind: 'gateway_logical'; version: 1; key: ExecutionKey; requestIdentity: string;
  cancellationId: string; cancelled: boolean; outputVisible: boolean; terminal: boolean; completed: boolean;
  activeAttemptId: string | null; attempts: AttemptRecord[]; queueWaitConsumedMs: number;
  heldNanoUsd: number; spentNanoUsd: number; logicalLimitNanoUsd: number;
}
interface AttemptState {
  kind: 'gateway_attempt'; version: 1; reservation: Reservation; intent: AdmissionIntent;
  phase: 'held' | 'claimed' | 'pending' | 'released' | 'settled';
  window: DayWindow; heldQuota: HeldQuota[]; heldNanoUsd: number; createdAtMs: number;
  claim?: DispatchClaim; record?: AttemptRecord;
  heldModelSlot?: HeldModelSlot;
  settlement?: { evidenceRef: string; usageBinding: string;
    chargeBasis?: 'actual' | 'conservative-ceiling'; bookedNanoUsd?: number;
    replaces?: { evidenceRef: string; usageBinding: string } };
  /** Rejection authorizes another attempt, never a refund or zero-billing inference. */
  retryRejection?: AuthenticatedRejection;
}
interface CurrentAuthority {
  authority: GatewayAuthorityDocument;
  evidence: Map<string, EvidenceRecord>;
  logical: LogicalState;
  attempt?: AttemptState;
  quotas: { policy: GatewayQuotaPolicy; state: QuotaState; period: QuotaPeriod }[];
  policy: PaidBudgetPolicy | null;
  day: SpendDay;
  paidUserCount: number;
  modelSlot?: { policy: GatewayModelSlotPolicy; state: GatewayModelSlotState };
  window: DayWindow;
}
export interface FirestoreLedgerOptions {
  now(): number;
  /** Identity captured by authenticated server ingress, never taken from an ExecutionKey. */
  principal: { principalId: string; tenantId: string };
  /** The only implemented spend authority. Funded builder and tenant BYOK fail closed. */
  platformScope: { id: string; ownerId: string };
  adminEmails(): string[];
  /** Same UID-wide counter as FreeChain; only server composition may choose a stricter policy. */
  perUserDailyLimit?: number;
  /** Required by the production composition; legacy contract fixtures do not issue source records. */
  requireConfigurationBinding?: boolean;
}

type LedgerPort = ExecutionPorts['ledger'];
export function readGatewayAttempt(value: unknown): AttemptState {
    const a = raw(value, 'gateway_attempt') as unknown as AttemptState;
    demand(a.reservation && /^[a-f0-9]{64}$/.test(a.reservation.id) && a.intent
      && a.reservation.intentBinding === admissionBinding(a.intent)
      && a.reservation.id === hash(a.intent.binding.physicalAttemptId)
      && ['held', 'claimed', 'pending', 'released', 'settled'].includes(a.phase)
      && nonnegativeInteger(a.createdAtMs) && nonnegativeInteger(a.heldNanoUsd)
      && Array.isArray(a.heldQuota) && a.heldQuota.length === a.intent.binding.quota.length
      && a.heldNanoUsd === (a.intent.binding.budget?.amountNanoUsd ?? 0)
      && a.heldQuota.every((q, i) => q.ledgerKey === a.intent.binding.quota[i].ledgerKey
        && q.amount === a.intent.binding.quota[i].amount && nonnegativeInteger(q.amount) && q.amount > 0
        && isIdentifier(q.migrationId) && nonnegativeInteger(q.policyRevision) && q.policyRevision > 0
        && q.window && isIdentifier(q.window.id) && nonnegativeInteger(q.window.startsAtMs)
        && nonnegativeInteger(q.window.endsAtMs) && q.window.startsAtMs <= a.createdAtMs && q.window.endsAtMs > a.createdAtMs));
    demand(same(a.window, civilDayWindow(a.createdAtMs, PAID_BUDGET_TIME_ZONE)));
    if (a.heldModelSlot !== undefined) {
      const held = readHeldModelSlot(a.heldModelSlot);
      const identity = modelSlotIdentity(a.intent.candidate.profile);
      demand(identity && same(held.identity, identity) && held.intentBinding === modelSlotBinding(admissionBinding(a.intent)));
    }
    if (a.phase === 'claimed' || a.phase === 'pending' || a.phase === 'settled') {
      demand(a.claim && a.record && validRecord(a.record) && a.claim.id === a.reservation.id
        && a.claim.intentBinding === a.reservation.intentBinding && same(a.claim.binding, a.intent.binding)
        && a.record.physicalAttemptId === a.intent.binding.physicalAttemptId && a.record.profileId === a.intent.binding.profileId
        && a.claim.claimId === hash(`claim:${a.reservation.id}`) && nonnegativeInteger(a.claim.queueWaitConsumedAtDispatchMs));
    }
    if (a.retryRejection) demand((a.phase === 'pending' || a.phase === 'settled')
      && a.retryRejection.kind === 'http-rejected' && a.retryRejection.status === 429
      && a.retryRejection.generationRejected === true && a.retryRejection.outputVisible === false
      && isIdentifier(a.retryRejection.evidenceRef) && same(a.retryRejection.binding, a.intent.binding)
      && nonnegativeInteger(a.retryRejection.receivedAtMs) && a.retryRejection.receivedAtMs >= a.createdAtMs
      && (a.retryRejection.cooldownUntilMs === undefined || (nonnegativeInteger(a.retryRejection.cooldownUntilMs)
        && a.retryRejection.cooldownUntilMs >= a.retryRejection.receivedAtMs && a.retryRejection.cooldownUntilMs <= a.retryRejection.receivedAtMs + 7 * 86400000)));
    return a;
  }
export class FirestoreInferenceLedger implements LedgerPort {
  constructor(private readonly db: Db, private readonly options: FirestoreLedgerOptions) {
    demand(db && typeof db.runTransaction === 'function' && typeof db.doc === 'function');
    demand(options && [options.principal.principalId, options.principal.tenantId, options.platformScope.id,
      options.platformScope.ownerId].every(isIdentifier) && typeof options.now === 'function' && typeof options.adminEmails === 'function');
    demand(nonnegativeInteger(options.perUserDailyLimit ?? DEFAULT_PAID_PER_USER_DAILY_LIMIT)
      && (options.perUserDailyLimit ?? DEFAULT_PAID_PER_USER_DAILY_LIMIT) <= DEFAULT_PAID_PER_USER_DAILY_LIMIT);
    this.options = { ...options, principal: { ...options.principal }, platformScope: { ...options.platformScope } };
  }
  private ref(kind: DocumentKind, id: string) { return this.db.doc(gatewayLedgerPath(kind, id)); }
  private async get(tx: Transaction, kind: DocumentKind, id: string): Promise<unknown> { return readData(await tx.get(this.ref(kind, id))); }
  private now(): number { const now = this.options.now(); validTime(now); return now; }
  private authorize(key: ExecutionKey): void {
    demand(validKey(key) && key.principalId === this.options.principal.principalId && key.tenantId === this.options.principal.tenantId);
  }
  private parseAttempt(value: unknown): AttemptState { return readGatewayAttempt(value); }
  private logical(value: unknown, authority: GatewayAuthorityDocument): LogicalState {
    const r = authority.snapshot.request;
    if (value === undefined) {
      demand(r.attempts.length === 0 && nonnegativeInteger(r.queueWaitConsumedMs) && r.queueWaitConsumedMs <= r.maxQueueWaitMs && !r.outputVisible);
      return { kind: 'gateway_logical', version: 1, key: authority.key, requestIdentity: logicalRequestBinding(r),
        cancellationId: r.cancellation.id, cancelled: r.cancellation.cancelled, outputVisible: false, terminal: false, completed: false,
        activeAttemptId: null, attempts: [], queueWaitConsumedMs: r.queueWaitConsumedMs, heldNanoUsd: 0, spentNanoUsd: 0,
        logicalLimitNanoUsd: count(authority.logicalLimitNanoUsd) };
    }
    const l = raw(value, 'gateway_logical') as unknown as LogicalState;
    demand(same(l.key, authority.key) && l.requestIdentity === logicalRequestBinding(r)
      && l.cancellationId === r.cancellation.id && l.logicalLimitNanoUsd === authority.logicalLimitNanoUsd);
    this.validateLogical(l);
    return l;
  }
  private validateLogical(l: LogicalState): void {
    demand(validKey(l.key) && typeof l.requestIdentity === 'string' && isIdentifier(l.cancellationId)
      && ['cancelled', 'outputVisible', 'terminal', 'completed'].every(k => typeof (l as unknown as Raw)[k] === 'boolean')
      && (l.activeAttemptId === null || isIdentifier(l.activeAttemptId))
      && Array.isArray(l.attempts) && l.attempts.length <= 4 && l.attempts.every(validRecord)
      && new Set(l.attempts.map(a => a.physicalAttemptId)).size === l.attempts.length
      && [l.queueWaitConsumedMs, l.heldNanoUsd, l.spentNanoUsd, l.logicalLimitNanoUsd].every(nonnegativeInteger));
    checkedAdd(l.heldNanoUsd, l.spentNanoUsd);
  }
  private quotaPolicy(value: unknown, ledgerKey: string, now: number): GatewayQuotaPolicy {
    const p = raw(value, 'gateway_quota_policy') as unknown as GatewayQuotaPolicy;
    demand(p.ledgerKey === ledgerKey && (p.authority === 'gateway-exclusive'
        || (p.authority === 'gateway-local-capacity' && p.accountingBasis === 'gateway-local-only')) && isIdentifier(p.migrationId)
      && nonnegativeInteger(p.revision) && p.revision > 0 && nonnegativeInteger(p.limit)
      && p.window && isIdentifier(p.window.id) && nonnegativeInteger(p.window.startsAtMs) && nonnegativeInteger(p.window.endsAtMs)
      && p.window.startsAtMs <= now && p.window.endsAtMs > now);
    return p;
  }
  private quotaState(value: unknown, ledgerKey: string, migrationId: string): QuotaState {
    const q = raw(value, 'gateway_quota_state') as unknown as QuotaState;
    demand(q.ledgerKey === ledgerKey && q.migrationId === migrationId && nonnegativeInteger(q.held) && typeof q.quarantined === 'boolean');
    return q;
  }
  private quotaPeriod(value: unknown, ledgerKey: string, window: GatewayQuotaPolicy['window']): QuotaPeriod {
    const q = raw(value, 'gateway_quota_period') as unknown as QuotaPeriod;
    demand(q.ledgerKey === ledgerKey && same(q.window, window) && nonnegativeInteger(q.spent));
    return q;
  }
  /**
   * Nominal selected-candidate transaction reads: 13 + 3N paid, 10–12 + 3N free
   * (optional selected quote/budget evidence; N <= 32), excluding Firestore retries. Up to six selected
   * evidence records, never evidence for the whole provider shortlist. This remains
   * a hot shared transaction, not a demonstrated throughput/scaling guarantee.
   * Every policy/evidence read occurs in this transaction; no cached resolver or naked document.get(). */
  private async current(tx: Transaction, intent: AdmissionIntent): Promise<CurrentAuthority> {
    const key = intent.binding.key; this.authorize(key);
    const now = this.now();
    const [a, l, attempt, policyRaw] = await Promise.all([
      this.get(tx, 'authority', key.logicalRequestId), this.get(tx, 'logical', key.logicalRequestId),
      this.get(tx, 'attempt', intent.binding.physicalAttemptId),
      tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_budget_policy`)).then(readData),
    ]);
    const authority = raw(a, 'gateway_authority') as unknown as GatewayAuthorityDocument;
    demand(same(authority.key, key) && authority.snapshot && isIdentifier(authority.snapshot.revision)
      && authority.scope?.kind === 'platform-free-fallback' && authority.scope.id === this.options.platformScope.id
      && authority.snapshot.request.budgetScopeId === this.options.platformScope.id
      && authority.snapshot.request.payer.kind === 'platform'
      && authority.snapshot.request.payer.ownerId === this.options.platformScope.ownerId
      && authority.snapshot.request.logicalRequestId === key.logicalRequestId
      && authority.snapshot.request.principalId === key.principalId && authority.snapshot.request.tenantId === key.tenantId
      && authority.snapshot.request.payloadDigest === key.payloadDigest
      && nonnegativeInteger(authority.logicalLimitNanoUsd) && authority.logicalLimitNanoUsd <= OWNER_PAID_DAILY_CEILING_NANO_USD
      && nonnegativeInteger(authority.paidPolicyRevision));
    demand(Array.isArray(authority.snapshot.candidates) && authority.snapshot.candidates.length <= 32);
    if (this.options.requireConfigurationBinding || authority.configurationBinding !== undefined) {
      demand(typeof authority.configurationBinding === 'string' && authority.configurationBinding.length > 0
        && Array.isArray(authority.sourceBindings) && authority.sourceBindings.length > 0 && authority.sourceBindings.length <= 32);
      const catalog = await tx.get(this.db.doc('free_chat_chain/gateway_catalog')).then(readData);
      demand(catalog !== undefined && evidenceBinding(catalog) === authority.configurationBinding);
      for (const source of authority.sourceBindings) {
        demand(/^free_chat_chain\/gateway_(?:account_owner|quota_rule|model_slot_policy)_[a-f0-9]{64}$/.test(source.path) && typeof source.binding === 'string');
        const record = await tx.get(this.db.doc(source.path)).then(readData);
        demand(record !== undefined && evidenceBinding(record) === source.binding);
      }
    }
    const selected = authority.snapshot.candidates.find(c => c.profile.id === intent.binding.profileId);
    demand(selected && selected.profile && selected.quota && selected.availability);
    // Selection/ranking belongs to planning. This transaction authenticates only the
    // selected candidate, not an unbounded catalog or every alternative's evidence.
    const refs = new Set<string>([authority.snapshot.request.evidenceRef, selected.profile.evidenceRef,
      selected.quota.evidenceRef, selected.availability.evidenceRef,
      ...(selected.price ? [selected.price.evidenceRef] : [])]);
    if (authority.snapshot.budget) refs.add(authority.snapshot.budget.evidenceRef);
    demand([...refs].every(isIdentifier) && intent.binding.quota.length > 0 && intent.binding.quota.length <= 32
      && new Set(intent.binding.quota.map(q => q.ledgerKey)).size === intent.binding.quota.length);
    const evidence = new Map(await Promise.all([...refs].map(async ref => {
      const record = raw(await this.get(tx, 'evidence', ref)) as unknown as EvidenceRecord;
      return [ref, record] as const;
    })));
    let modelSlot: CurrentAuthority['modelSlot'];
    const slotIdentity = modelSlotIdentity(selected.profile);
    if (slotIdentity) {
      const reviewed = authority.modelSlots?.[selected.profile.id];
      demand(reviewed);
      const [policyRaw, stateRaw] = await Promise.all(['policy', 'state'].map(kind => tx.get(this.db.doc(modelSlotPath(kind as 'policy' | 'state', slotIdentity))).then(readData)));
      const policy = readModelSlotPolicy(policyRaw, slotIdentity, now);
      demand(same(policy, reviewed));
      modelSlot = { policy, state: readModelSlotState(stateRaw, slotIdentity) };
    }
    const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
    const profileQuarantineId = evidenceBinding([intent.binding.providerId, intent.binding.profileId]);
    const [dayRaw, profileQuarantine, userRaw, ...quotaPolicies] = await Promise.all([
      tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_day_${window.key}`)).then(readData),
      this.get(tx, 'profile-quarantine', profileQuarantineId),
      intent.binding.budget ? tx.get(this.db.doc(paidUserDocumentPath(window.key, hash(key.principalId)))).then(readData) : Promise.resolve(undefined),
      ...intent.binding.quota.map(q => this.get(tx, 'quota-policy', q.ledgerKey)),
    ]);
    demand(profileQuarantine === undefined, 'Profile remains quarantined until separate verified recovery');
    const policies = intent.binding.quota.map((q, i) => this.quotaPolicy(quotaPolicies[i], q.ledgerKey, now));
    const quotas = await Promise.all(policies.map(async policy => {
      const [s, p] = await Promise.all([this.get(tx, 'quota-state', policy.ledgerKey),
        this.get(tx, 'quota-period', evidenceBinding([policy.ledgerKey, policy.window.id]))]);
      return { policy, state: this.quotaState(s, policy.ledgerKey, policy.migrationId), period: this.quotaPeriod(p, policy.ledgerKey, policy.window) };
    }));
    return { authority, evidence, logical: this.logical(l, authority), ...(attempt === undefined ? {} : { attempt: this.parseAttempt(attempt) }),
      ...(modelSlot ? { modelSlot } : {}), quotas, policy: readPaidPolicy(policyRaw), day: readSpendDay(dayRaw, window),
      paidUserCount: readPaidUser(userRaw, window.key, hash(key.principalId)), window };
  }
  private eligible(current: CurrentAuthority, supplied: AdmissionIntent, claiming: boolean, now: number): AdmissionIntent {
    const { authority, logical: l, attempt, quotas, policy, day, window } = current;
    const r = authority.snapshot.request;
    demand(same(window, civilDayWindow(now, PAID_BUDGET_TIME_ZONE)));
    const selected = authority.snapshot.candidates.filter(c => c.profile.id === supplied.binding.profileId);
    demand(selected.length === 1);
    const plan = planInference({ ...authority.snapshot, candidates: selected, authority: { lookup: ref => current.evidence.get(ref) }, nowMs: now });
    demand(plan.kind === 'plan');
    const intent = admissionIntentFor(authority.key, authority.snapshot, plan);
    demand(admissionBinding(intent) === admissionBinding(supplied));
    demand(!l.cancelled && !l.outputVisible && !l.terminal && !l.completed && !r.cancellation.cancelled
      && same(l.attempts, r.attempts) && l.queueWaitConsumedMs === r.queueWaitConsumedMs
      && (r.surface !== 'chat' || r.maxQueueWaitMs <= 5000));
    if (current.modelSlot) {
      const { policy: slotPolicy, state } = current.modelSlot;
      readModelSlotPolicy(slotPolicy, state.identity, now);
      const occupant = state.occupants[intent.binding.physicalAttemptId];
      if (claiming) {
        const held = readHeldModelSlot(attempt?.heldModelSlot);
        demand(same(held.identity, state.identity) && held.policyRevision === slotPolicy.revision
          && held.intentBinding === modelSlotBinding(admissionBinding(intent)) && occupant?.intentBinding === held.intentBinding && occupant.claimBinding === undefined
          && Object.keys(state.occupants).length <= slotPolicy.limit);
      } else demand(!occupant && Object.keys(state.occupants).length < slotPolicy.limit);
    } else demand(attempt?.heldModelSlot === undefined);
    const amount = intent.binding.budget?.amountNanoUsd ?? 0;
    const own = claiming ? attempt!.heldNanoUsd : 0;
    if (claiming) demand(attempt?.phase === 'held' && same(attempt.window, window) && l.activeAttemptId === intent.binding.physicalAttemptId);
    else demand(!attempt && l.activeAttemptId === null);
    demand(subtract(l.heldNanoUsd, own) + l.spentNanoUsd <= l.logicalLimitNanoUsd
      && amount <= l.logicalLimitNanoUsd - checkedAdd(subtract(l.heldNanoUsd, own), l.spentNanoUsd));
    for (const [index, q] of quotas.entries()) {
      const held = claiming ? attempt!.heldQuota[index] : undefined;
      const expected = intent.binding.quota[index];
      demand(!q.state.quarantined && q.policy.window.startsAtMs <= now && now < q.policy.window.endsAtMs);
      if (held) demand(held.ledgerKey === expected.ledgerKey && held.amount === expected.amount
        && held.policyRevision === q.policy.revision && held.migrationId === q.policy.migrationId && same(held.window, q.policy.window));
      const committed = checkedAdd(subtract(q.state.held, held?.amount ?? 0), q.period.spent);
      demand(committed <= q.policy.limit && expected.amount <= q.policy.limit - committed);
    }
    if (amount) {
      const userLimit = this.options.perUserDailyLimit ?? DEFAULT_PAID_PER_USER_DAILY_LIMIT;
      demand(claiming ? current.paidUserCount >= 1 && current.paidUserCount <= userLimit : current.paidUserCount < userLimit);
      const b = authority.snapshot.budget;
      demand(policy && policy.revision === authority.paidPolicyRevision && policy.updatedAt <= now && policy.capNanoUsd > 0 && b
        && b.periodId === window.key && b.periodStartsAtMs === window.startAt && b.periodEndsAtMs === window.resetAt
        && b.periodLimitNanoUsd <= policy.capNanoUsd && b.periodLimitNanoUsd <= OWNER_PAID_DAILY_CEILING_NANO_USD
        && b.remainingLogicalRequestNanoUsd <= authority.logicalLimitNanoUsd);
      const committed = checkedAdd(subtract(day.heldNanoUsd, own), day.spentNanoUsd);
      const allowedPeriod = Math.min(policy.capNanoUsd, b.periodLimitNanoUsd);
      demand(committed <= allowedPeriod && amount <= allowedPeriod - committed);
      if (claiming) demand(day.pending > 0);
    }
    return intent;
  }
  private async admission<T>(run: () => Promise<T>): Promise<T | { kind: 'denied' }> {
    try { return await run(); }
    catch (error) { if (error instanceof Denied || error instanceof FreeChainDataError) return { kind: 'denied' }; throw error; }
  }
  private captureIntent(input: AdmissionIntent): AdmissionIntent {
    const intent = capture(input);
    demand(intent?.binding && validKey(intent.binding.key) && isIdentifier(intent.binding.physicalAttemptId)
      && isIdentifier(intent.binding.profileId) && isIdentifier(intent.binding.providerId)
      && Array.isArray(intent.binding.quota) && intent.binding.quota.length > 0 && intent.binding.quota.length <= 32
      && intent.binding.quota.every(q => typeof q.ledgerKey === 'string' && q.ledgerKey.length <= 4096 && q.ledgerKey.length > 0
        && nonnegativeInteger(q.amount) && q.amount > 0)
      && new Set(intent.binding.quota.map(q => q.ledgerKey)).size === intent.binding.quota.length);
    this.authorize(intent.binding.key);
    return intent;
  }
  async reserve(input: AdmissionIntent): ReturnType<ExecutionPorts['ledger']['reserve']> {
    return this.admission(async () => {
      const intent = this.captureIntent(input);
      return this.db.runTransaction(async tx => {
        // One final post-read timestamp controls eligibility AND durable accounting.
        const c = await this.current(tx, intent); const now = this.now(); const fresh = this.eligible(c, intent, false, now);
        const reservation: Reservation = { id: hash(fresh.binding.physicalAttemptId), intentBinding: admissionBinding(fresh) };
        const amount = fresh.binding.budget?.amountNanoUsd ?? 0;
        const attempt: AttemptState = { kind: 'gateway_attempt', version: 1, reservation, intent: fresh, phase: 'held',
          window: c.window, heldNanoUsd: amount, createdAtMs: now,
          ...(c.modelSlot ? { heldModelSlot: { identity: c.modelSlot.state.identity, policyRevision: c.modelSlot.policy.revision, intentBinding: modelSlotBinding(admissionBinding(fresh)) } } : {}),
          heldQuota: c.quotas.map((q, i) => ({ ...fresh.binding.quota[i], migrationId: q.policy.migrationId,
            policyRevision: q.policy.revision, window: q.policy.window })) };
        // All reads are complete before the first write, as the real Firestore SDK requires.
        if (c.modelSlot) tx.set(this.db.doc(modelSlotPath('state', c.modelSlot.state.identity)), { ...c.modelSlot.state, occupants: { ...c.modelSlot.state.occupants, [fresh.binding.physicalAttemptId]: { intentBinding: modelSlotBinding(admissionBinding(fresh)), acquiredAtMs: now } } });
        for (const [i, q] of c.quotas.entries()) tx.set(this.ref('quota-state', q.policy.ledgerKey), { ...q.state, held: checkedAdd(q.state.held, attempt.heldQuota[i].amount) });
        if (amount) writeSpendDay(tx, this.db, { ...c.day, heldNanoUsd: checkedAdd(c.day.heldNanoUsd, amount),
          pending: checkedAdd(c.day.pending, 1), requests: checkedAdd(c.day.requests, 1) }, c.policy!.capNanoUsd, now, this.options.adminEmails);
        if (amount) writePaidUser(tx, this.db, c.window, hash(fresh.binding.key.principalId), checkedAdd(c.paidUserCount, 1));
        tx.set(this.ref('logical', fresh.binding.key.logicalRequestId), { ...c.logical, activeAttemptId: fresh.binding.physicalAttemptId, heldNanoUsd: checkedAdd(c.logical.heldNanoUsd, amount) });
        tx.create(this.ref('attempt', fresh.binding.physicalAttemptId), attempt);
        return { kind: 'held' as const, reservation };
      });
    });
  }
  async claim(inputReservation: Reservation, input: AdmissionIntent, queueWaitConsumedMs: number): ReturnType<ExecutionPorts['ledger']['claim']> {
    return this.admission(async () => {
      const reservation = capture(inputReservation); const intent = this.captureIntent(input);
      return this.db.runTransaction(async tx => {
        const c = await this.current(tx, intent);
        demand(c.attempt && same(c.attempt.reservation, reservation));
        const now = this.now(); const fresh = this.eligible(c, intent, true, now);
        const queue = checkedAdd(fresh.request.queueWaitConsumedMs, subtract(now, fresh.request.queueEnteredAtMs));
        demand(nonnegativeInteger(queueWaitConsumedMs) && queueWaitConsumedMs >= fresh.request.queueWaitConsumedMs && queueWaitConsumedMs <= queue && queue <= fresh.request.maxQueueWaitMs
          && now <= fresh.plan.queueUntilMs && now < fresh.request.deadlineAtMs);
        const claim: DispatchClaim = { ...reservation, claimId: hash(`claim:${reservation.id}`), binding: fresh.binding,
          queueWaitConsumedAtDispatchMs: queue };
        const record: AttemptRecord = { physicalAttemptId: fresh.binding.physicalAttemptId, profileId: fresh.binding.profileId,
          outcome: 'uncertain', outputVisible: false };
        if (c.modelSlot) tx.set(this.db.doc(modelSlotPath('state', c.modelSlot.state.identity)), { ...c.modelSlot.state, occupants: { ...c.modelSlot.state.occupants, [fresh.binding.physicalAttemptId]: { ...c.modelSlot.state.occupants[fresh.binding.physicalAttemptId], claimBinding: modelSlotBinding(claim) } } });
        tx.set(this.ref('attempt', fresh.binding.physicalAttemptId), { ...c.attempt, phase: 'claimed', claim, record });
        tx.set(this.ref('logical', fresh.binding.key.logicalRequestId), { ...c.logical, attempts: [...c.logical.attempts, record], queueWaitConsumedMs: queue });
        return { kind: 'claimed' as const, claim };
      });
    });
  }
  private async owned(tx: Transaction, claim: DispatchClaim): Promise<{ attempt: AttemptState; logical: LogicalState }> {
    this.authorize(claim.binding.key);
    const [a, l] = await Promise.all([this.get(tx, 'attempt', claim.binding.physicalAttemptId), this.get(tx, 'logical', claim.binding.key.logicalRequestId)]);
    const attempt = this.parseAttempt(a); const logical = raw(l, 'gateway_logical') as unknown as LogicalState;
    this.validateLogical(logical);
    demand(attempt.claim && same(attempt.claim, claim) && same(logical.key, claim.binding.key));
    demand(attempt.phase === 'settled' || ((attempt.phase === 'claimed' || attempt.phase === 'pending')
      && (logical.activeAttemptId === claim.binding.physicalAttemptId || (attempt.phase === 'pending' && !!attempt.retryRejection))));
    return { attempt, logical };
  }
  /** Only HELD can be proved undispatched by this protocol. CLAIMED retains until reconciliation. */
  async releaseUndispatched(reservation: Reservation, _reason: string): Promise<void> {
    reservation = capture(reservation);
    demand(reservation && /^[a-f0-9]{64}$/.test(reservation.id));
    await this.db.runTransaction(async tx => {
      // Reservation ID is the hash used in the attempt path, not another caller-chosen locator.
      const attemptRef = this.db.doc(`${FREE_CHAIN_COLLECTION}/gateway_attempt_${reservation.id}`);
      const attempt = this.parseAttempt(readData(await tx.get(attemptRef))); this.authorize(attempt.intent.binding.key);
      demand(same(attempt.reservation, reservation));
      if (attempt.phase === 'released') return;
      demand(attempt.phase === 'held', 'Claimed attempts require authoritative non-invocation or usage reconciliation');
      const key = attempt.intent.binding.key;
      const [logicalRaw, dayRaw, policyRaw, ...quotaRaw] = await Promise.all([
        this.get(tx, 'logical', key.logicalRequestId), tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_day_${attempt.window.key}`)).then(readData),
        tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_budget_policy`)).then(readData),
        ...attempt.heldQuota.map(q => this.get(tx, 'quota-state', q.ledgerKey)),
      ]);
      const logical = raw(logicalRaw, 'gateway_logical') as unknown as LogicalState; this.validateLogical(logical);
      demand(same(logical.key, key) && logical.activeAttemptId === attempt.intent.binding.physicalAttemptId
        && logical.heldNanoUsd >= attempt.heldNanoUsd);
      const states = attempt.heldQuota.map((q, i) => this.quotaState(quotaRaw[i], q.ledgerKey, q.migrationId));
      const nextStates = states.map((s, i) => ({ ...s, held: subtract(s.held, attempt.heldQuota[i].amount) }));
      let releasedSlot: GatewayModelSlotState | undefined;
      if (attempt.heldModelSlot) {
        const held = readHeldModelSlot(attempt.heldModelSlot);
        const state = readModelSlotState(readData(await tx.get(this.db.doc(modelSlotPath('state', held.identity)))), held.identity);
        const occupant = state.occupants[attempt.intent.binding.physicalAttemptId];
        demand(occupant?.intentBinding === held.intentBinding && occupant.claimBinding === undefined);
        const occupants = { ...state.occupants }; delete occupants[attempt.intent.binding.physicalAttemptId];
        releasedSlot = { ...state, occupants };
      }
      const nextLogical = { ...logical, activeAttemptId: null, heldNanoUsd: subtract(logical.heldNanoUsd, attempt.heldNanoUsd) };
      const policy = readPaidPolicy(policyRaw);
      let day: SpendDay | undefined;
      if (attempt.heldNanoUsd) { demand(dayRaw !== undefined); const d = readSpendDay(dayRaw, attempt.window);
        day = { ...d, heldNanoUsd: subtract(d.heldNanoUsd, attempt.heldNanoUsd), pending: subtract(d.pending, 1) }; }
      if (releasedSlot) tx.set(this.db.doc(modelSlotPath('state', releasedSlot.identity)), releasedSlot);
      nextStates.forEach(s => tx.set(this.ref('quota-state', s.ledgerKey), s));
      if (day) writeSpendDay(tx, this.db, day, policy?.capNanoUsd ?? 0, this.now(), this.options.adminEmails);
      tx.set(this.ref('logical', key.logicalRequestId), nextLogical);
      tx.set(attemptRef, { ...attempt, phase: 'released' });
    });
  }
  /** Authenticated server cancellation is durable even before the first reservation exists. */
  async cancel(key: ExecutionKey, cancellationId: string): Promise<void> {
    key = capture(key); this.authorize(key);
    await this.db.runTransaction(async tx => {
      const [a, l] = await Promise.all([this.get(tx, 'authority', key.logicalRequestId), this.get(tx, 'logical', key.logicalRequestId)]);
      const authority = raw(a, 'gateway_authority') as unknown as GatewayAuthorityDocument;
      demand(same(authority.key, key) && authority.snapshot.request.cancellation.id === cancellationId);
      const logical = this.logical(l, authority);
      tx.set(this.ref('logical', key.logicalRequestId), { ...logical, cancelled: true });
    });
  }
  private journal(logical: LogicalState, record: AttemptRecord): LogicalState {
    demand(logical.attempts.some(a => a.physicalAttemptId === record.physicalAttemptId));
    return { ...logical, attempts: logical.attempts.map(a => a.physicalAttemptId === record.physicalAttemptId ? mergeRecord(a, record) : a),
      outputVisible: logical.outputVisible || record.outputVisible, terminal: logical.terminal || terminal(record),
      completed: logical.completed || record.outcome === 'completed' };
  }
  async markOutputVisible(claim: DispatchClaim): Promise<void> {
    claim = capture(claim);
    await this.db.runTransaction(async tx => {
      const { attempt, logical } = await this.owned(tx, claim);
      demand(!logical.cancelled && !attempt.retryRejection && attempt.phase !== 'settled', 'Output requires a live, non-cancelled claim');
      const record = { ...attempt.record!, outputVisible: true };
      tx.set(this.ref('attempt', claim.binding.physicalAttemptId), { ...attempt, record });
      tx.set(this.ref('logical', claim.binding.key.logicalRequestId), this.journal(logical, record));
    });
  }
  async retain(claim: DispatchClaim, record: AttemptRecord, _reason: string): Promise<void> {
    claim = capture(claim); record = capture(record);
    demand(validRecord(record) && record.physicalAttemptId === claim.binding.physicalAttemptId && record.profileId === claim.binding.profileId);
    await this.db.runTransaction(async tx => {
      const owned = await this.owned(tx, claim);
      const merged = mergeRecord(owned.attempt.record!, record);
      const attempt = { ...owned.attempt, record: merged,
        phase: owned.attempt.phase === 'settled' ? 'settled' as const : 'pending' as const };
      // Never resurrect a settled hold, erase terminal/output facts, or use TTL to refund uncertainty.
      tx.set(this.ref('attempt', claim.binding.physicalAttemptId), attempt);
      tx.set(this.ref('logical', claim.binding.key.logicalRequestId), this.journal(owned.logical, record));
    });
  }
  async retainRejectedForRetry(claim: DispatchClaim, rejection: AuthenticatedRejection): Promise<void> {
    claim = capture(claim); rejection = capture(rejection);
    demand(rejection && isIdentifier(rejection.evidenceRef) && same(rejection.binding, claim.binding)
      && rejection.kind === 'http-rejected' && rejection.status === 429
      && rejection.generationRejected === true && rejection.outputVisible === false
      && nonnegativeInteger(rejection.receivedAtMs) && (rejection.cooldownUntilMs === undefined
        || (nonnegativeInteger(rejection.cooldownUntilMs) && rejection.cooldownUntilMs >= rejection.receivedAtMs
          && rejection.cooldownUntilMs <= rejection.receivedAtMs + 7 * 86400000)));
    await this.db.runTransaction(async tx => {
      const { attempt, logical } = await this.owned(tx, claim);
      const trusted = raw(await this.get(tx, 'rejection', rejection.evidenceRef), 'gateway_rejection');
      demand(same(trusted.rejection, rejection));
      demand(rejection.receivedAtMs >= attempt.createdAtMs && rejection.receivedAtMs <= this.now());
      // A replay can acknowledge this exact persisted transition but cannot clear a newer slot.
      if (attempt.retryRejection) {
        demand(same(attempt.retryRejection, rejection));
        return;
      }
      demand((attempt.phase === 'claimed' || attempt.phase === 'pending')
        && logical.activeAttemptId === claim.binding.physicalAttemptId
        && !logical.cancelled && !logical.outputVisible && !logical.terminal && !logical.completed
        && !attempt.record!.outputVisible && attempt.record!.outcome === 'uncertain');
      const record: AttemptRecord = { physicalAttemptId: claim.binding.physicalAttemptId,
        profileId: claim.binding.profileId, outcome: 'definite-failure',
        failureClass: 'retryable-provider-failure', outputVisible: false };
      tx.set(this.ref('attempt', claim.binding.physicalAttemptId), { ...attempt, phase: 'pending', record, retryRejection: rejection });
      tx.set(this.ref('logical', claim.binding.key.logicalRequestId), { ...this.journal(logical, record), activeAttemptId: null });
    });
  }
  private charge(usage: AuthoritativeUsage): { basis: 'actual' | 'conservative-ceiling'; amount: number; rateCardVersion?: string } {
    const u = raw(usage);
    if (u.chargeBasis === 'conservative-ceiling') {
      demand(!('actualNanoUsd' in u) && nonnegativeInteger(u.conservativeCeilingNanoUsd)
        && typeof u.rateCardVersion === 'string' && isIdentifier(u.rateCardVersion));
      return { basis: 'conservative-ceiling', amount: u.conservativeCeilingNanoUsd, rateCardVersion: u.rateCardVersion };
    }
    demand((u.chargeBasis === undefined || u.chargeBasis === 'actual') && nonnegativeInteger(u.actualNanoUsd)
      && !('conservativeCeilingNanoUsd' in u) && !('rateCardVersion' in u));
    return { basis: 'actual', amount: u.actualNanoUsd };
  }
  private validateUsage(claim: DispatchClaim, usage: AuthoritativeUsage): UsageViolation {
    const charge = this.charge(usage);
    demand(usage && usage.final === true && isIdentifier(usage.evidenceRef) && same(usage.binding, claim.binding)
      && typeof usage.outputVisible === 'boolean'
      && Array.isArray(usage.quotaUsage) && usage.quotaUsage.length === claim.binding.quota.length);
    outcomeRecord(claim, usage.outcome, usage.outputVisible);
    const consumed = new Map(usage.quotaUsage.map(q => [q.ledgerKey, q.amount]));
    demand(consumed.size === claim.binding.quota.length && claim.binding.quota.every(q => nonnegativeInteger(consumed.get(q.ledgerKey))));
    const maximum = claim.binding.budget?.amountNanoUsd ?? 0;
    if (charge.basis === 'conservative-ceiling') demand(claim.binding.budget
      && charge.rateCardVersion === claim.binding.budget.rateCardVersion && usage.outcome.kind === 'completed');
    return { cost: charge.amount > maximum ? (maximum ? 'maximum-cost-exceeded' : 'unexpected-free-charge') : null,
      quotaLedgerKeys: claim.binding.quota.filter(q => consumed.get(q.ledgerKey)! > q.amount).map(q => q.ledgerKey) };
  }
  private async settlement(claim: DispatchClaim, usage: AuthoritativeUsage, expectedViolation?: UsageViolation, replaceConservative = false): Promise<void> {
    this.charge(usage); // Reject mixed own-properties before canonical capture can erase undefined fields.
    claim = capture(claim); usage = capture(usage); if (expectedViolation) expectedViolation = capture(expectedViolation);
    const charge = this.charge(usage); const initialViolation = this.validateUsage(claim, usage);
    demand(!replaceConservative || charge.basis === 'actual');
    if (!replaceConservative) demand(expectedViolation ? same(expectedViolation, initialViolation)
      && (!!initialViolation.cost || initialViolation.quotaLedgerKeys.length > 0)
      : !initialViolation.cost && initialViolation.quotaLedgerKeys.length === 0);
    await this.db.runTransaction(async tx => {
      const { attempt, logical } = await this.owned(tx, claim);
      const [usageRaw, receiptRaw, dayRaw, policyRaw, ...resources] = await Promise.all([
        this.get(tx, 'usage', usage.evidenceRef), this.get(tx, 'receipt', usage.evidenceRef),
        tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_day_${attempt.window.key}`)).then(readData),
        tx.get(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_budget_policy`)).then(readData),
        ...attempt.heldQuota.flatMap(q => [this.get(tx, 'quota-state', q.ledgerKey),
          this.get(tx, 'quota-period', evidenceBinding([q.ledgerKey, q.window.id]))]),
      ]);
      if (charge.basis === 'conservative-ceiling') demand(attempt.intent.candidate.price
        && attempt.intent.candidate.price.rateCardVersion === charge.rateCardVersion
        && claim.binding.priceBinding === evidenceBinding(withoutEvidence(attempt.intent.candidate.price)));
      const trustedUsage = raw(usageRaw, 'gateway_usage'); demand(same(trustedUsage.usage, usage));
      const usageBinding = evidenceBinding(usage);
      const prior = attempt.settlement;
      if (attempt.phase === 'settled' && ((prior?.evidenceRef === usage.evidenceRef && prior.usageBinding === usageBinding)
        || (prior?.replaces?.evidenceRef === usage.evidenceRef && prior.replaces.usageBinding === usageBinding))) {
        demand(receiptRaw !== undefined && (receiptRaw as Raw).attemptId === claim.binding.physicalAttemptId
          && (receiptRaw as Raw).usageBinding === usageBinding);
        return;
      }
      demand(receiptRaw === undefined, 'Receipt has already been consumed');
      let previousUsage: AuthoritativeUsage | undefined; let previousAmount = 0;
      if (replaceConservative) {
        demand(attempt.phase === 'settled' && prior?.chargeBasis === 'conservative-ceiling' && !prior.replaces);
        const [previousRaw, previousReceiptRaw] = await Promise.all([this.get(tx, 'usage', prior.evidenceRef), this.get(tx, 'receipt', prior.evidenceRef)]);
        const previous = raw(previousRaw, 'gateway_usage');
        const previousReceipt = raw(previousReceiptRaw, 'gateway_receipt');
        demand(previousReceipt.attemptId === claim.binding.physicalAttemptId && previousReceipt.usageBinding === prior.usageBinding);
        previousUsage = previous.usage as AuthoritativeUsage;
        demand(evidenceBinding(previousUsage) === prior.usageBinding);
        this.validateUsage(claim, previousUsage);
        demand((!attempt.record!.outputVisible || usage.outputVisible)
          && (attempt.record!.outcome !== 'completed' || usage.outcome.kind === 'completed')
          && (!terminal(attempt.record!) || same(previousUsage.outcome, usage.outcome)));
        const previousCharge = this.charge(previousUsage);
        demand(previousCharge.basis === 'conservative-ceiling' && previousCharge.amount === prior.bookedNanoUsd);
        previousAmount = previousCharge.amount;
      } else demand(attempt.phase !== 'settled' && logical.heldNanoUsd >= attempt.heldNanoUsd);
      const violation: UsageViolation = { ...initialViolation,
        cost: initialViolation.cost ?? (replaceConservative && charge.amount > previousAmount ? 'maximum-cost-exceeded' : null) };
      const quarantine = !!violation.cost || violation.quotaLedgerKeys.length > 0;
      const previousQuota = new Map(previousUsage?.quotaUsage.map(q => [q.ledgerKey, q.amount]) ?? []);
      const actual = new Map(usage.quotaUsage.map(q => [q.ledgerKey, q.amount]));
      const settledQuotas = attempt.heldQuota.map((q, i) => {
        const state = this.quotaState(resources[2 * i], q.ledgerKey, q.migrationId);
        const period = this.quotaPeriod(resources[2 * i + 1], q.ledgerKey, q.window);
        return { state: { ...state, held: replaceConservative ? state.held : subtract(state.held, q.amount), quarantined: state.quarantined || quarantine },
          period: { ...period, spent: checkedAdd(subtract(period.spent, previousQuota.get(q.ledgerKey) ?? 0), actual.get(q.ledgerKey)!) } };
      });
      const policy = readPaidPolicy(policyRaw); const now = this.now(); demand(now >= attempt.createdAtMs);
      let day: SpendDay | undefined;
      if (attempt.heldNanoUsd || charge.amount || replaceConservative) {
        if (attempt.heldNanoUsd) demand(dayRaw !== undefined);
        const d = readSpendDay(dayRaw, attempt.window);
        day = { ...d, heldNanoUsd: replaceConservative ? d.heldNanoUsd : subtract(d.heldNanoUsd, attempt.heldNanoUsd),
          pending: replaceConservative ? d.pending : subtract(d.pending, attempt.heldNanoUsd ? 1 : 0),
          conservativePending: replaceConservative ? subtract(d.conservativePending ?? 0, 1)
            : checkedAdd(d.conservativePending ?? 0, charge.basis === 'conservative-ceiling' ? 1 : 0),
          spentNanoUsd: checkedAdd(subtract(d.spentNanoUsd, previousAmount), charge.amount) };
      }
      const record = mergeRecord(attempt.record!, outcomeRecord(claim, usage.outcome, usage.outputVisible));
      const nextLogical = { ...this.journal(logical, record), activeAttemptId: !replaceConservative && logical.activeAttemptId === claim.binding.physicalAttemptId ? null : logical.activeAttemptId,
        heldNanoUsd: replaceConservative ? logical.heldNanoUsd : subtract(logical.heldNanoUsd, attempt.heldNanoUsd),
        spentNanoUsd: checkedAdd(subtract(logical.spentNanoUsd, previousAmount), charge.amount) };
      // This complete write set is atomic: no release window before quarantine/accounting.
      settledQuotas.forEach(({ state, period }) => { tx.set(this.ref('quota-state', state.ledgerKey), state);
        tx.set(this.ref('quota-period', evidenceBinding([period.ledgerKey, period.window.id])), period); });
      if (day) writeSpendDay(tx, this.db, day, policy?.capNanoUsd ?? 0, now, this.options.adminEmails);
      if (quarantine) {
        tx.set(this.ref('profile-quarantine', evidenceBinding([claim.binding.providerId, claim.binding.profileId])), {
          kind: 'gateway_profile_quarantine', version: 1, providerId: claim.binding.providerId, profileId: claim.binding.profileId,
          attemptId: claim.binding.physicalAttemptId, evidenceRef: usage.evidenceRef, atMs: now,
        });
        tx.set(this.ref('incident', claim.binding.physicalAttemptId), { kind: 'gateway_accounting_incident', version: 1,
          attemptId: claim.binding.physicalAttemptId, evidenceRef: usage.evidenceRef, usageBinding, violation, unresolved: true, atMs: now });
        if (violation.cost) tx.set(this.db.doc(`${FREE_CHAIN_COLLECTION}/paid_budget_policy`), {
          kind: 'paid_budget_policy', version: 1, revision: checkedAdd(policy?.revision ?? 0, 1), capNanoUsd: 0, updatedAt: now, source: 'safety',
        } satisfies PaidBudgetPolicy);
      }
      tx.set(this.ref('logical', claim.binding.key.logicalRequestId), nextLogical);
      tx.set(this.ref('attempt', claim.binding.physicalAttemptId), { ...attempt, phase: 'settled', record,
        settlement: { evidenceRef: usage.evidenceRef, usageBinding, chargeBasis: charge.basis, bookedNanoUsd: charge.amount,
          ...(replaceConservative ? { replaces: { evidenceRef: prior!.evidenceRef, usageBinding: prior!.usageBinding } } : {}) } });
      tx.create(this.ref('receipt', usage.evidenceRef), { kind: 'gateway_receipt', version: 1, attemptId: claim.binding.physicalAttemptId, usageBinding, chargeBasis: charge.basis, bookedNanoUsd: charge.amount });
    });
  }
  async settle(claim: DispatchClaim, usage: AuthoritativeUsage): Promise<void> { await this.settlement(claim, usage); }
  async settleAndQuarantine(claim: DispatchClaim, usage: AuthoritativeUsage, violation: UsageViolation): Promise<void> {
    await this.settlement(claim, usage, violation);
  }
  /** Trusted actual proof replaces, rather than adds to, a prior conservative booking. */
  async reconcileActual(claim: DispatchClaim, usage: Extract<AuthoritativeUsage, { actualNanoUsd: number }>): Promise<void> {
    await this.settlement(claim, usage, undefined, true);
  }
  /** No dispatch permission: only authenticated reconciliation of an already booked ceiling. */
  async readReconcilable(key: ExecutionKey, physicalAttemptId: string): Promise<PendingAttempt | undefined> {
    key = capture(key); this.authorize(key); demand(isIdentifier(physicalAttemptId));
    return this.db.runTransaction(async tx => {
      const value = await this.get(tx, 'attempt', physicalAttemptId); if (value === undefined) return undefined;
      const attempt = this.parseAttempt(value); demand(same(attempt.intent.binding.key, key));
      if (attempt.phase !== 'settled' || (attempt.settlement?.chargeBasis !== 'conservative-ceiling' && !attempt.settlement?.replaces)) return undefined;
      return { claim: attempt.claim!, record: attempt.record! };
    });
  }
  async readPending(key: ExecutionKey, physicalAttemptId: string): Promise<PendingAttempt | undefined> {
    key = capture(key); this.authorize(key); demand(isIdentifier(physicalAttemptId));
    return this.db.runTransaction(async tx => {
      const value = await this.get(tx, 'attempt', physicalAttemptId); if (value === undefined) return undefined;
      const attempt = this.parseAttempt(value); demand(same(attempt.intent.binding.key, key));
      if (attempt.phase !== 'claimed' && attempt.phase !== 'pending') return undefined;
      return { claim: attempt.claim!, record: attempt.record! };
    });
  }
}
