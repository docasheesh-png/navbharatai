// UNIFIED CREDIT WALLET — I/O. Reuses the existing wallet money path; adds only:
//   • a per-minute abuse gate + per-request idempotency record (`unified_wallet_gate/*`), and
//   • plan entitlement read (`unified_wallet_plans/{uid}`), written by the plan purchase flow.
// The wallet itself is ONLY touched through walletDebit.ts (hold / release / settle, all transactional,
// all on the canonical merged wallet) and the shared ledger appender. See docs/UNIFIED_WALLET.md.
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../serverDb';
import { featureRollupRef } from '../walletFeature';
import {
  holdWalletRolledUp, releaseWalletHold, settleWalletHold, walletOwnerId, type WalletHoldResult,
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

/** The plan a signed-in user currently holds, or null. Never throws (a failed read = no plan). */
export async function activePlanId(uid: string, now = Date.now(), db: Db | null = getServerDb()): Promise<string | null> {
  if (!db || !uid) return null;
  try {
    const snap = await db.doc(`unified_wallet_plans/${uid}`).get();
    const d = snap.exists ? (snap.data() as { planId?: unknown; periodEndMs?: unknown }) : null;
    return d && typeof d.planId === 'string' && typeof d.periodEndMs === 'number' && d.periodEndMs > now ? d.planId : null;
  } catch { return null; }
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

/**
 * Grant a plan's monthly credits into the ONE wallet, exactly once per (plan, period).
 * NOT wired to payments: the plan purchase flow (billing owner) calls this after a gateway-verified
 * payment. Idempotent through the existing `wallet_ops` dedupe doc (kind 'plan').
 */
export async function grantPlanCredits(
  uid: string, planId: string, periodKey: string, cfg: UnifiedWalletConfig,
): Promise<{ ok: true; granted: boolean; tokens: number } | { ok: false; error: string }> {
  const plan = cfg.plans.find((p) => p.id === planId);
  if (!plan) return { ok: false, error: 'Unknown plan' };
  if (!/^[0-9]{4}-[0-9]{2}$/.test(periodKey)) return { ok: false, error: 'periodKey must be YYYY-MM' };
  if (plan.monthlyCredits <= 0) return { ok: true, granted: false, tokens: 0 };
  const { doc, runTransaction, getServerDb: db } = await import('../serverDb');
  const { WALLET_OPS, walletOpId } = await import('../walletOps');
  const { mirroredCreditPatch, rupeesToTokens } = await import('../walletMirror');
  const { ledgerPatch } = await import('../walletStatement');
  const d = db();
  if (!d) return { ok: false, error: 'Database not initialized' };
  try {
    const ownerId = await walletOwnerId(d, uid);
    const tokens = rupeesToTokens(plan.monthlyCredits);
    const walletRef = doc(d, 'user_token_wallets', ownerId);
    const opRef = doc(d, WALLET_OPS, walletOpId(ownerId, 'plan', `uw-grant_${plan.id}_${periodKey}`));
    const granted = await runTransaction(d, async (t: any) => {
      const op = await t.get(opRef);
      if (op.exists()) return false;
      const snap = await t.get(walletRef);
      const w = snap.exists() ? snap.data() : { userId: ownerId, tokenBalance: 0, remaining_balance: 0, walletLedger: [] };
      const now = new Date().toISOString();
      t.set(walletRef, {
        ...w, ...mirroredCreditPatch(w, tokens, 'paid'),
        ...ledgerPatch(w, { type: 'plan_credit', amountCoinsOrTokens: tokens, description: `${plan.label} — ${plan.monthlyCredits} credits (${periodKey})`, timestamp: now } as any),
        updatedAt: now,
      });
      t.set(opRef, { kind: 'plan', ownerId, ref: `uw-grant_${plan.id}_${periodKey}`, at: now });
      return true;
    });
    return { ok: true, granted, tokens: granted ? tokens : 0 };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Plan grant failed' };
  }
}
