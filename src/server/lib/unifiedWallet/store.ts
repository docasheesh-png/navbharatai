// UNIFIED CREDIT WALLET — I/O. Reuses the existing wallet money path; adds only:
//   • a per-minute abuse gate + per-request idempotency record (`unified_wallet_gate/*`), and
// The wallet itself is ONLY touched through walletDebit.ts (hold / release / settle, all transactional,
// all on the canonical merged wallet) and the shared ledger appender. See docs/UNIFIED_WALLET.md.
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../serverDb';
import { featureRollupRef, type WalletFeature } from '../walletFeature';
import {
  holdWalletRolledUp, releaseWalletHold, settleWalletHold, type WalletHoldResult,
} from '../walletDebit';
import { milliToInr, type UnifiedWalletConfig } from './policy';

type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
const COLLECTION = 'unified_wallet_gate';
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');

export type GateDecision = { ok: true } | { ok: false; reason: 'rate-limited' | 'duplicate' };

/**
 * One transaction: (1) at most `perMinute` admitted requests per principal per wall-clock minute,
 * (2) a request id is admitted at most once ever (a retry of a paid turn must never run twice for one
 * charge, and must never be charged twice). Atomic across replicas via Firestore transactions.
 */
export class UnifiedWalletGate {
  constructor(private readonly db: Db | null = getServerDb()) {}
  private ref(id: string) {
    if (!this.db) throw new Error('Unified wallet gate storage unavailable');
    return this.db.doc(`${COLLECTION}/${id}`);
  }
  async admit(principalKey: string, requestId: string, perMinute: number, now = Date.now()): Promise<GateDecision> {
    if (!principalKey || !requestId) throw new Error('Missing principal or request id');
    const p = hash(principalKey);
    const minute = Math.floor(now / MINUTE_MS);
    const rateRef = this.ref(`rate_${p}`);
    const reqRef = this.ref(`req_${hash(`${p}:${requestId.toLowerCase()}`)}`);
    return this.db!.runTransaction(async (tx) => {
      const [rs, qs] = await Promise.all([tx.get(rateRef), tx.get(reqRef)]);
      if (qs.exists) return { ok: false, reason: 'duplicate' } as const;
      const r = rs.exists ? (rs.data() as { minute?: number; count?: number }) : {};
      const count = r.minute === minute && Number.isSafeInteger(r.count) ? (r.count as number) : 0;
      if (count >= perMinute) return { ok: false, reason: 'rate-limited' } as const;
      tx.set(rateRef, { minute, count: count + 1, expireAt: new Date(now + DAY_MS) });
      tx.set(reqRef, { at: now, expireAt: new Date(now + 8 * DAY_MS) });
      return { ok: true } as const;
    });
  }

  /**
   * ONE PAID REPLY AT A TIME PER USER (review fix). The free path gets this from FreeAnswerQuotaStore's
   * active lease; the paid fallback runs after that store said "daily-limit", so it needs its own lock.
   * A crashed owner's lock expires after `ttlMs`.
   */
  async acquireInflight(principalKey: string, owner: string, now = Date.now(), ttlMs = INFLIGHT_TTL_MS): Promise<boolean> {
    const ref = this.ref(`inflight_${hash(principalKey)}`);
    return this.db!.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const d = s.exists ? (s.data() as { owner?: string; until?: number }) : null;
      if (d && typeof d.until === 'number' && d.until > now && d.owner !== owner) return false;
      tx.set(ref, { owner, until: now + ttlMs, expireAt: new Date(now + DAY_MS) });
      return true;
    });
  }
  async releaseInflight(principalKey: string, owner: string): Promise<void> {
    const ref = this.ref(`inflight_${hash(principalKey)}`);
    await this.db!.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const d = s.exists ? (s.data() as { owner?: string }) : null;
      if (d && d.owner === owner) tx.set(ref, { owner: null, until: 0, expireAt: new Date(Date.now() + DAY_MS) });
    });
  }

  // ── durable hold records: what the sweeper reads so no hold can be left stuck ──────────────────────
  async recordHold(c: ServiceCharge, uid: string, now = Date.now()): Promise<void> {
    await this.db!.runTransaction(async (tx) => {
      tx.set(this.ref(`hold_${hash(c.holdId)}`), { state: 'held', uid, charge: c, at: now, expireAt: new Date(now + 8 * DAY_MS) });
    });
  }
  async markHold(holdId: string, state: HoldState, now = Date.now()): Promise<void> {
    const ref = this.ref(`hold_${hash(holdId)}`);
    await this.db!.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      const d = s.data() as HoldRecord;
      if (d.state === 'settled' || d.state === 'released') return; // terminal
      tx.set(ref, { ...d, state, updatedAt: now });
    });
  }
  async readHold(holdId: string): Promise<HoldRecord | null> {
    let out: HoldRecord | null = null;
    await this.db!.runTransaction(async (tx) => {
      const s = await tx.get(this.ref(`hold_${hash(holdId)}`));
      out = s.exists ? (s.data() as HoldRecord) : null;
    });
    return out;
  }
}

