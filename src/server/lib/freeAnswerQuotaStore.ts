import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from './serverDb';
import type { FreeAnswerQuotaStatus } from '../../lib/freeAnswerQuota';

/** User admission leases are NOT physical-provider occupancy or provider-money reservations. */
export const FREE_ANSWER_LEASE_MS = 30_000;
export const FREE_ANSWER_REQUEST_MS = 90_000;
const COLLECTION = 'free_answer_quota';
const IP_ATTEMPT_LIMIT = 100;
const ATTEMPTS_PER_CREDIT = 3;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;

export interface FreeAnswerQuotaSubject { key: string; limit: 5 | 20; ipKey?: string }
export interface FreeAnswerReservation {
  id: string;
  owner: string;
  principalHash: string;
  day: string;
  startedAt: number;
  deadlineAt: number;
  /** Initial lease expiry; renewal is authoritative in storage, not in this copied value. */
  leaseExpiresAt: number;
}
export type FreeAnswerOutcome = 'answered' | 'provider-failed' | 'uncertain';
export type FreeAnswerQuotaDecision =
  | { allowed: true; reservation: FreeAnswerReservation; status: FreeAnswerQuotaStatus }
  | { allowed: false; reason: 'daily-limit' | 'busy' | 'duplicate' | 'attempt-limit'; status: FreeAnswerQuotaStatus };
interface Principal { version: 1; active: FreeAnswerReservation | null; principalHash?: string; purgeAfterMs?: number }
interface Day { version: 1; day: string; consumed: number; attempts: number }
interface Attempt extends FreeAnswerReservation { version: 1; state: 'held' | FreeAnswerOutcome; expireAt: Date; purgeAfterMs?: number }

