import { createHash } from 'node:crypto';
import { sanitizeText } from '../../../lib/observability/sanitize';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../../lib/serverDb';
import { adminEmailList } from '../../lib/adminEmails';
import {
  checkedAdd, civilDayWindow, FreeChainDataError, incrementQuotaLedger, ledgerResetAt,
  nonnegativeInteger, quotaCapacity, quotaUsage, readQuotaLedger, validateQuotaInput, validTime,
  type QuotaDecision, type QuotaLedger, type QuotaReservationInput, type QuotaScope, type QuotaUsage,
} from './quota';
import {
  DEFAULT_PAID_CAP_NANO_USD, DEFAULT_PAID_PER_USER_DAILY_LIMIT, PAID_BUDGET_TIME_ZONE,
  validatePaidInput, validPaidCapNanoUsd,
  type PaidBudgetPolicy, type PaidBudgetPolicyUpdateInput, type PaidBudgetPolicyUpdateResult,
  type PaidReservation, type PaidReservationInput, type SpendDay, type SpendSnapshot,
} from './spendCap';

import { FREE_CHAIN_COLLECTION, paidUserDocumentPath, readData, readPaidPolicy, readPaidUser, readSpendDay, writePaidUser, writeSpendDay } from './paidLedger';
export { FREE_CHAIN_COLLECTION } from './paidLedger';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
type Raw = Record<string, unknown>;
interface StoredReservation extends Omit<PaidReservation, 'mayDispatch'> {
  kind: 'paid_reservation';
  version: 1;
  status: 'held' | 'settled';
  actualCostNanoUsd?: number;
  settledAt?: number;
}
export interface QuotaSnapshot {
  available: boolean;
  usage: QuotaUsage;
  minuteResetAt: number;
  dailyResetAt: number;
  cooldownUntil: number;
}
export interface FreeChainStoreOptions {
  /** Defaults to the existing, centrally maintained administrator allowlist. */
  adminEmails?: () => string[];
}
function readCooldown(raw: unknown): number {
  if (raw === undefined) return 0;
  if (!nonnegativeInteger((raw as Raw).until)) throw new FreeChainDataError('Malformed cooldown');
  return (raw as Raw).until as number;
}
function observePaidPolicy(current: PaidBudgetPolicy | null, capNanoUsd: number, now: number): PaidBudgetPolicy {
  if (current && current.capNanoUsd <= capNanoUsd) return current;
  return { kind: 'paid_budget_policy', version: 1, revision: checkedAdd(current?.revision ?? 0, 1),
    capNanoUsd, updatedAt: now, source: 'deployment' };
}
function readReservation(raw: unknown): StoredReservation {
  const r = raw as StoredReservation;
  if (!r || r.version !== 1 || r.kind !== 'paid_reservation' || !/^[a-f0-9]{64}$/.test(r.id)
    || !/^[a-f0-9]{64}$/.test(r.uidHash) || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)
    || !nonnegativeInteger(r.maxCostNanoUsd) || r.maxCostNanoUsd === 0 || !nonnegativeInteger(r.createdAt)
    || (r.status !== 'held' && r.status !== 'settled')
    || (r.status === 'settled' && (!nonnegativeInteger(r.actualCostNanoUsd) || !nonnegativeInteger(r.settledAt)))) {
    throw new FreeChainDataError('Malformed paid reservation');
  }
  return r;
}
function publicReservation(r: StoredReservation, mayDispatch: boolean): PaidReservation {
  return { id: r.id, day: r.day, uidHash: r.uidHash, maxCostNanoUsd: r.maxCostNanoUsd, createdAt: r.createdAt, mayDispatch };
}

/**
 * One shared Firestore transaction is the authority, never process memory or additive shards.
 * Transaction exhaustion/unavailability denies a call; an uncertain commit keeps its reservation.
 * Quota failures/aborts are charged in full. There is intentionally NO quota release method.
 */
