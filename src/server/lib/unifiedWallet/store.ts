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
}

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
export function finishChatMessage(db: unknown, uid: string, charge: ChatCharge, outcome: 'answered' | 'provider-failed' | 'uncertain', ops: WalletMoneyOps = defaultOps) {
  return finishService(db, uid, charge, outcome, ops);
}
