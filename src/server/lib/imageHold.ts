// AN IMAGE IS PAID FOR BEFORE IT IS DRAWN (Q-616, admin decision 2026-10-05, option b).
//
// 🔴 WHAT WAS WRONG (forensic audit 2026-10-04). "5 free images a day, then ₹1 each" (`imageAllowance.ts`)
// was enforced in two moments: the count and the balance were only READ before an engine ran, and the
// count moved and the ₹1 was taken only AFTER the picture was delivered — fire-and-forget, failure only
// logged, clamped at the overdraft floor. Every concurrent request fits between a read and a later
// write, so several pictures started together each saw "4 used" or "₹1 in the wallet", each was drawn,
// and the extra ones went uncharged or pushed the wallet into overdraft. A screen that never showed the
// price could even race past the fifth and get a picture it was never allowed.
//
// 🔒 THE FIX IS TO TAKE BOTH BEFORE THE ENGINE IS CALLED, each in ONE transaction:
//   1. RESERVE THE SLOT. Today's count is incremented first and the fee is decided from the count that
//      increment returned. Two requests at "4 used" get 5 and 6 — exactly one free, one priced.
//   2. HOLD THE PRICE. A priced slot takes the ₹ from the wallet in one all-or-nothing transaction
//      (`holdWalletRolledUp`): the balance check and the debit are the same moment, it never overdraws,
//      and a wallet that cannot cover it is refused with the same answer the old pre-check gave.
//   3. SETTLE ON DELIVERY. Nothing more is charged; the platform's feature-spend counter is recorded.
//   4. RELEASE ON EVERY OTHER EXIT. The held ₹ goes back as a reversal in the same ledger bucket and the
//      slot is returned. The caller runs this from a `finally` keyed on a `delivered` flag, so no exit —
//      a provider failure, a refusal, a timeout, a thrown error, a gate refusal — can skip it. Release
//      is idempotent: twice, or after a settle, it does nothing.
//
// One implementation for every door that sells a picture at this price — the Image Generator route and
// NavBharatAI's own engine behind an API key or an app (`navbharatImageEngine.ts`) — so a picture cannot
// be bought through one door on terms another door would refuse.
//
// Unchanged on purpose: free-listed accounts and `AI_IMAGE_PRICING=off` are neither counted nor charged,
// and a counter that cannot be written (no database) fails OPEN, exactly as before — the documented
// stance of every usage counter here. A WALLET that cannot be written fails CLOSED: a priced picture is
// only drawn once its price is actually held.

import {
  imagePricingEnabled, imageFreePerDay, imagePriceInr, imageFeeForCount, freeImagesLeft, imageNeedsCreditBody,
} from './imageAllowance';
import { WALLET_EMPTY_STATUS } from './walletEmptyNotice';
import { featureLabel, featureRollupRef } from './walletFeature';
import {
  holdWalletRolledUp, releaseWalletHold, settleWalletHold, type WalletHoldResult, type WalletReleaseTx,
} from './walletDebit';
import { toolUsageStore } from '../tools/ToolUsageStore';
import { getServerDb } from './serverDb';
import { randomUUID } from 'crypto';

export interface ImageHold {
  /** True when today's count was taken for this picture (pricing on, not free-listed, counter written). */
  readonly counted: boolean;
  /** The ₹ held for this picture — 0 for a free one. Charged for good only by `settle()`. */
  readonly feeInr: number;
  /** Free pictures left today after this one, or null when it was not counted. */
  readonly freeLeftToday: number | null;
  /** The picture was delivered: keep what was held, charge nothing more. Idempotent; never throws. */
  settle(): Promise<void>;
  /** The picture was NOT delivered: give back the held ₹ and the slot. Idempotent; never throws. */
  release(why: string): Promise<void>;
}

export type ImageReservation =
  | { ok: true; hold: ImageHold }
  /** Today's free pictures are used and this caller's screen never showed the price. */
  | { ok: false; reason: 'price_not_shown'; freePerDay: number }
  /** The wallet cannot cover the price. `status`/`body` are the wallet-empty answer every client knows. */
  | { ok: false; reason: 'needs_credit'; status: number; body: Record<string, unknown>; freePerDay: number; priceInr: number }
  /** The price could not be held (a database error). Nothing was charged and nothing will be drawn. */
  | { ok: false; reason: 'hold_failed' };

export interface ImageHoldDeps {
  increment(uid: string, at: number): Promise<number>;
  decrement(uid: string, at: number): Promise<unknown>;
  hold(uid: string, tx: { billedInr: number; rollupRef: string; description: string; feature: 'image'; holdId: string }): Promise<WalletHoldResult>;
  /** `ownerId` is the wallet the hold landed on, when known; without it the wallet is resolved again. */
  release(uid: string, tx: WalletReleaseTx, ownerId?: string): Promise<{ ok: true; released: boolean } | { ok: false; error: string }>;
  settle(uid: string, tx: { rollupRef: string; holdId: string; feature: 'image'; billedInr: number }, ownerId?: string): Promise<unknown>;
  now(): number;
  newId(): string;
}

