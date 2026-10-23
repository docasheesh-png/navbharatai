// UNIFIED CREDIT WALLET — I/O. Reuses the existing wallet money path; adds only:
//   • a per-minute abuse gate + per-request idempotency record (`unified_wallet_gate/*`), and
// The wallet itself is ONLY touched through walletDebit.ts (hold / release / settle, all transactional,
// all on the canonical merged wallet) and the shared ledger appender. See docs/UNIFIED_WALLET.md.
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../serverDb';
import { featureRollupRef } from '../walletFeature';
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

export interface ChatCharge {
  holdId: string;
  rollupRef: string;
  billedInr: number;
  ownerId: string;
  balanceTokens: number;
}
export type ChatChargeResult =
  | { ok: true; charge: ChatCharge }
  | { ok: false; insufficient: boolean; error: string };

/**
 * Take ONE Free chat message's price from the unified wallet BEFORE the provider is called.
 * All-or-nothing, never overdraws (the existing hold contract, floor 0). Feature 'free-chat' so the
 * admin's spend-by-feature shows chat and builds side by side from the same wallet.
 */
export async function holdChatMessage(
  db: unknown, uid: string, requestId: string, cfg: UnifiedWalletConfig, now = Date.now(), ops: WalletMoneyOps = defaultOps,
): Promise<ChatChargeResult> {
  const billedInr = milliToInr(cfg.chatMessageMilli);
  const rollupRef = featureRollupRef('free-chat', now);
  const holdId = `uwchat_${requestId}`;
  const r: WalletHoldResult = await ops.hold(db, uid, {
    feature: 'free-chat', billedInr, rollupRef, holdId, description: 'NavBharatAI Free chat (after daily free messages)',
  });
  if (!r.ok) return { ok: false, insufficient: r.insufficient === true, error: r.error };
  return { ok: true, charge: { holdId, rollupRef, billedInr, ownerId: r.ownerId, balanceTokens: r.tokenBalance } };
}

/** Delivered → keep the money. Failed with no output → give it back exactly once (idempotent release). */
export async function finishChatMessage(
  db: unknown, uid: string, charge: ChatCharge, outcome: 'answered' | 'provider-failed' | 'uncertain', ops: WalletMoneyOps = defaultOps,
): Promise<void> {
  // Same rule as the Free allowance store: only a PROVEN no-output failure refunds; uncertain stays charged.
  if (outcome === 'provider-failed') {
    await ops.release(db, uid, { rollupRef: charge.rollupRef, holdId: charge.holdId, description: 'NavBharatAI Free chat (after daily free messages)' }, charge.ownerId);
  } else {
    await ops.settle(db, uid, { rollupRef: charge.rollupRef, holdId: charge.holdId, feature: 'free-chat', billedInr: charge.billedInr }, charge.ownerId);
  }
}