export class FreeChainStore {
  private readonly adminEmails: () => string[];
  constructor(private readonly db: Db | null = getServerDb(), options: FreeChainStoreOptions = {}) {
    this.adminEmails = options.adminEmails ?? adminEmailList;
  }
  private ref(id: string) {
    if (!this.db) throw new Error('Free chat safety store unavailable');
    return this.db.doc(`${FREE_CHAIN_COLLECTION}/${id}`);
  }
  private scopeId(input: QuotaScope): string { return hash(JSON.stringify([input.provider, input.quotaScope ?? input.model])); }
  private quotaRefs(input: QuotaScope) {
    return { quota: this.ref(`quota_${this.scopeId(input)}`), neurons: this.ref(`neurons_${hash(input.provider)}`),
      cooldown: this.ref(`cooldown_${hash(input.provider)}`) };
  }
  private quotaRecord(ledger: QuotaLedger, kind: string): Raw {
    // Authority docs are a bounded, reused set. TTL would race a fresh admission after an idle
    // period, erase committed counters, and allow overspend. Their expired array entries are pruned.
    return { ...ledger, kind };
  }
  async reserveQuota(input: QuotaReservationInput, now = Date.now()): Promise<QuotaDecision> {
    try { validateQuotaInput(input, now); }
    catch { return { allowed: false, reason: 'invalid_quota', resetAt: Number.isSafeInteger(now) ? now + 60_000 : 0 }; }
    if (!this.db) return { allowed: false, reason: 'store_unavailable', resetAt: now + 60_000 };
    try {
      const refs = this.quotaRefs(input);
      return await this.db.runTransaction(async tx => {
        const [quotaSnap, neuronSnap, cooldownSnap] = await Promise.all([tx.get(refs.quota), tx.get(refs.neurons), tx.get(refs.cooldown)]);
        const until = readCooldown(readData(cooldownSnap));
        if (until > now) return { allowed: false, reason: 'cooldown' as const, resetAt: until };
        const ledger = readQuotaLedger(readData(quotaSnap), now, input.timeZone);
        const neurons = readQuotaLedger(readData(neuronSnap), now, input.timeZone);
        const used = { ...quotaUsage(ledger), neuronsPerDay: quotaUsage(neurons).neuronsPerDay };
        const tokens = checkedAdd(input.inputTokens, input.outputTokens);
        for (const field of ['rpm', 'rpd', 'tpm', 'tpd', 'neuronsPerDay'] as const) {
          const limit = input.limits[field];
          const amount = field === 'rpm' || field === 'rpd' ? 1 : field === 'neuronsPerDay' ? input.limits.neuronsPerRequest! : tokens;
          if (limit !== undefined && checkedAdd(used[field], amount) > quotaCapacity(limit, input.safetyMargin)) {
            return { allowed: false, reason: field, resetAt: ledgerResetAt(field === 'neuronsPerDay' ? neurons : ledger,
              field === 'rpm' || field === 'tpm' ? 'minute' : 'day', now) };
          }
        }
        tx.set(refs.quota, this.quotaRecord(incrementQuotaLedger(ledger, { requests: 1, tokens, neurons: 0 }, now), 'quota'));
        if (input.limits.neuronsPerDay !== undefined) {
          tx.set(refs.neurons, this.quotaRecord(incrementQuotaLedger(neurons,
            { requests: 0, tokens: 0, neurons: input.limits.neuronsPerRequest! }, now), 'neurons'));
        }
        return { allowed: true, reason: 'allowed' as const, resetAt: ledgerResetAt(ledger, 'day', now) };
      });
    } catch (error) {
      return { allowed: false, reason: error instanceof FreeChainDataError ? 'store_corrupt' : 'store_unavailable', resetAt: now + 60_000 };
    }
  }
  /** Cooldowns only extend. A late, shorter Retry-After cannot unbench an account early. */
  async cooldown(provider: string, until: number): Promise<boolean> {
    if (!this.db || !provider || provider.length > 128 || !nonnegativeInteger(until)) return false;
    try {
      const ref = this.ref(`cooldown_${hash(provider)}`);
      await this.db.runTransaction(async tx => {
        const current = readCooldown(readData(await tx.get(ref)));
        const next = Math.max(current, until);
        // Reused authority documents must not be blindly deleted by TTL while extended.
        tx.set(ref, { kind: 'cooldown', until: next });
      });
      return true;
    } catch { return false; }
  }
  async quotaSnapshot(input: QuotaScope, now = Date.now()): Promise<QuotaSnapshot> {
    if (!this.db) throw new Error('Free chat safety store unavailable');
    const refs = this.quotaRefs(input);
    return this.db.runTransaction(async tx => {
      const [quotaSnap, neuronSnap, cooldownSnap] = await Promise.all([tx.get(refs.quota), tx.get(refs.neurons), tx.get(refs.cooldown)]);
      const ledger = readQuotaLedger(readData(quotaSnap), now, input.timeZone);
      const neurons = readQuotaLedger(readData(neuronSnap), now, input.timeZone);
      return { available: true, usage: { ...quotaUsage(ledger), neuronsPerDay: quotaUsage(neurons).neuronsPerDay },
        minuteResetAt: ledgerResetAt(ledger, 'minute', now), dailyResetAt: ledgerResetAt(ledger, 'day', now),
        cooldownUntil: readCooldown(readData(cooldownSnap)) };
    });
  }
  /** Pure read: missing authority is not an implied budget and GET must never change policy. */
  async readPaidBudgetPolicy(): Promise<PaidBudgetPolicy | null> {
    return readPaidPolicy(readData(await this.ref('paid_budget_policy').get()));
  }
  /** Publish validated deployment configuration even when paid routing is disabled or the cap is zero. */
  async observePaidBudgetPolicy(capNanoUsd = DEFAULT_PAID_CAP_NANO_USD, now = Date.now(), requireExisting = false): Promise<PaidBudgetPolicy> {
    if (!validPaidCapNanoUsd(capNanoUsd)) throw new Error('Invalid spend cap');
    validTime(now);
    const ref = this.ref('paid_budget_policy');
    return this.db!.runTransaction(async tx => {
      const current = readPaidPolicy(readData(await tx.get(ref)));
      if (requireExisting && !current) throw new Error('Shared budget authority absent');
      const next = observePaidPolicy(current, capNanoUsd, now);
      // The authority never expires or resets at midnight. Stale revisions may only LOWER it.
      if (next !== current) tx.set(ref, next);
      return next;
    });
  }
  /** Authenticated-admin boundary is enforced by the caller. This is the ONLY explicit raise path. */
  async setPaidBudgetPolicy(input: PaidBudgetPolicyUpdateInput, now = Date.now()): Promise<PaidBudgetPolicyUpdateResult> {
    if (!input || !validPaidCapNanoUsd(input.capNanoUsd) || !nonnegativeInteger(input.expectedRevision)
      || typeof input.actorUid !== 'string' || !input.actorUid.trim() || input.actorUid.length > 512
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500) {
      return { ok: false, reason: 'invalid_input' };
    }
    try { validTime(now); } catch { return { ok: false, reason: 'invalid_input' }; }
    if (!this.db) return { ok: false, reason: 'unavailable' };
    try {
      const ref = this.ref('paid_budget_policy');
      return await this.db.runTransaction(async tx => {
        const current = readPaidPolicy(readData(await tx.get(ref)));
        if ((current?.revision ?? 0) !== input.expectedRevision) return { ok: false, reason: 'conflict', ...(current ? { policy: current } : {}) };
        const next: PaidBudgetPolicy = { kind: 'paid_budget_policy', version: 1, revision: checkedAdd(input.expectedRevision, 1),
          capNanoUsd: input.capNanoUsd, updatedAt: now, source: 'admin' };
        tx.set(ref, next);
        // Existing actions retention is 180 days; the financial authority itself has NO expiry.
        tx.set(this.db!.doc(`${FREE_CHAIN_COLLECTION}/state/actions/paid-budget-policy-${next.revision}`), {
          kind: 'paid_budget_policy_change', actor: hash(input.actorUid), actorKind: 'sha256_authenticated_principal',
          reason: sanitizeText(input.reason.trim(), 500).slice(0, 500), before: current, after: next, at: now,
        });
        return { ok: true, policy: next };
      });
    } catch (error) { return { ok: false, reason: error instanceof FreeChainDataError ? 'policy_corrupt' : 'unavailable' }; }
  }
  async reservePaid(input: PaidReservationInput, now = Date.now()): Promise<PaidReservation | null> {
    if (!this.db) return null;
    try {
      validTime(now); validatePaidInput(input);
      const id = hash(input.requestId), uidHash = hash(input.uid);
      const ref = this.ref(`paid_reservation_${id}`);
      const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
      // Deliberately no provider, model, or key in this authority: the owner cap is TOTAL.
      const dayRef = this.ref(`paid_day_${window.key}`);
      const userRef = this.db!.doc(paidUserDocumentPath(window.key, uidHash));
      const configuredCap = input.capNanoUsd ?? DEFAULT_PAID_CAP_NANO_USD;
      const policyRef = this.ref('paid_budget_policy');
      const perUserLimit = input.perUserLimit ?? DEFAULT_PAID_PER_USER_DAILY_LIMIT;
      return await this.db.runTransaction(async tx => {
        const [held, daily, user, policySnap] = await Promise.all([tx.get(ref), tx.get(dayRef), tx.get(userRef), tx.get(policyRef)]);
        const currentPolicy = readPaidPolicy(readData(policySnap));
        const policy = observePaidPolicy(currentPolicy, configuredCap, now);
        const cap = policy.capNanoUsd;
        // Publish stricter configuration even if this call is denied or is an idempotent replay.
        if (policy !== currentPolicy) tx.set(policyRef, policy);
        let day: SpendDay, userCount: number;
        try {
          const existing = readData(held);
          if (existing !== undefined) {
            const previous = readReservation(existing);
            return previous.uidHash === uidHash && previous.maxCostNanoUsd === input.maxCostNanoUsd
              ? publicReservation(previous, false) : null;
          }
          day = readSpendDay(readData(daily), window);
          userCount = readPaidUser(readData(user), window.key, uidHash);
        } catch { return null; } // A bad accounting document cannot prevent a valid global lowering.
        const committed = checkedAdd(day.heldNanoUsd, day.spentNanoUsd);
        // Compare remaining capacity without overflowing and rolling back a valid policy lowering.
        if (userCount >= perUserLimit || committed > cap || input.maxCostNanoUsd > cap - committed
          || day.requests === Number.MAX_SAFE_INTEGER) return null;
        const reservation: StoredReservation = { kind: 'paid_reservation', version: 1, status: 'held', id,
          day: window.key, uidHash, maxCostNanoUsd: input.maxCostNanoUsd, createdAt: now };
        writeSpendDay(tx, this.db!, { ...day, heldNanoUsd: checkedAdd(day.heldNanoUsd, input.maxCostNanoUsd),
          requests: checkedAdd(day.requests, 1), pending: checkedAdd(day.pending, 1) }, cap, now, this.adminEmails);
        writePaidUser(tx, this.db!, window, uidHash, checkedAdd(userCount, 1));
        // No expiry, even after settlement: this small tombstone prevents replay of a physical call ID.
        tx.set(ref, reservation);
        return publicReservation(reservation, true);
      });
    } catch { return null; }
  }
  /**
   * Pass a cost ONLY when both input and output usage were completely reported.
   * Missing, partial, timed-out, failed or ambiguous usage leaves the ENTIRE reservation held.
   */
  async settlePaid(reservation: PaidReservation, actualCostNanoUsd?: number, now = Date.now()): Promise<boolean> {
    if (!this.db || !nonnegativeInteger(actualCostNanoUsd) || !reservation || !/^[a-f0-9]{64}$/.test(reservation.id)) return false;
    try {
      validTime(now);
      const ref = this.ref(`paid_reservation_${reservation.id}`);
      return await this.db.runTransaction(async tx => {
        const held = await tx.get(ref);
        const stored = readReservation(readData(held));
        if (stored.uidHash !== reservation.uidHash || stored.day !== reservation.day || stored.maxCostNanoUsd !== reservation.maxCostNanoUsd) return false;
        if (stored.status === 'settled') return stored.actualCostNanoUsd === actualCostNanoUsd;
        if (now < stored.createdAt) return false;
        const window = civilDayWindow(stored.createdAt, PAID_BUDGET_TIME_ZONE);
        if (window.key !== stored.day) throw new FreeChainDataError('Reservation day mismatch');
        const [dailySnap, policySnap] = await Promise.all([tx.get(this.ref(`paid_day_${stored.day}`)), tx.get(this.ref('paid_budget_policy'))]);
        const daily = readData(dailySnap) as Raw | undefined;
        const policy = readPaidPolicy(readData(policySnap));
        // Losing a ledger must NEVER recreate zero spend and refund a reservation against it.
        if (!daily) throw new FreeChainDataError('Reservation day unavailable');
        const day = readSpendDay(daily, window);
        const cap = policy?.capNanoUsd ?? daily.capNanoUsd;
        if (!nonnegativeInteger(cap) || day.pending < 1 || day.heldNanoUsd < stored.maxCostNanoUsd) throw new FreeChainDataError('Inconsistent held cost');
        writeSpendDay(tx, this.db!, { ...day, heldNanoUsd: day.heldNanoUsd - stored.maxCostNanoUsd,
          spentNanoUsd: checkedAdd(day.spentNanoUsd, actualCostNanoUsd), pending: day.pending - 1 }, cap, now, this.adminEmails);
        // Actual cost above the hold is recorded honestly and blocks further spend, never clipped.
        tx.set(ref, { ...stored, status: 'settled', actualCostNanoUsd, settledAt: now });
        return true;
      });
    } catch { return false; }
  }
  /** Read-only snapshot of SHARED authority, not this process's environment. */
  async spendSnapshot(now = Date.now()): Promise<SpendSnapshot> {
    if (!this.db) throw new Error('Free chat safety store unavailable');
    const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
    return this.db.runTransaction(async tx => {
      const [daily, policySnap] = await Promise.all([tx.get(this.ref(`paid_day_${window.key}`)), tx.get(this.ref('paid_budget_policy'))]);
      const day = readSpendDay(readData(daily), window);
      const policy = readPaidPolicy(readData(policySnap));
      const committedNanoUsd = checkedAdd(day.heldNanoUsd, day.spentNanoUsd);
      return { ...day, available: policy !== null, committedNanoUsd, capNanoUsd: policy?.capNanoUsd ?? null,
        policyRevision: policy?.revision ?? null, remainingNanoUsd: policy ? Math.max(0, policy.capNanoUsd - committedNanoUsd) : null };
    });
  }
}
