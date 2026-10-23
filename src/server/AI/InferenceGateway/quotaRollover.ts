/**
 * Bounded server-only quota maintenance. A clock tick never renews human review,
 * clears a pending hold, enrolls an account, or proves upstream free balance.
 * Rule/import documents must be written by an authenticated administrative workflow;
 * matching JSON alone is not authentication. No health check calls this writer.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FREE_CHAIN_COLLECTION, readData } from '../FreeChain/paidLedger';
import { checkedAdd, civilDayWindow, DAY_MS, nonnegativeInteger, validTime } from '../FreeChain/quota';
import { isIdentifier } from './capabilities';
import { gatewayAccountFencePath, gatewayAccountScopeIds, readGatewayAccountAuthority } from './accountMigration';
import { gatewayLedgerPath, type GatewayQuotaPolicy } from './firestoreLedger';
import { evidenceBinding, quotaLedgerKey, validQuotaDimension } from './profiles';
import type { QuotaDimension } from './types';

export type GatewayQuotaReset =
  | { kind: 'fixed-interval'; anchorAtMs: number; intervalMs: number }
  | { kind: 'civil-day'; timeZone: string }
  | { kind: 'authoritative-import'; semantics: 'unknown' | 'rolling' };
export type GatewayQuotaWindow = GatewayQuotaPolicy['window'];
export interface GatewayQuotaRule {
  kind: 'gateway_quota_rule'; version: 1; ledgerKey: string; revision: number;
  dimension: QuotaDimension;
  /** The entire reviewed overlap set, not just the dimension most convenient to reset. */
  overlappingDimensions: readonly QuotaDimension[];
  migrationId: string; limit: number;
  reviewRef: string; reviewedAtMs: number; expiresAtMs: number;
  reset: GatewayQuotaReset;
  /** Local pressure allowance is deliberately NOT provider remaining balance. */
  accounting: 'local-only' | 'upstream-verified';
  /** Exact authenticated, reviewed account authority. Filled by administrative enrollment. */
  accountPolicyPath: string; accountPolicyBinding: string;
  zeroBaseline?: {
    kind: 'local-reservation-window' | 'exclusive-provider-reset'; evidenceRef: string;
    /** Only meaningful for provider-reset proof; must predate the new reset boundary. */
    exclusiveSinceMs?: number;
  };
  usageSource?: { id: string; evidenceRef: string; maxAgeMs: number };
}
export interface GatewayQuotaUsageImport {
  kind: 'gateway_quota_usage_import'; version: 1; id: string; ledgerKey: string;
  ruleRevision: number; ruleBinding: string; accountPolicyBinding: string;
  /** Import cannot be replayed after a reservation, settlement, or policy change. */
  previousPolicyBinding: string; previousStateBinding: string;
  sourceId: string; sourceEvidenceRef: string; evidenceRef: string;
  observedAtMs: number; expiresAtMs: number;
  window: GatewayQuotaWindow; spent: number;
  /** Complete conservative snapshot, including all applicable shared consumers. */
  coverage: 'complete-through-observation';
}
export interface GatewayRolloverPolicy extends GatewayQuotaPolicy {
  rolloverRule: { revision: number; binding: string };
  rollover?: { operationBinding: string; previousRevision: number; atMs: number; baseline: 'local-zero' | 'verified-zero' | 'authenticated-import'; importId?: string };
}
export interface GatewayQuotaRolloverRequest {
  dimensions: readonly QuotaDimension[];
  /** A stable ID across retries, including a lost transaction response. */
  operationId: string;
  expectedPolicyRevisions: readonly { ledgerKey: string; revision: number }[];
  imports?: readonly { ledgerKey: string; importId: string }[];
}
export type GatewayQuotaRolloverReason = 'invalid-request' | 'missing-rule' | 'invalid-rule' | 'review-expired'
  | 'account-unavailable' | 'missing-policy' | 'invalid-policy' | 'policy-conflict' | 'missing-state'
  | 'invalid-state' | 'quarantined' | 'missing-period' | 'invalid-period' | 'import-required'
  | 'invalid-import' | 'period-conflict' | 'clock-changed' | 'store-unavailable';
