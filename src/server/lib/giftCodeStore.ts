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
import { GIFT_CODE_COLLECTION, mintGiftCode, type GiftCodeRecord } from './giftCodes';

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

/**
 * Claim a code for a redeemer, atomically. Returns the face value, or null if the claim was lost.
 *
 * 🔴 THE CLAIM IS ON THE **CODE**, which is the whole difference from the marketing-coupon path. That
 * one claims `coupon_<CODE>_<uid>` — one redemption per USER, correct for a code on a poster and
 * catastrophic here, because ten friends could each redeem the same ₹500. A purchased code is a
 * bearer instrument: the first redeemer takes it and the document says so for ever after.
 */
export async function claimGiftCode(
  db: any,
  code: string,
  redeemerUid: string,
  nowMs: number,
): Promise<{ claimed: boolean; record: GiftCodeRecord | null }> {
  const ref = doc(db, GIFT_CODE_COLLECTION, code);
  return runTransaction(db, async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return { claimed: false, record: null };
    const record = snap.data() as GiftCodeRecord;
    if (record.status !== 'unused') return { claimed: false, record };
    if (record.buyerUid && record.buyerUid === redeemerUid) return { claimed: false, record };
    tx.update(ref, {
      status: 'redeemed',
      redeemedBy: redeemerUid,
      redeemedAt: new Date(nowMs).toISOString(),
    });
    return { claimed: true, record };
  });
}
