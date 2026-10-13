// THE I/O HALF OF A PURCHASED GIFT CODE. The rules live in `giftCodes.ts` (pure); this is the part
// that touches Firestore, and every write here is either a transaction or an idempotent create.
//
// 🔒 TWO COLLECTIONS, AND NEITHER IS A SECOND SOURCE OF TRUTH FOR THE OTHER:
//   • `gift_codes`      — one document per minted code. Doc id IS the code, which is what makes
//                         "one redemption, ever" a Firestore-level claim rather than a query.
//   • `gift_code_daily` — one document per buyer per UTC day. It bounds chargeback exposure; it
//                         decides nothing about whether a code is valid.
//
// ⚠️ THE DAILY TALLY COUNTS CODES **MINTED**, NOT ORDERS CREATED, and that is deliberate. Counting
// order creation would let an abandoned checkout eat somebody's allowance, so opening the page twice
// would lock a legitimate buyer out. The accepted cost is stated rather than hidden: a buyer who
// opens several checkouts at once can land slightly over the cap, because the tally only moves when
// the money actually arrives. The cap exists to bound the SIZE of a chargeback loss, not to be exact
// to the rupee — and refusing AFTER a payment has succeeded would be far worse than a small overshoot.

import { doc, getDoc, runTransaction } from './serverDb';
import { creditWalletId } from './walletCreditTarget';
import { GIFT_CODE_COLLECTION, mintGiftCode, decideGiftRedemption, type GiftCodeRecord } from './giftCodes';
import { mirroredCreditPatch, rupeesToTokens } from './walletMirror';

export const GIFT_DAILY_COLLECTION = 'gift_code_daily';

/** `YYYY-MM-DD` in UTC, on the SERVER clock — a device clock can never move a cap. */
export function giftDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** One document per buyer per day. */
export function giftDailyId(uid: string, day: string): string {
  return `${uid}_${day}`;
}

export interface GiftDailyTally {
  count: number;
  inr: number;
}

/**
 * What this buyer has already been given today.
 *
 * 🔒 AN UNREADABLE TALLY IS THE WORST CASE, NEVER ZERO. `decideGiftPurchase` treats a non-finite
 * count as the cap already spent, so a Firestore outage refuses new gift purchases rather than
 * opening an unbounded one. Same direction as `webRiskBudget` and `imageFreePaidBudget`, and the
 * opposite of the wallet gate — here there is no later gate to catch a wrong "yes".
 */
export async function readGiftDaily(db: any, uid: string, day: string): Promise<GiftDailyTally> {
  try {
    const snap = await getDoc(doc(db, GIFT_DAILY_COLLECTION, giftDailyId(uid, day)));
    if (!snap.exists()) return { count: 0, inr: 0 };
    const d = snap.data() as { count?: unknown; inr?: unknown };
    const count = Number(d?.count);
    const inr = Number(d?.inr);
    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      inr: Number.isFinite(inr) && inr > 0 ? inr : 0,
    };
  } catch (e) {
    console.error('[GIFT] daily tally could not be read — refusing new gift purchases:', e);
    return { count: Number.NaN, inr: Number.NaN };
  }
}

/**
 * Mint one code for a PAID order, and move that buyer's daily tally, in ONE transaction.
 *
 * 🔴 IDEMPOTENT ON THE ORDER, and it has to be: the caller is the payment fulfilment path, which a
 * webhook, a redirect return and the sign-in reconcile sweep can all reach for the same order. The
 * code's own document is keyed by a code we generate, so the order id is what makes a second call a
 * no-op — `existingCodeForOrder` is checked inside the transaction, which puts it in the conflict
 * set rather than leaving a TOCTOU the store-purchase path already had to fix once.
 *
 * Returns the code — the freshly minted one, or the one this order already has.
 */