/** The real stores: the day's counter and the one wallet. */
export function defaultImageHoldDeps(): ImageHoldDeps {
  return {
    increment: (uid, at) => toolUsageStore.increment(uid, 'image', at),
    decrement: (uid, at) => toolUsageStore.decrement(uid, 'image', at),
    hold: (uid, tx) => holdWalletRolledUp(getServerDb() as any, uid, tx),
    release: (uid, tx, ownerId) => releaseWalletHold(getServerDb() as any, uid, tx, ownerId),
    settle: (uid, tx, ownerId) => settleWalletHold(getServerDb() as any, uid, tx, ownerId),
    now: () => Date.now(),
    newId: () => `img_${randomUUID()}`,
  };
}

/** Nothing reserved, nothing held: free-listed, pricing off, or a counter that could not be written. */
const NOTHING_HELD: ImageHold = Object.freeze({
  counted: false,
  feeInr: 0,
  freeLeftToday: null,
  settle: async () => undefined,
  release: async () => undefined,
});

/**
 * Reserve one picture for `uid` BEFORE any engine is called. On `ok: true` the caller MUST end in
 * exactly one of `hold.settle()` (delivered) or `hold.release()` (anything else) — put the release in a
 * `finally` guarded by a `delivered` flag. On `ok: false` nothing is held and nothing is counted.
 *
 * `priceShown` is consent: only a caller whose screen showed the price may be charged (`imageTier.ts`).
 * An API key holder agreed to the price list when they made the key, so that door passes `true`.
 */
export async function reserveImage(
  input: { uid: string; freeListed: boolean; priceShown: boolean },
  depsIn?: ImageHoldDeps,
): Promise<ImageReservation> {
  if (!imagePricingEnabled() || input.freeListed || !input.uid) return { ok: true, hold: NOTHING_HELD };
  const deps = depsIn ?? defaultImageHoldDeps();
  const freePerDay = imageFreePerDay();
  const priceInr = imagePriceInr();
  const at = deps.now();

  // 1 — THE SLOT, atomically. A count of 0 means the counter could not be written: fail open, as before.
  const countAfter = await deps.increment(input.uid, at).catch(() => 0);
  if (!(countAfter > 0)) return { ok: true, hold: NOTHING_HELD };
  const giveSlotBack = async (): Promise<void> => {
    await Promise.resolve(deps.decrement(input.uid, at)).catch((e) => {
      console.error(`[IMAGE_HOLD] could not return today's image slot for ${input.uid}: ${e instanceof Error ? e.message : e}`);
    });
  };
  const fee = imageFeeForCount(countAfter, freePerDay, priceInr);
  const freeLeftToday = freeImagesLeft(countAfter, freePerDay);

  // 2 — THE PRICE, all or nothing, before anything is drawn.
  let held: { ownerId: string; holdId: string; rollupRef: string } | null = null;
  if (fee > 0) {
    if (!input.priceShown) {
      await giveSlotBack();
      return { ok: false, reason: 'price_not_shown', freePerDay };
    }
    const holdId = deps.newId();
    const rollupRef = featureRollupRef('image', at);
    const r = await deps.hold(input.uid, { billedInr: fee, rollupRef, description: featureLabel('image'), feature: 'image', holdId })
      .catch((e): WalletHoldResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) {
      await giveSlotBack();
      if (r.insufficient) {
        return {
          ok: false, reason: 'needs_credit', status: WALLET_EMPTY_STATUS, freePerDay, priceInr,
          body: imageNeedsCreditBody({ freePerDay, priceInr, balanceInr: r.balanceInr }),
        };
      }
      // A transaction can fail AFTER it committed (a lost acknowledgement). Releasing is idempotent and a
      // no-op for a hold that was never taken, so it is always safe to try — the user never pays ₹1 for a
      // picture they were told was not made.
      await deps.release(input.uid, { rollupRef, holdId, description: featureLabel('image'), feature: 'image' })
        .catch(() => undefined);
      console.error(`[IMAGE_HOLD] ₹${fee} could not be held for ${input.uid}: ${r.error} — the picture was not drawn.`);
      return { ok: false, reason: 'hold_failed' };
    }
    held = { ownerId: r.ownerId, holdId, rollupRef };
  }

  let state: 'open' | 'settled' | 'released' = 'open';
  const hold: ImageHold = {
    counted: true,
    feeInr: fee,
    freeLeftToday,
    settle: async () => {
      if (state !== 'open') return;
      state = 'settled';
      if (!held) return;
      await Promise.resolve(deps.settle(input.uid, { rollupRef: held.rollupRef, holdId: held.holdId, feature: 'image', billedInr: fee }, held.ownerId))
        .catch(() => undefined); // the money is already where it belongs; this only closes the hold's id
    },
    release: async (why: string) => {
      if (state !== 'open') return;
      state = 'released';
      if (held) {
        const out = await deps.release(input.uid, {
          rollupRef: held.rollupRef, holdId: held.holdId, description: featureLabel('image'), feature: 'image',
        }, held.ownerId).catch((e): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        if (!out.ok) {
          console.error(`[IMAGE_HOLD] ₹${fee} hold ${held.holdId} for ${input.uid} could NOT be given back (${why}): ${out.error}`);
        }
      }
      await giveSlotBack();
    },
  };
  return { ok: true, hold };
}
