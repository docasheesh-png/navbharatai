import { CHAT_SERVER_DEADLINE_MS } from '../../lib/chatDeadline';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from './serverDb';
import type { FreeAnswerQuotaStatus } from '../../lib/freeAnswerQuota';

/** User admission leases are NOT physical-provider occupancy or provider-money reservations. */
export const FREE_ANSWER_LEASE_MS = 30_000;
export const FREE_ANSWER_REQUEST_MS = 90_000;
// Only the ordinary-chat ingress requests the longer fallback budget.
export const FREE_ANSWER_CHAT_REQUEST_MS = CHAT_SERVER_DEADLINE_MS;
const COLLECTION = 'free_answer_quota';
const IP_ATTEMPT_LIMIT = 100;
const ATTEMPTS_PER_CREDIT = 3;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;

/** limit: 10 (guest) / 50 (signed-in, incl. 5 free images) since 2026-10-30; config-driven when UNIFIED_WALLET_ENABLED (see unifiedWallet/policy.ts). */
export interface FreeAnswerQuotaSubject { key: string; limit: number; ipKey?: string; guest?: boolean }
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
    && count(r.leaseExpiresAt) && [FREE_ANSWER_REQUEST_MS, FREE_ANSWER_CHAT_REQUEST_MS].includes(r.deadlineAt - r.startedAt)
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
    && Number.isSafeInteger(subject.limit) && subject.limit >= 0 && subject.limit <= 100_000
    && (subject.ipKey === undefined || ((subject.guest === true || subject.limit === 5) && typeof subject.ipKey === 'string' && subject.ipKey.length > 0 && subject.ipKey.length <= 512)));
  return hash(subject.key);
}

/** A delayed admission must not change its recorded day or extend its original request deadline. */
export class FreeAnswerQuotaWindowChangedError extends Error {
  constructor() { super('Free answer admission crossed the daily quota boundary'); this.name = 'FreeAnswerQuotaWindowChangedError'; }
}

/** An explicit timestamp is a fixed fixture seam; production samples trusted time after reads. */
function transactionClock(fixedNow?: number) {
  const startedAt = fixedNow === undefined ? Date.now() : fixedNow; time(startedAt);
  let latest = startedAt;
  return { startedAt, read: () => {
    const now = fixedNow === undefined ? Date.now() : fixedNow; time(now);
    demand(now >= latest); latest = now;
    return now;
  } };
}