export interface GatewayQuotaRolloverStatus {
  status: 'current' | 'ready' | 'rolled' | 'blocked';
  /** A failed post-commit clock check reports the committed outcome, never fake rollback. */
  committed: boolean | 'unknown';
  dimensions: { ledgerKey: string; policyRevision: number; window: GatewayQuotaWindow; held: number;
    spent: number; accounting: GatewayQuotaRule['accounting']; upstreamRemaining: 'unknown'; due: boolean }[];
  reason?: GatewayQuotaRolloverReason;
  requiredEvidence?: string[];
}
export interface GatewayQuotaRolloverOptions {
  now(): number;
}
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
type Raw = Record<string, unknown>;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
export function gatewayQuotaRulePath(ledgerKey: string): string {
  return `${FREE_CHAIN_COLLECTION}/gateway_quota_rule_${hash(ledgerKey)}`;
}
export function gatewayQuotaImportPath(ledgerKey: string, importId: string): string {
  return `${FREE_CHAIN_COLLECTION}/gateway_quota_import_${hash(evidenceBinding([ledgerKey, importId]))}`;
}
class Unavailable extends Error {
  constructor(readonly reason: GatewayQuotaRolloverReason, readonly needed: string[]) { super(reason); }
}
function requireValue(value: unknown, reason: GatewayQuotaRolloverReason, needed: string): asserts value {
  if (!value) throw new Unavailable(reason, [needed]);
}
function object(value: unknown, reason: GatewayQuotaRolloverReason): Raw {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), reason, 'A valid nonexpiring server-owned document is required.');
  const data = value as Raw;
  requireValue(!('expiresAt' in data) && !('expireAt' in data), reason, 'Quota authority and pending state must not use Firestore TTL.');
  return data;
}
function current(start: number, end: number, now: number): boolean {
  return nonnegativeInteger(start) && nonnegativeInteger(end) && start <= now && now < end;
}
function validWindow(window: GatewayQuotaWindow): boolean {
  return !!window && isIdentifier(window.id) && nonnegativeInteger(window.startsAtMs)
    && nonnegativeInteger(window.endsAtMs) && window.startsAtMs < window.endsAtMs;
}
function dimensionKeys(dimensions: readonly QuotaDimension[]): string[] {
  requireValue(Array.isArray(dimensions) && dimensions.length > 0 && dimensions.length <= 32
    && dimensions.every(d => validQuotaDimension(d, d?.scope?.providerId) && isIdentifier(d.scope.providerId))
    && dimensions.some(d => d.scope.kind !== 'model'), 'invalid-request', 'One to 32 canonical overlapping account, organization, project or model dimensions are required.');
  const keys = dimensions.map(quotaLedgerKey).sort();
  requireValue(new Set(keys).size === keys.length, 'invalid-request', 'Each canonical dimension must appear exactly once.');
  return keys;
}
/** Pure validator shared with authenticated enrollment and the runtime issuer. Does not write. */
export function reviewedGatewayQuotaRule(value: unknown, dimension: QuotaDimension, dimensions: readonly QuotaDimension[], now: number): GatewayQuotaRule {
  validTime(now);
  const r = object(value, value === undefined ? 'missing-rule' : 'invalid-rule') as unknown as GatewayQuotaRule;
  requireValue(r.kind === 'gateway_quota_rule' && r.version === 1 && r.ledgerKey === quotaLedgerKey(dimension)
    && same(r.dimension, dimension) && same(dimensionKeys(r.overlappingDimensions), dimensionKeys(dimensions))
    && nonnegativeInteger(r.revision) && r.revision > 0 && isIdentifier(r.migrationId) && nonnegativeInteger(r.limit)
    && isIdentifier(r.reviewRef) && ['local-only', 'upstream-verified'].includes(r.accounting)
    && typeof r.accountPolicyPath === 'string' && /^free_chat_chain\/gateway_account_[a-z_]+_[a-f0-9]{64}$/.test(r.accountPolicyPath)
    && typeof r.accountPolicyBinding === 'string' && r.accountPolicyBinding.length > 0 && r.accountPolicyBinding.length <= 32_768,
  'invalid-rule', 'Review the exact quota identity, overlap set, account policy, accounting basis, limit and rule revision.');
  requireValue(current(r.reviewedAtMs, r.expiresAtMs, now) && r.expiresAtMs - r.reviewedAtMs <= DAY_MS,
    'review-expired', 'An independently reviewed, unexpired quota rule is required; rollover cannot renew review.');
  requireValue(r.reset && ['fixed-interval', 'civil-day', 'authoritative-import'].includes(r.reset.kind),
    'invalid-rule', 'An explicit reviewed reset rule is required. Meter names do not define resets.');
  if (r.reset.kind === 'fixed-interval') requireValue(nonnegativeInteger(r.reset.anchorAtMs)
    && nonnegativeInteger(r.reset.intervalMs) && r.reset.intervalMs >= 1000 && r.reset.intervalMs <= 366 * DAY_MS,
  'invalid-rule', 'A reviewed fixed interval and absolute anchor are required.');
  if (r.reset.kind === 'civil-day') {
    requireValue(typeof r.reset.timeZone === 'string' && r.reset.timeZone.length <= 128, 'invalid-rule', 'A reviewed IANA civil timezone is required.');
    try { civilDayWindow(now, r.reset.timeZone); } catch { throw new Unavailable('invalid-rule', ['A supported civil timezone is required.']); }
  }
  if (r.reset.kind === 'authoritative-import') requireValue(['unknown', 'rolling'].includes(r.reset.semantics),
    'invalid-rule', 'Unknown or rolling semantics require an authenticated complete usage import.');
  if (r.zeroBaseline) requireValue(isIdentifier(r.zeroBaseline.evidenceRef)
    && ((r.accounting === 'local-only' && r.zeroBaseline.kind === 'local-reservation-window')
      || (r.accounting === 'upstream-verified' && r.zeroBaseline.kind === 'exclusive-provider-reset'
        && nonnegativeInteger(r.zeroBaseline.exclusiveSinceMs))),
  'invalid-rule', 'A zero baseline must state its reviewed local-only or exclusive upstream basis.');
  if (r.usageSource) requireValue(isIdentifier(r.usageSource.id) && isIdentifier(r.usageSource.evidenceRef)
    && nonnegativeInteger(r.usageSource.maxAgeMs) && r.usageSource.maxAgeMs > 0 && r.usageSource.maxAgeMs <= 300_000,
  'invalid-rule', 'An authenticated usage source and bounded freshness are required.');
  return r;
}
/** Review renewal does not mint a new period: identity binds reset semantics and UTC boundaries. */
export function gatewayQuotaWindow(rule: GatewayQuotaRule, now: number): GatewayQuotaWindow | undefined {
  validTime(now);
  let startsAtMs: number; let endsAtMs: number;
  if (rule.reset.kind === 'authoritative-import') return undefined;
  if (rule.reset.kind === 'fixed-interval') {
    const { anchorAtMs, intervalMs } = rule.reset;
    requireValue(nonnegativeInteger(anchorAtMs) && nonnegativeInteger(intervalMs) && intervalMs > 0 && now >= anchorAtMs,
      'invalid-rule', 'The reset anchor must be valid and no later than the observed time.');
    startsAtMs = anchorAtMs + Math.floor((now - anchorAtMs) / intervalMs) * intervalMs;
    endsAtMs = checkedAdd(startsAtMs, intervalMs);
  } else {
    const window = civilDayWindow(now, rule.reset.timeZone); startsAtMs = window.startAt; endsAtMs = window.resetAt;
  }
  validTime(startsAtMs); validTime(endsAtMs);
  return { id: `window-${hash(evidenceBinding(rule.reset)).slice(0, 16)}-${startsAtMs}-${endsAtMs}`, startsAtMs, endsAtMs };
}

