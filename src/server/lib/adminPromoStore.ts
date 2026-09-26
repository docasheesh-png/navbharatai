// The Firestore half of the admin promo codes (`adminPromoCodes.ts` holds the rules).
//
// 🔒 A REDEMPTION IS ONE TRANSACTION. The code, the user's claim and the wallet are read together and
// written together, so there is no window in which the claim exists and the credit does not, or in
// which two users both take the last use. The env-coupon path claims first and credits in a second
// transaction; this one does not need to repeat that, because it was written after the money audit.

import { doc, runTransaction, type ServerTransaction } from './serverDb';
import { mirroredCreditPatch } from './walletMirror';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import {
  decideAdminPromoRedemption,
  parseAdminPromoInput,
  type AdminPromoInput,
  type AdminPromoRecord,
} from './adminPromoCodes';

export const ADMIN_PROMO_COLLECTION = 'promo_codes';

/** The same claim id the env coupons use, so one person can redeem a code once whichever table holds it. */
export const promoClaimId = (code: string, userId: string) => `coupon_${code}_${userId}`;

export type CreateResult = { ok: true; code: string } | { ok: false; status: 400 | 409; error: string };

/**
 * Create a code. It REFUSES to overwrite an existing one: the old route used a plain `setDoc`, which
 * reset `usedCount` to 0 every time the same code was typed again — a single-use code re-created was a
 * fresh supply of credit. To change a code, the admin deletes it and makes it again.
 */
export async function createAdminPromo(db: any, body: unknown, nowIso: string): Promise<CreateResult> {
  const parsed = parseAdminPromoInput(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const v: AdminPromoInput = parsed.value;
  const ref = doc(db, ADMIN_PROMO_COLLECTION, v.code);
  const created = await runTransaction(db, async (tx: ServerTransaction) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return false;
    tx.set(ref, {
      code: v.code,
      freeTokens: v.freeTokens,
      maxUses: v.maxUses,
      usedCount: 0,
      active: true,
      expiresAt: null,
      createdAt: nowIso,
    });
    return true;
  });
  return created
    ? { ok: true, code: v.code }
    : { ok: false, status: 409, error: `${v.code} already exists. Delete it first to make it again.` };
}

export type RedeemResult =
  | { kind: 'not-found' }
  | { kind: 'already' }
  | { kind: 'refused'; reason: 'inactive' | 'expired' | 'used-up' | 'no-value' }
  | { kind: 'credited'; tokens: number; balanceAddedInr: number; currentBalance: number };

export async function redeemAdminPromo(
  db: any,
  code: string,
  user: { userId: string; userEmail?: string; userName?: string },
  now: Date,
): Promise<RedeemResult> {
  const promoRef = doc(db, ADMIN_PROMO_COLLECTION, code);
  const claimRef = doc(db, 'payment_transactions', promoClaimId(code, user.userId));
  const walletRef = doc(db, 'user_token_wallets', user.userId);
  return runTransaction(db, async (tx: ServerTransaction): Promise<RedeemResult> => {
    // Every read before any write — Firestore's rule, and what makes the three facts consistent.
    const promo = await tx.get(promoRef);
    if (!promo.exists()) return { kind: 'not-found' };
    const claim = await tx.get(claimRef);
    const wallet = await tx.get(walletRef);
    if (claim.exists()) return { kind: 'already' };

    const rec = (promo.data() || {}) as AdminPromoRecord;
    const verdict = decideAdminPromoRedemption(rec, now.getTime());
    if (!verdict.ok) return { kind: 'refused', reason: verdict.reason };

    const nowIso = now.toISOString();
    const balanceAddedInr = verdict.tokens / TOKENS_PER_RUPEE;
    tx.set(claimRef, {
      transactionId: promoClaimId(code, user.userId),
      userId: user.userId,
      amountPaid: 0,
      balanceAdded: balanceAddedInr,
      tokensAdded: verdict.tokens,
      paymentProvider: 'ADMIN_PROMO_REDEEM',
      paymentStatus: 'SUCCESS',
      paymentReference: `REDEMPTION_${code}`,
      createdAt: nowIso,
    });
    tx.update(promoRef, { usedCount: Math.max(0, Math.floor(Number(rec.usedCount) || 0)) + 1, lastRedeemedAt: nowIso });

    // Money NavBharatAI handed over, so 'gift' — the same as a marketing coupon (walletMirror.ts).
    const w = wallet.exists() ? wallet.data() : null;
    const patch = mirroredCreditPatch(w, verdict.tokens, 'gift');
    if (w) {
      tx.update(walletRef, { ...patch, updatedAt: nowIso });
    } else {
      tx.set(walletRef, {
        userId: user.userId,
        userEmail: user.userEmail || '',
        userName: user.userName || '',
        ...patch,
        total_output_tokens_used: 0,
        total_money_spent: 0,
        updatedAt: nowIso,
      });
    }
    return { kind: 'credited', tokens: verdict.tokens, balanceAddedInr, currentBalance: patch.remaining_balance };
  });
}