/** Reselect dated documents before any writes if reads cross midnight. Never mix two daily ledgers. */
async function readCurrentDay<T>(clock: ReturnType<typeof transactionClock>, read: (day: string) => Promise<T>, deadlineAt?: number) {
  let before = clock.read();
  for (let pass = 0; pass < 2; pass++) {
    demand(deadlineAt === undefined || before < deadlineAt);
    const day = windowFor(before).day;
    const result = await read(day);
    const now = clock.read();
    demand(deadlineAt === undefined || now < deadlineAt);
    if (windowFor(now).day === day) return { result, day, now };
    before = now;
  }
  throw new Error('Free answer quota day changed during repeated reads');
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
  async reserve(subject: FreeAnswerQuotaSubject, requestId: string, fixedNow?: number, requestMs = FREE_ANSWER_REQUEST_MS): Promise<FreeAnswerQuotaDecision> {
    const principalHash = identity(subject); const clock = transactionClock(fixedNow); demand(uuid.test(requestId));
    const id = hash(`${principalHash}:${requestId.toLowerCase()}`);
    const principalRef = this.ref(`principal_${principalHash}`); const attemptRef = this.ref(`attempt_${id}`);
    // Retries retain owner identity AND the original request deadline; database delay buys no extra time.
    demand(requestMs === FREE_ANSWER_REQUEST_MS || requestMs === FREE_ANSWER_CHAT_REQUEST_MS);
    const owner = randomUUID(); const deadlineAt = clock.startedAt + requestMs;
    return this.db!.runTransaction(async tx => {
      const { result, day, now } = await readCurrentDay(clock, async day => {
        const dayRef = this.ref(`day_${principalHash}_${day}`);
        const ipRef = subject.ipKey ? this.ref(`ip_${hash(subject.ipKey)}_${day}`) : null;
        const [ps, ds, as, ips] = await Promise.all([tx.get(principalRef), tx.get(dayRef), tx.get(attemptRef), ipRef ? tx.get(ipRef) : null]);
        return { dayRef, ipRef, ps, ds, as, ips };
      }, deadlineAt);
      // Older deployed readers require day === windowFor(startedAt). Keep that format and the
      // original 90-second deadline: a midnight-crossing admission retries as a new request, uncharged.
      if (day !== windowFor(clock.startedAt).day) throw new FreeAnswerQuotaWindowChangedError();
      const { dayRef, ipRef, ps, ds, as, ips } = result;
      const p = principal(readData(ps)); const d = daily(readData(ds), day); const a = attempt(readData(as));
      const ip = ips ? daily(readData(ips), day) : null;
      const status = snapshot(subject, p, d, now);
      if (a) { demand(a.id === id && a.principalHash === principalHash); return { allowed: false, reason: 'duplicate', status }; }
      if (live(p, now)) return { allowed: false, reason: 'busy', status };
      if (d.consumed >= subject.limit) return { allowed: false, reason: 'daily-limit', status };
      if (d.attempts >= subject.limit * ATTEMPTS_PER_CREDIT || (ip && ip.attempts >= IP_ATTEMPT_LIMIT)) return { allowed: false, reason: 'attempt-limit', status };
      const reservation: FreeAnswerReservation = { id, owner, principalHash, day, startedAt: clock.startedAt,
        deadlineAt, leaseExpiresAt: Math.min(now + FREE_ANSWER_LEASE_MS, deadlineAt) };
      const next: Day = { ...d, consumed: d.consumed + 1, attempts: d.attempts + 1 };
      const purgeAfterMs = Date.parse(`${day}T00:00:00Z`) + 8 * DAY_MS;
      const nextPrincipal: Principal = { version: 1, active: reservation, principalHash, purgeAfterMs };
      // Daily/idempotency docs are dated. Reusable principals never use Firestore TTL: scheduled
      // retention atomically rechecks purgeAfterMs and active ownership before removing them.
      const expireAt = new Date(purgeAfterMs);
      tx.set(principalRef, nextPrincipal); tx.set(dayRef, { ...next, expireAt, principalHash, purgeAfterMs });
      tx.set(attemptRef, { ...reservation, version: 1, state: 'held', expireAt, purgeAfterMs } satisfies Attempt);
      if (ipRef && ip) tx.set(ipRef, { ...ip, attempts: ip.attempts + 1, expireAt, purgeAfterMs });
      return { allowed: true, reservation, status: snapshot(subject, nextPrincipal, next, now) };
    });
  }
  async status(subject: FreeAnswerQuotaSubject, fixedNow?: number): Promise<FreeAnswerQuotaStatus> {
    const h = identity(subject); const clock = transactionClock(fixedNow);
    const p = this.ref(`principal_${h}`);
    return this.db!.runTransaction(async tx => {
      const { result: [ps, ds], day, now } = await readCurrentDay(clock, day =>
        Promise.all([tx.get(p), tx.get(this.ref(`day_${h}_${day}`))]));
      return snapshot(subject, principal(readData(ps)), daily(readData(ds), day), now);
    });
  }
  async renew(reservation: FreeAnswerReservation, fixedNow?: number): Promise<boolean> {
    const clock = transactionClock(fixedNow); if (!validReservation(reservation)) return false;
    const ref = this.ref(`principal_${reservation.principalHash}`);
    return this.db!.runTransaction(async tx => {
      const p = principal(readData(await tx.get(ref)));
      const now = clock.read();
      if (!sameOwner(p.active, reservation) || !live(p, now) || now < reservation.startedAt) return false;
      tx.set(ref, { ...p, version: 1, active: { ...p.active!, leaseExpiresAt: Math.min(now + FREE_ANSWER_LEASE_MS, reservation.deadlineAt) } } satisfies Principal);
      return true;
    });
  }
  async settle(reservation: FreeAnswerReservation, outcome: FreeAnswerOutcome, fixedNow?: number): Promise<boolean> {
    const clock = transactionClock(fixedNow); if (!validReservation(reservation)) return false;
    demand(['answered', 'provider-failed', 'uncertain'].includes(outcome));
    const pRef = this.ref(`principal_${reservation.principalHash}`); const aRef = this.ref(`attempt_${reservation.id}`);
    const dRef = this.ref(`day_${reservation.principalHash}_${reservation.day}`);
    return this.db!.runTransaction(async tx => {
      const [ps, as, ds] = await Promise.all([tx.get(pRef), tx.get(aRef), tx.get(dRef)]);
      const p = principal(readData(ps)); const a = attempt(readData(as)); const d = daily(readData(ds), reservation.day);
      const now = clock.read();
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