function demand(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid Free answer quota state'); }
function time(value: number): void { demand(Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000 - DAY_MS * 10); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function windowFor(now: number): { day: string; resetsAt: number } {
  time(now);
  const day = new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
  return { day, resetsAt: Date.parse(`${day}T00:00:00Z`) + DAY_MS - IST_OFFSET_MS };
}
function readData(snap: { exists: boolean; data(): unknown }): unknown {
  if (!snap.exists) return undefined;
  const value = snap.data(); demand(value && typeof value === 'object'); return value;
}
function validReservation(raw: unknown): raw is FreeAnswerReservation {
  const r = raw as FreeAnswerReservation;
  return !!r && digest.test(r.id) && uuid.test(r.owner) && digest.test(r.principalHash)
    && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && count(r.startedAt) && count(r.deadlineAt)
    && count(r.leaseExpiresAt) && r.deadlineAt === r.startedAt + FREE_ANSWER_REQUEST_MS
    && r.leaseExpiresAt > r.startedAt && r.leaseExpiresAt <= r.deadlineAt
    && windowFor(r.startedAt).day === r.day;
}
function principal(raw: unknown): Principal {
  if (raw === undefined) return { version: 1, active: null };
  const p = raw as Principal;
  demand(p.version === 1 && (p.active === null || validReservation(p.active)) && !('expireAt' in p));
  return p;
}
function daily(raw: unknown, day: string): Day {
  if (raw === undefined) return { version: 1, day, consumed: 0, attempts: 0 };
  const d = raw as Day;
  demand(d.version === 1 && d.day === day && count(d.consumed) && count(d.attempts) && d.consumed <= d.attempts);
  return d;
}
function attempt(raw: unknown): Attempt | null {
  if (raw === undefined) return null;
  const a = raw as Attempt;
  demand(a.version === 1 && validReservation(a) && ['held', 'answered', 'provider-failed', 'uncertain'].includes(a.state));
  return a;
}
function live(p: Principal, now: number): boolean { return !!p.active && p.active.leaseExpiresAt > now && p.active.deadlineAt > now; }
function sameOwner(a: FreeAnswerReservation | null, b: FreeAnswerReservation): boolean {
  return !!a && a.id === b.id && a.owner === b.owner && a.principalHash === b.principalHash
    && a.day === b.day && a.startedAt === b.startedAt && a.deadlineAt === b.deadlineAt;
}
function snapshot(subject: FreeAnswerQuotaSubject, p: Principal, d: Day, now: number): FreeAnswerQuotaStatus {
  const inProgress = live(p, now);
  const reserved = inProgress && p.active!.day === d.day ? 1 : 0;
  demand(d.consumed >= reserved);
  return { ...windowFor(now), limit: subject.limit, used: d.consumed - reserved, reserved,
    remaining: Math.max(0, subject.limit - d.consumed), inProgress };
}
function identity(subject: FreeAnswerQuotaSubject): string {
  demand(typeof subject.key === 'string' && subject.key.length > 0 && subject.key.length <= 512
    && (subject.limit === 5 || subject.limit === 20)
    && (subject.ipKey === undefined || (subject.limit === 5 && typeof subject.ipKey === 'string' && subject.ipKey.length > 0 && subject.ipKey.length <= 512)));
  return hash(subject.key);
}

/**
 * A single transaction holds one answer and one renewable owner lease. Failed provider replies may
 * restore the USER credit only. No provider account/quota/money ledger is imported or modified here.
 * Expired ownership is uncertain: its credit remains spent. Only a still-live, matching owner may
 * settle/refund. Day rollover never removes an active user lock. Idempotency records span midnight.
 */
export class FreeAnswerQuotaStore {
  constructor(private readonly db: Db | null = getServerDb()) {}
  private ref(id: string) {
    if (!this.db) throw new Error('Free answer quota storage unavailable');
    return this.db.doc(`${COLLECTION}/${id}`);
  }
  async reserve(subject: FreeAnswerQuotaSubject, requestId: string, now = Date.now()): Promise<FreeAnswerQuotaDecision> {
    const principalHash = identity(subject); const { day } = windowFor(now); demand(uuid.test(requestId));
    const id = hash(`${principalHash}:${requestId.toLowerCase()}`);
    const refs = { principal: this.ref(`principal_${principalHash}`), day: this.ref(`day_${principalHash}_${day}`),
      attempt: this.ref(`attempt_${id}`), ip: subject.ipKey ? this.ref(`ip_${hash(subject.ipKey)}_${day}`) : null };
    // Mint once outside the transaction callback; SDK retries keep the same reservation owner.
    const reservation: FreeAnswerReservation = { id, owner: randomUUID(), principalHash, day, startedAt: now,
      deadlineAt: now + FREE_ANSWER_REQUEST_MS, leaseExpiresAt: now + FREE_ANSWER_LEASE_MS };
    return this.db!.runTransaction(async tx => {
      const [ps, ds, as, ips] = await Promise.all([tx.get(refs.principal), tx.get(refs.day), tx.get(refs.attempt), refs.ip ? tx.get(refs.ip) : null]);
      const p = principal(readData(ps)); const d = daily(readData(ds), day); const a = attempt(readData(as));
      const ip = ips ? daily(readData(ips), day) : null;
      const status = snapshot(subject, p, d, now);
      if (a) { demand(a.id === id && a.principalHash === principalHash); return { allowed: false, reason: 'duplicate', status }; }
      if (live(p, now)) return { allowed: false, reason: 'busy', status };
      if (d.consumed >= subject.limit) return { allowed: false, reason: 'daily-limit', status };
      if (d.attempts >= subject.limit * ATTEMPTS_PER_CREDIT || (ip && ip.attempts >= IP_ATTEMPT_LIMIT)) return { allowed: false, reason: 'attempt-limit', status };
      const next: Day = { ...d, consumed: d.consumed + 1, attempts: d.attempts + 1 };
      const purgeAfterMs = Date.parse(`${day}T00:00:00Z`) + 8 * DAY_MS;
      const nextPrincipal: Principal = { version: 1, active: reservation, principalHash, purgeAfterMs };
      // Daily/idempotency docs are dated. Reusable principals never use Firestore TTL: scheduled
      // retention atomically rechecks purgeAfterMs and active ownership before removing them.
      const expireAt = new Date(purgeAfterMs);
      tx.set(refs.principal, nextPrincipal); tx.set(refs.day, { ...next, expireAt, principalHash, purgeAfterMs });
      tx.set(refs.attempt, { ...reservation, version: 1, state: 'held', expireAt, purgeAfterMs } satisfies Attempt);
      if (refs.ip && ip) tx.set(refs.ip, { ...ip, attempts: ip.attempts + 1, expireAt, purgeAfterMs });
      return { allowed: true, reservation, status: snapshot(subject, nextPrincipal, next, now) };
    });
  }
  async status(subject: FreeAnswerQuotaSubject, now = Date.now()): Promise<FreeAnswerQuotaStatus> {
    const h = identity(subject); const { day } = windowFor(now);
    const p = this.ref(`principal_${h}`); const d = this.ref(`day_${h}_${day}`);
    return this.db!.runTransaction(async tx => {
      const [ps, ds] = await Promise.all([tx.get(p), tx.get(d)]);
      return snapshot(subject, principal(readData(ps)), daily(readData(ds), day), now);
    });
  }
  async renew(reservation: FreeAnswerReservation, now = Date.now()): Promise<boolean> {
    time(now); if (!validReservation(reservation)) return false;
    const ref = this.ref(`principal_${reservation.principalHash}`);
    return this.db!.runTransaction(async tx => {
      const p = principal(readData(await tx.get(ref)));
      if (!sameOwner(p.active, reservation) || !live(p, now) || now < reservation.startedAt) return false;
      tx.set(ref, { ...p, version: 1, active: { ...p.active!, leaseExpiresAt: Math.min(now + FREE_ANSWER_LEASE_MS, reservation.deadlineAt) } } satisfies Principal);
      return true;
    });
  }
  async settle(reservation: FreeAnswerReservation, outcome: FreeAnswerOutcome, now = Date.now()): Promise<boolean> {
    time(now); if (!validReservation(reservation)) return false;
    demand(['answered', 'provider-failed', 'uncertain'].includes(outcome));
    const pRef = this.ref(`principal_${reservation.principalHash}`); const aRef = this.ref(`attempt_${reservation.id}`);
    const dRef = this.ref(`day_${reservation.principalHash}_${reservation.day}`);
    return this.db!.runTransaction(async tx => {
      const [ps, as, ds] = await Promise.all([tx.get(pRef), tx.get(aRef), tx.get(dRef)]);
      const p = principal(readData(ps)); const a = attempt(readData(as)); const d = daily(readData(ds), reservation.day);
      if (!a || !sameOwner(a, reservation)) return false;
      if (a.state !== 'held') return a.state === outcome;
      if (!sameOwner(p.active, reservation) || !live(p, now) || now < reservation.startedAt) return false;
      demand(d.consumed > 0);
      if (outcome === 'provider-failed') tx.set(dRef, { ...readData(ds) as object, ...d, consumed: d.consumed - 1 });
      tx.set(pRef, { ...p, version: 1, active: null } satisfies Principal);
      tx.set(aRef, { ...a, state: outcome, settledAt: now });
      return true;
    });
  }
}