export const INFLIGHT_TTL_MS = 120_000;
/** held → (answered → settled) | released. 'answered' means output was delivered; only settle may follow. */
export type HoldState = 'held' | 'answered' | 'settled' | 'released';
export interface HoldRecord { state: HoldState; uid: string; charge: ServiceCharge; at: number; updatedAt?: number }

export interface WalletMoneyOps {
  hold: typeof holdWalletRolledUp;
  release: typeof releaseWalletHold;
  settle: typeof settleWalletHold;
}
const defaultOps: WalletMoneyOps = { hold: holdWalletRolledUp, release: releaseWalletHold, settle: settleWalletHold };

/**
 * GENERIC SERVICE DEBIT — one entry point any paid feature can plug into (chat today; hosting, database,
 * APK, App Mart, API usage later). Service key → existing WalletFeature, amount in integer milli-credits,
 * caller-supplied idempotency key. Hold first (all-or-nothing, never overdraws), then settle or release.
 */
export const SERVICE_FEATURE = {
  chat: 'free-chat', build: 'build', image: 'image', hosting: 'hosting', database: 'database',
  apk: 'mobile-build', appmart: 'remix', api: 'api',
} as const satisfies Record<string, WalletFeature>;
export type ServiceKey = keyof typeof SERVICE_FEATURE;

export interface ServiceCharge { service: ServiceKey; holdId: string; rollupRef: string; billedInr: number; ownerId: string; balanceTokens: number; description: string }
export type ServiceChargeResult = { ok: true; charge: ServiceCharge } | { ok: false; insufficient: boolean; error: string };

export async function holdService(
  db: unknown, uid: string,
  req: { service: ServiceKey; amountMilli: number; idempotencyKey: string; description: string },
  now = Date.now(), ops: WalletMoneyOps = defaultOps,
): Promise<ServiceChargeResult> {
  const feature = SERVICE_FEATURE[req.service];
  if (!feature) return { ok: false, insufficient: false, error: 'Unknown service' };
  if (!/^[A-Za-z0-9_:-]{8,120}$/.test(req.idempotencyKey)) return { ok: false, insufficient: false, error: 'Bad idempotency key' };
  let billedInr: number;
  try { billedInr = milliToInr(req.amountMilli); } catch (e: any) { return { ok: false, insufficient: false, error: e.message }; }
  const rollupRef = featureRollupRef(feature, now);
  const holdId = `uw_${req.service}_${req.idempotencyKey}`;
  const r: WalletHoldResult = await ops.hold(db, uid, { feature, billedInr, rollupRef, holdId, description: req.description });
  if (!r.ok) return { ok: false, insufficient: r.insufficient === true, error: r.error };
  return { ok: true, charge: { service: req.service, holdId, rollupRef, billedInr, ownerId: r.ownerId, balanceTokens: r.tokenBalance, description: req.description } };
}

/** Delivered (or uncertain) → keep; proven no-output failure → give back exactly once. */
export async function finishService(db: unknown, uid: string, c: ServiceCharge, outcome: 'answered' | 'provider-failed' | 'uncertain', ops: WalletMoneyOps = defaultOps): Promise<void> {
  if (outcome === 'provider-failed') await ops.release(db, uid, { rollupRef: c.rollupRef, holdId: c.holdId, description: c.description }, c.ownerId);
  else await ops.settle(db, uid, { rollupRef: c.rollupRef, holdId: c.holdId, feature: SERVICE_FEATURE[c.service], billedInr: c.billedInr }, c.ownerId);
}