export async function mintCodeForOrder(
  db: any,
  input: {
    orderId: string;
    buyerUid: string;
    faceInr: number;
    paidInr: number;
    feeInr: number;
    note?: string;
    nowMs: number;
    randomBytes: (n: number) => Uint8Array;
  },
): Promise<string> {
  const day = giftDay(input.nowMs);
  const dailyRef = doc(db, GIFT_DAILY_COLLECTION, giftDailyId(input.buyerUid, day));
  // The pointer that makes this idempotent: one document per ORDER, holding the code it minted.
  const orderRef = doc(db, GIFT_CODE_COLLECTION, `order_${input.orderId}`);

  return runTransaction(db, async (tx: any) => {
    // 🔴 BOTH READS FIRST. Firestore requires every read in a transaction to precede every write —
    // `payments.ts` carries the same note on its own transaction — and the first draft of this one
    // read the daily tally AFTER writing the code. It would have thrown on the FIRST real gift
    // purchase, at the worst possible moment: the money has already arrived and the buyer is waiting
    // for the code. No unit test could see it, because the transaction body only runs against a real
    // Firestore; `theReadsComeFirst` below drives it with a `tx` that enforces the rule instead.
    const existing = await tx.get(orderRef);
    const tally = await tx.get(dailyRef);
    if (existing.exists()) {
      const already = String((existing.data() as { code?: unknown }).code ?? '');
      if (already) return already;
    }
    const code = mintGiftCode(input.randomBytes);
    const iso = new Date(input.nowMs).toISOString();
    const record: GiftCodeRecord = {
      code,
      buyerUid: input.buyerUid,
      faceInr: input.faceInr,
      paidInr: input.paidInr,
      feeInr: input.feeInr,
      orderId: input.orderId,
      status: 'unused',
      createdAt: iso,
      ...(input.note ? { note: input.note } : {}),
    };
    tx.set(doc(db, GIFT_CODE_COLLECTION, code), record);
    tx.set(orderRef, { code, orderId: input.orderId, buyerUid: input.buyerUid, createdAt: iso });
    const prev = tally.exists() ? (tally.data() as { count?: number; inr?: number }) : null;
    tx.set(dailyRef, {
      uid: input.buyerUid,
      day,
      count: Number(prev?.count ?? 0) + 1,
      inr: Number(prev?.inr ?? 0) + input.faceInr,
      updatedAt: iso,
    });
    return code;
  });
}

export type GiftRedeemResult =
  | { claimed: false; record: GiftCodeRecord | null }
  | { claimed: true; record: GiftCodeRecord; faceInr: number; newBalanceInr: number };

/**
 * Redeem a gift code: claim it, credit the redeemer's wallet and write the history row — in ONE transaction
 * (audit 2026-10-11, F8).
 *
 * 🔴 WHY ONE. The route used to claim the code in one transaction, write the history row, and credit the
 * wallet in a SECOND transaction. A crash, a timeout or a deploy between the first and the last left the code
 * spent and the money never arrived — a bought ₹500 gift burned with nothing to show for it, and nothing that
 * would ever retry it. Now either all three happen or none does. The claim decision is `decideGiftRedemption`
 * itself (the same function that words the refusal), so a record with a broken face value is refused rather
 * than burned for ₹0, as it used to be.
 *
 * The credit is 'paid' (somebody paid real rupees for the code) and goes through `mirroredCreditPatch`, the one
 * wallet-credit writer (`walletMirror.ts`).
 */
export async function redeemGiftCode(
  db: any,
  code: string,
  redeemer: { uid: string; email: string; name: string },
  nowMs: number,
): Promise<GiftRedeemResult> {
  const codeRef = doc(db, GIFT_CODE_COLLECTION, code);
  const walletRef = doc(db, 'user_token_wallets', await creditWalletId(db, redeemer.uid));
  const historyRef = doc(db, 'payment_transactions', `gift_${code}`);
  return runTransaction(db, async (tx: any) => {
    // Every read before any write — a Firestore transaction requires it.
    const codeSnap = await tx.get(codeRef);
    const walletSnap = await tx.get(walletRef);
    const record = codeSnap.exists() ? (codeSnap.data() as GiftCodeRecord) : null;
    const verdict = decideGiftRedemption(record, redeemer.uid);
    if (!record || !verdict.ok) return { claimed: false as const, record };
    const faceInr = verdict.faceInr;
    const iso = new Date(nowMs).toISOString();
    const wallet = walletSnap.exists() ? walletSnap.data() : null;
    const patch = mirroredCreditPatch(wallet, rupeesToTokens(faceInr), 'paid');
    tx.update(codeRef, { status: 'redeemed', redeemedBy: redeemer.uid, redeemedAt: iso });
    if (wallet) {
      tx.update(walletRef, { ...patch, updatedAt: iso });
    } else {
      tx.set(walletRef, {
        userId: redeemer.uid,
        userEmail: redeemer.email || '',
        userName: redeemer.name || '',
        ...patch,
        total_output_tokens_used: 0,
        total_money_spent: 0,
        updatedAt: iso,
      });
    }
    // The visible history row, with its own id so it can never be written twice. Same shape as the coupon
    // path, so the Promocode capsule and the statement need no second notion of a redemption.
    tx.set(historyRef, {
      transactionId: `gift_${code}`,
      userId: redeemer.uid,
      amountPaid: 0,
      balanceAdded: faceInr,
      paymentProvider: 'GIFT_REDEEM',
      paymentStatus: 'SUCCESS',
      paymentReference: `GIFT_${code}`,
      createdAt: iso,
    });
    return { claimed: true as const, record, faceInr, newBalanceInr: patch.remaining_balance };
  });
}