interface Prepared {
  rule: GatewayQuotaRule; account: unknown; policy: GatewayRolloverPolicy; state: Raw;
  window: GatewayQuotaWindow; spent: number; due: boolean;
  baseline?: NonNullable<GatewayRolloverPolicy['rollover']>['baseline'];
  importId?: string; imported?: GatewayQuotaUsageImport; activeImported?: boolean;
}
/**
 * All overlapping dimensions commit together (at most 32), with at most five SDK
 * transaction attempts. Firestore's read set supplies the CAS for policy, state,
 * rule, account and import documents. No remote provider call occurs in a retry.
 */
export class GatewayQuotaRollover {
  constructor(private readonly db: Db, private readonly options: GatewayQuotaRolloverOptions) {
    if (!db || typeof db.doc !== 'function' || typeof db.runTransaction !== 'function'
      || !options || typeof options.now !== 'function') {
      throw new Error('Quota rollover requires trusted server composition');
    }
  }
  inspect(request: GatewayQuotaRolloverRequest): Promise<GatewayQuotaRolloverStatus> { return this.run(request, false); }
  rollover(request: GatewayQuotaRolloverRequest): Promise<GatewayQuotaRolloverStatus> { return this.run(request, true); }
  private clock(): number { const now = this.options.now(); validTime(now); return now; }
  private async get(tx: Transaction, path: string): Promise<unknown> { return readData(await tx.get(this.db.doc(path))); }
  private validateRequest(request: GatewayQuotaRolloverRequest): string {
    requireValue(!!request && isIdentifier(request.operationId), 'invalid-request', 'A stable operation ID is required.');
    const keys = dimensionKeys(request.dimensions);
    requireValue(Array.isArray(request.expectedPolicyRevisions) && request.expectedPolicyRevisions.length === keys.length
      && request.expectedPolicyRevisions.every(p => p && nonnegativeInteger(p.revision) && p.revision > 0)
      && same(request.expectedPolicyRevisions.map(p => p.ledgerKey).sort(), keys),
    'invalid-request', 'Supply exactly one current policy revision for every reviewed dimension.');
    requireValue(!request.imports || (Array.isArray(request.imports) && request.imports.length <= keys.length
      && request.imports.every(i => i && keys.includes(i.ledgerKey) && isIdentifier(i.importId))
      && new Set(request.imports.map(i => i.ledgerKey)).size === request.imports.length),
    'invalid-request', 'Usage import IDs must be unique and bound to requested dimensions.');
    return evidenceBinding({ operationId: request.operationId, dimensions: keys,
      revisions: [...request.expectedPolicyRevisions].sort((a, b) => a.ledgerKey.localeCompare(b.ledgerKey)),
      imports: [...request.imports ?? []].sort((a, b) => a.ledgerKey.localeCompare(b.ledgerKey)) });
  }
  private validateAccount(account: unknown, rule: GatewayQuotaRule, now: number): void {
    object(account, 'account-unavailable');
    let valid = false;
    try {
      const authority = readGatewayAccountAuthority(account, rule.overlappingDimensions, now);
      valid = rule.accountPolicyBinding === evidenceBinding(account) && rule.migrationId === authority.migrationId
        && rule.accountPolicyPath === gatewayAccountFencePath(authority.provider, gatewayAccountScopeIds(rule.overlappingDimensions))
        && rule.accounting === 'local-only';
    } catch { /* Unknown account authority cannot prove a quota baseline. */ }
    requireValue(valid, 'account-unavailable', 'The exact reviewed canonical-account authority is required. Local-only accounting cannot attest upstream balance.');
  }
  private readImport(value: unknown, id: string, rule: GatewayQuotaRule, policy: GatewayRolloverPolicy, state: Raw, now: number): GatewayQuotaUsageImport {
    const i = object(value, value === undefined ? 'import-required' : 'invalid-import') as unknown as GatewayQuotaUsageImport;
    requireValue(rule.usageSource && i.kind === 'gateway_quota_usage_import' && i.version === 1 && i.id === id
      && i.ledgerKey === rule.ledgerKey && i.ruleRevision === rule.revision && i.ruleBinding === evidenceBinding(rule)
      && i.accountPolicyBinding === rule.accountPolicyBinding && i.previousPolicyBinding === evidenceBinding(policy)
      && i.previousStateBinding === evidenceBinding(state) && i.sourceId === rule.usageSource.id
      && i.sourceEvidenceRef === rule.usageSource.evidenceRef && isIdentifier(i.evidenceRef)
      && i.coverage === 'complete-through-observation' && nonnegativeInteger(i.spent)
      && current(i.observedAtMs, i.expiresAtMs, now) && now - i.observedAtMs <= rule.usageSource.maxAgeMs
      && i.observedAtMs >= policy.window.endsAtMs && validWindow(i.window)
      && current(i.window.startsAtMs, i.window.endsAtMs, now) && i.window.startsAtMs >= policy.window.endsAtMs
      && i.window.startsAtMs <= i.observedAtMs && i.window.endsAtMs <= i.expiresAtMs,
    'invalid-import', 'A fresh authenticated complete usage import must bind the exact previous policy, nonexpiring holds, reviewed rule, account and new window.');
    return i;
  }
  private readActiveImport(value: unknown, id: string, rule: GatewayQuotaRule, window: GatewayQuotaWindow, spent: number, now: number): GatewayQuotaUsageImport {
    const i = object(value, value === undefined ? 'import-required' : 'invalid-import') as unknown as GatewayQuotaUsageImport;
    requireValue(rule.usageSource && i.kind === 'gateway_quota_usage_import' && i.version === 1 && i.id === id
      && i.ledgerKey === rule.ledgerKey && i.ruleRevision === rule.revision && i.ruleBinding === evidenceBinding(rule)
      && i.accountPolicyBinding === rule.accountPolicyBinding && i.sourceId === rule.usageSource.id
      && i.sourceEvidenceRef === rule.usageSource.evidenceRef && isIdentifier(i.evidenceRef)
      && i.coverage === 'complete-through-observation' && nonnegativeInteger(i.spent) && i.spent <= spent
      && current(i.observedAtMs, i.expiresAtMs, now) && now - i.observedAtMs <= rule.usageSource.maxAgeMs
      && same(i.window, window) && window.startsAtMs <= i.observedAtMs && window.endsAtMs <= i.expiresAtMs,
    'invalid-import', 'An active unknown or rolling window needs its exact authenticated import provenance and current source freshness.');
    return i;
  }
  private async prepare(tx: Transaction, request: GatewayQuotaRolloverRequest, dimension: QuotaDimension, operationBinding: string, now: number): Promise<Prepared> {
    const key = quotaLedgerKey(dimension);
    const [ruleRaw, policyRaw, stateRaw] = await Promise.all([
      this.get(tx, gatewayQuotaRulePath(key)), this.get(tx, gatewayLedgerPath('quota-policy', key)),
      this.get(tx, gatewayLedgerPath('quota-state', key)),
    ]);
    const rule = reviewedGatewayQuotaRule(ruleRaw, dimension, request.dimensions, now);
    const policy = object(policyRaw, policyRaw === undefined ? 'missing-policy' : 'invalid-policy') as unknown as GatewayRolloverPolicy;
    requireValue(policy.kind === 'gateway_quota_policy' && policy.version === 1 && policy.ledgerKey === key
      && policy.authority === 'gateway-local-capacity' && policy.accountingBasis === 'gateway-local-only' && policy.migrationId === rule.migrationId
      && nonnegativeInteger(policy.revision) && policy.revision > 0 && policy.limit === rule.limit && validWindow(policy.window)
      && policy.rolloverRule?.revision === rule.revision && policy.rolloverRule.binding === evidenceBinding(rule),
    'invalid-policy', 'The existing policy must bind the exact reviewed rule revision, limit, account migration and period.');
    const expected = request.expectedPolicyRevisions.find(p => p.ledgerKey === key)!.revision;
    const replay = policy.rollover?.operationBinding === operationBinding && policy.rollover.previousRevision === expected
      && policy.revision === expected + 1;
    requireValue(policy.revision === expected || replay, 'policy-conflict', 'Re-read current policy revisions before submitting a different operation.');
    const state = object(stateRaw, stateRaw === undefined ? 'missing-state' : 'invalid-state');
    requireValue(state.kind === 'gateway_quota_state' && state.version === 1 && state.ledgerKey === key
      && state.migrationId === rule.migrationId && nonnegativeInteger(state.held) && typeof state.quarantined === 'boolean',
    'invalid-state', 'Import the exact canonical nonexpiring held total; missing state never means zero.');
    requireValue(state.quarantined === false, 'quarantined', 'A separate reviewed incident recovery is required before quota maintenance.');
    const [account, periodRaw] = await Promise.all([
      this.get(tx, rule.accountPolicyPath),
      this.get(tx, gatewayLedgerPath('quota-period', evidenceBinding([key, policy.window.id]))),
    ]);
    this.validateAccount(account, rule, now);
    const period = object(periodRaw, periodRaw === undefined ? 'missing-period' : 'invalid-period');
    requireValue(period.kind === 'gateway_quota_period' && period.version === 1 && period.ledgerKey === key
      && same(period.window, policy.window) && nonnegativeInteger(period.spent),
    'invalid-period', 'The existing canonical period and imported spent amount are required.');
    checkedAdd(state.held as number, period.spent as number);
    const computed = gatewayQuotaWindow(rule, now);
    if (current(policy.window.startsAtMs, policy.window.endsAtMs, now)) {
      requireValue(!computed || same(policy.window, computed), 'invalid-policy', 'The active period must match the reviewed reset boundaries exactly.');
      if (rule.reset.kind === 'authoritative-import') {
        requireValue(period.baseline === 'authenticated-import' && typeof period.importId === 'string' && isIdentifier(period.importId),
          'import-required', 'The active unknown or rolling window must retain its authenticated import provenance.');
        const imported = this.readActiveImport(await this.get(tx, gatewayQuotaImportPath(key, period.importId)), period.importId,
          rule, policy.window, period.spent as number, now);
        return { rule, account, policy, state, window: policy.window, spent: period.spent as number, due: false,
          imported, importId: period.importId, activeImported: true };
      }
      return { rule, account, policy, state, window: policy.window, spent: period.spent as number, due: false };
    }
    requireValue(policy.window.endsAtMs <= now && !replay, 'clock-changed', 'Re-read after the reset boundary; never advance from a future window or reuse an old operation.');
    const importId = request.imports?.find(i => i.ledgerKey === key)?.importId;
    const imported = importId ? this.readImport(await this.get(tx, gatewayQuotaImportPath(key, importId)), importId, rule, policy, state, now) : undefined;
    const window = computed ?? imported?.window;
    requireValue(window, 'import-required', 'Unknown or rolling reset semantics require a fresh authenticated complete usage import.');
    requireValue(window.startsAtMs >= policy.window.endsAtMs, 'invalid-policy', 'Reset windows cannot overlap or truncate a previous allowance.');
    let baseline: Prepared['baseline']; let spent: number;
    if (imported) {
      requireValue(same(imported.window, window), 'invalid-import', 'Imported usage must match the reviewed exact reset window.');
      spent = imported.spent; baseline = 'authenticated-import';
    } else {
      requireValue(rule.reset.kind !== 'authoritative-import' && rule.zeroBaseline
        && (rule.zeroBaseline.kind === 'local-reservation-window'
          || (rule.zeroBaseline.kind === 'exclusive-provider-reset' && rule.zeroBaseline.exclusiveSinceMs! <= window.startsAtMs)),
      'import-required', 'Zero usage requires a reviewed local-reservation reset or proven exclusive upstream reset; otherwise import authenticated usage.');
      spent = 0; baseline = rule.accounting === 'local-only' ? 'local-zero' : 'verified-zero';
    }
    checkedAdd(state.held as number, spent);
    const next = await this.get(tx, gatewayLedgerPath('quota-period', evidenceBinding([key, window.id])));
    requireValue(next === undefined, 'period-conflict', 'A new period already exists; reconcile its provenance without overwriting any spent amount.');
    return { rule, account, policy, state, window, spent, due: true, baseline, ...(imported ? { imported, importId } : {}) };
  }
  private validateFinal(prepared: Prepared[], request: GatewayQuotaRolloverRequest, startedAtMs: number, now: number): void {
    requireValue(now >= startedAtMs, 'clock-changed', 'A monotonic transaction clock is required.');
    for (const p of prepared) {
      reviewedGatewayQuotaRule(p.rule, p.rule.dimension, request.dimensions, now);
      this.validateAccount(p.account, p.rule, now);
      requireValue(current(p.window.startsAtMs, p.window.endsAtMs, now)
        && (!gatewayQuotaWindow(p.rule, now) || same(gatewayQuotaWindow(p.rule, now), p.window)),
      'clock-changed', 'The reset boundary changed during reads; repeat with current authority.');
      if (p.imported) {
        if (p.activeImported) this.readActiveImport(p.imported, p.importId!, p.rule, p.window, p.spent, now);
        else this.readImport(p.imported, p.importId!, p.rule, p.policy, p.state, now);
      }
    }
  }
  private async run(input: GatewayQuotaRolloverRequest, write: boolean): Promise<GatewayQuotaRolloverStatus> {
    let committed = false;
    try {
      // Capture inputs so mutation during an awaited read cannot change the operation.
      const request = structuredClone(input); const operationBinding = this.validateRequest(request);
      const result = await this.db.runTransaction(async tx => {
        const startedAtMs = this.clock();
        const prepared: Prepared[] = [];
        // Sequential per dimension bounds active reads; all writes remain after all reads.
        for (const d of request.dimensions) prepared.push(await this.prepare(tx, request, d, operationBinding, startedAtMs));
        const finalNow = this.clock(); this.validateFinal(prepared, request, startedAtMs, finalNow);
        const due = prepared.filter(p => p.due);
        if (write) for (const p of due) {
          tx.create(this.db.doc(gatewayLedgerPath('quota-period', evidenceBinding([p.rule.ledgerKey, p.window.id]))), {
            kind: 'gateway_quota_period', version: 1, ledgerKey: p.rule.ledgerKey, window: p.window, spent: p.spent,
            rolloverRule: p.policy.rolloverRule, baseline: p.baseline, createdAtMs: finalNow,
            ...(p.importId ? { importId: p.importId } : {}),
          });
          const next: GatewayRolloverPolicy = { ...p.policy, revision: checkedAdd(p.policy.revision, 1), window: p.window,
            rollover: { operationBinding, previousRevision: p.policy.revision, atMs: finalNow, baseline: p.baseline!,
              ...(p.importId ? { importId: p.importId } : {}) } };
          tx.set(this.db.doc(gatewayLedgerPath('quota-policy', p.rule.ledgerKey)), next);
          // Deliberately never writes quota-state, old periods, attempts, reviews or account policy.
        }
        return { prepared, request, startedAtMs, didWrite: write && due.length > 0 };
      }, { maxAttempts: 5 });
      committed = result.didWrite;
      // A successful commit can return after expiry. Preserve that fact but never report ready.
      this.validateFinal(result.prepared, result.request, result.startedAtMs, this.clock());
      return { status: result.prepared.some(p => p.due) ? write ? 'rolled' : 'ready' : 'current', committed,
        dimensions: result.prepared.map(p => ({ ledgerKey: p.rule.ledgerKey,
          policyRevision: p.policy.revision + (write && p.due ? 1 : 0), window: p.window, held: p.state.held as number,
          spent: p.spent, accounting: p.rule.accounting,
          upstreamRemaining: 'unknown', due: p.due })) };
    } catch (error) {
      if (error instanceof Unavailable) return { status: 'blocked', committed, dimensions: [], reason: error.reason, requiredEvidence: error.needed };
      return { status: 'blocked', committed: write && !committed ? 'unknown' : committed, dimensions: [], reason: 'store-unavailable',
        requiredEvidence: ['Read current policy and period state before retrying the same operation; an interrupted transaction response is not proof that no write committed.'] };
    }
  }
}