export const CHAT_LEDGER_LABEL = 'NavBharatAI Chat (after daily free messages)';
export type ChatCharge = ServiceCharge;
export type ChatChargeResult = ServiceChargeResult;
/** NavBharatAI Chat past the daily allowance: 0.1 credit (config) via the generic service debit. */
export function holdChatMessage(db: unknown, uid: string, requestId: string, cfg: UnifiedWalletConfig, now = Date.now(), ops: WalletMoneyOps = defaultOps) {
  return holdService(db, uid, { service: 'chat', amountMilli: cfg.chatMessageMilli, idempotencyKey: requestId, description: CHAT_LEDGER_LABEL }, now, ops);
}

/** Retry an idempotent money call (release / settle are both idempotent by hold id). */
export async function withRetry<T extends { ok: boolean }>(fn: () => Promise<T>, attempts = 3, baseMs = 200, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T | { ok: false; error: string }> {
  let last: T | { ok: false; error: string } = { ok: false, error: 'not attempted' };
  for (let i = 0; i < attempts; i++) {
    try { last = await fn(); if (last.ok) return last; } catch (e: any) { last = { ok: false, error: e?.message || 'threw' }; }
    if (i < attempts - 1) await sleep(baseMs * 2 ** i);
  }
  return last;
}

/**
 * Close a paid chat hold. Rule (review fix): the 0.1 credit is KEPT only if output was delivered; any
 * other end — cancel/abort before the first token, provider failure, timeout — RELEASES it.
 * Every money call is retried idempotently; a final failure is logged as an ALERT and left in the durable
 * record for `sweepStuckHolds`. Never throws.
 */
export async function closeChatHold(db: unknown, uid: string, charge: ServiceCharge, delivered: boolean, gate: UnifiedWalletGate | null, ops: WalletMoneyOps = defaultOps, sleep?: (ms: number) => Promise<void>): Promise<'settled' | 'released' | 'stuck'> {
  try { if (delivered) await gate?.markHold(charge.holdId, 'answered'); } catch { /* the sweeper treats a missing mark as no output */ }
  const r = await withRetry(async () => delivered
    ? await ops.settle(db, uid, { rollupRef: charge.rollupRef, holdId: charge.holdId, feature: SERVICE_FEATURE[charge.service], billedInr: charge.billedInr }, charge.ownerId)
    : await ops.release(db, uid, { rollupRef: charge.rollupRef, holdId: charge.holdId, description: charge.description }, charge.ownerId), 3, 200, sleep);
  if (!r.ok) {
    console.error(`[UNIFIED WALLET] ALERT ${delivered ? 'settle' : 'release'} failed for hold ${charge.holdId} — left for the sweeper: ${(r as any).error}`);
    return 'stuck';
  }
  try { await gate?.markHold(charge.holdId, delivered ? 'settled' : 'released'); } catch { /* idempotent; sweeper re-runs safely */ }
  return delivered ? 'settled' : 'released';
}

/**
 * SWEEPER: every hold record still open after `maxAgeMs` is closed — 'answered' ones settled, everything else
 * released (no proof of output → the user is not charged). Idempotent: release/settle are no-ops on a hold
 * already closed. Run from the existing scheduler (Cloud Scheduler → admin route) every few minutes.
 */
export async function sweepStuckHolds(
  db: unknown, gate: UnifiedWalletGate, records: Array<{ holdId: string } & HoldRecord>, now = Date.now(), maxAgeMs = 10 * 60_000, ops: WalletMoneyOps = defaultOps,
): Promise<{ settled: number; released: number; stuck: number }> {
  const out = { settled: 0, released: 0, stuck: 0 };
  for (const rec of records) {
    if (rec.state === 'settled' || rec.state === 'released' || now - rec.at < maxAgeMs) continue;
    const r = await closeChatHold(db, rec.uid, rec.charge, rec.state === 'answered', gate, ops, async () => {});
    out[r]++;
  }
  return out;
}

/** Open hold records older than `maxAgeMs` (admin-SDK query). */
export async function listOpenHolds(db: any, now = Date.now(), maxAgeMs = 10 * 60_000, limit = 200): Promise<Array<{ holdId: string } & HoldRecord>> {
  if (!db?.collection) return [];
  const snap = await db.collection(COLLECTION).where('state', 'in', ['held', 'answered']).where('at', '<', now - maxAgeMs).limit(limit).get();
  return snap.docs.map((d: any) => ({ holdId: d.data().charge?.holdId, ...d.data() }));
}
