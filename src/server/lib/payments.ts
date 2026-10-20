import { randomBytes } from 'crypto';
import { creditWalletId } from './walletCreditTarget';
import axios from 'axios';
import { appendLedgerEntry, LEDGER_OPENING_FIELD, LEDGER_DROPPED_FIELD } from './walletStatement';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Credits user_token_wallets /
// payment_transactions / promo_redemptions, all server-only under navbharat-prod's rules.
import { doc, getDoc, updateDoc, runTransaction, getServerDb as getDb } from './serverDb';
import { cashfreeOrderClosedUnpaid } from './pendingOrders';
import { withLedgerV2 } from './ledgerV2';
import { cashfreePaymentsAvailability } from './cashfreeCredentials';
import { mintCodeForOrder } from './giftCodeStore';
import { recordedReversedInr, settleRecordedReversalAtCredit } from './paymentReversal';
import { unreconciledCreditPatch, reconcileGatewayPaidAmount, PaymentAmountMismatchError } from './paymentReconciliation';
import { applyOrderReversal } from './paymentReversalStore';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { orderCreditedTokens, orderNetPaidInr, recordedPlatformFee, type WalletCreditTx } from './orderCredit';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import { parseEnvNumber } from './envNumber';
import {
  professionalPassPriceInr, passEntitlementForPayment, MAX_PASS_PERIODS,
} from '../professionals/professionalPaid';

// SECURITY (audit C4 — CRITICAL, financial) — WHY THE CREDIT IS DERIVED FROM THE PAID AMOUNT.
// The credit path once minted `client tokenAmount × 100` tokens, a value never bound to what was
// actually paid, so a `{amount: 1, tokenAmount: 1_000_000}` order paid ₹1 and minted 100M tokens.
// Every credit now derives from the VERIFIED paid amount. That invariant OUTLIVES the Vishwakarma
// entry pass it was written for (deleted 2026-09-12) and is the reason the one remaining credit path
// reads `balanceAdded` — the net the server itself computed — and never a client-supplied token count.
//
// RE-EXPORTED, NOT REDECLARED (2026-09-10): the ₹→token rate is also printed on purchase screens, and
// a server copy is what let a price drift between them. One home: src/lib/walletPricing.ts.
export { TOKENS_PER_RUPEE };

/**
 * The size of the RETIRED welcome bonus, for reading HISTORY only.
 *
 * No wallet is granted this any more (admin 2026-09-26: the referral ladder is the only welcome
 * credit, and a new wallet opens at ₹0 — see `newWallet.ts`). Its one reader is `accountMerge.ts`,
 * which reconstructs a merged balance from first principles and has to know how much of an OLD
 * wallet's `totalTokensPurchased` was that bonus rather than money the user paid. Removing it would
 * count a past gift as a purchase when two such accounts are merged.
 *
 * 25,000 = ₹250, the amount granted from 2026-07-28. `WELCOME_BONUS_TOKENS` still overrides it,
 * because an admin who ran a different value then may need it read back the same way now.
 */
export function welcomeBonusTokens(): number {
  const n = parseEnvNumber(process.env.WELCOME_BONUS_TOKENS);
  return n !== null && n >= 0 ? Math.round(n) : 250 * TOKENS_PER_RUPEE;
}

/**
 * The ₹→wallet-token unit conversion, used EVERYWHERE money meets tokens (credit mint, build debit,
 * pre-flight estimate display, 402 payload) so the rate can never drift between surfaces. Signed on
 * purpose: a negative ₹ (overdraft balance) converts to negative tokens for honest display. Non-finite → 0.
 */
export function inrToWalletTokens(inr: number): number {
  return Number.isFinite(inr) ? Math.round(inr * TOKENS_PER_RUPEE) : 0;
}

/**
 * The ₹→token conversion for a DEBIT (a build charge), as an EXACT possibly-fractional amount.
 *
 * It used to round UP, for margin protection. That had two costs. The small one: every build charged
 * the user up to ₹0.01 more than it really cost, which the White-Label Law's "the bill they pay is
 * always the real one" does not allow. The real one: `tokenBalance` was debited with the ceil while
 * `remaining_balance` was debited with the paisa-rounded ₹, so the wallet's TWO views of the same
 * money drifted a little further apart on every single build.
 *
 * Margin is not given away — the sub-token remainder is CARRIED to the user's next charge
 * (computeDebitedWallet), so nothing is forgiven, only deferred by at most ₹0.01. That also makes
 * per-message charges honest: rounding a ₹0.002 chat turn up to ₹0.01 would have billed 5× the real
 * cost, which is the wrong answer for one shared wallet spent everywhere.
 *
 * Float noise is scrubbed so a clean ₹ amount (0.3 × 100 = 30.000000000000004 in IEEE-754) stays
 * clean. Non-finite / non-positive → 0.
 */
export function inrToDebitTokens(inr: number): number {
  if (!Number.isFinite(inr) || inr <= 0) return 0;
  return Math.round(inr * TOKENS_PER_RUPEE * 1e6) / 1e6; // exact to a millionth of a token
}

// The order→tokens arithmetic lives in `orderCredit.ts` since Q-614 (2026-10-05): the refund clawback
// must remove exactly what the credit added, so both read ONE formula. Re-exported so every existing
// importer of these names from this module is unchanged.
export { creditableTokens, recordedPlatformFee, orderCreditedTokens, orderNetPaidInr } from './orderCredit';
export type { WalletCreditTx } from './orderCredit';

/**
 * PURE credit computation: given the CURRENT wallet doc and a verified paid order, return the FULL new wallet doc after crediting. No I/O. The caller runs read→compute→write
 * INSIDE a Firestore transaction that re-reads `current` in-transaction, so two concurrent credits to
 * the same wallet (two orders, or webhook + client poll, or a coupon credit) can't lost-update: on a
 * concurrent commit the transaction retries, re-reads the now-higher balance, and re-applies the delta
 * on top. Every add is `(current field) + delta`, so accumulation is correct on retry. Tested.
 */
export function computeCreditedWallet(
  current: Record<string, any>,
  txData: WalletCreditTx,
  now: string,
): { wallet: Record<string, any> } {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const amountPaid = n(txData.amountPaid);
  const balanceAdded = orderNetPaidInr(txData);
  // THE PLATFORM FEE (see platformFee.ts). The wallet is credited the NET of the payment; the fee is
  // NavBharatAI's revenue and never reaches the balance. `totalMoneySpent` below still records the
  // GROSS — that field answers "how much has this user paid us", which is the full amount.
  const platformFee = recordedPlatformFee(txData);
  // Q-1226: the two wallet views share ONE net-paid basis, never an independent balanceAdded.
  // Cashfree normalizes amountPaid from its verified response before calling this function; store
  // purchases use their verified pack credit. Refunds read this same persisted basis (orderCredit.ts).
  // Do not route this through a gift-clamping writer: a paid top-up preserves existing gift tracking.
  const tokensToCredit = orderCreditedTokens(txData);

  const update: Record<string, any> = {};

  // 🔴 THE PENDING-PROMO BRANCH IS GONE (forensic audit 2026-10-04, P0). It read
  // `promo_redemptions/promo_pending_<uid>` and, when present, credited a flat 1,000 tokens INSTEAD of
  // the paid amount while `remaining_balance` still got the full rupees. Its comment called it
  // unreachable because no route wrote that document — but the Firestore rules let ANY signed-in user
  // create it, for any uid. So a user could plant one on a stranger's wallet (their next ₹5,000 recharge
  // credited ₹10 of tokens) or on their own (the two balance views diverged, and the spending gate reads
  // the larger while the overdraft floor reads the smaller — free usage). A credit is the verified paid
  // amount, always; the rules now refuse every client write to that collection.
  const creditedTokens = tokensToCredit;
  update.tokenBalance = n(w.tokenBalance) + tokensToCredit;
  update.totalTokensPurchased = n(w.totalTokensPurchased) + creditedTokens;
  // GROSS here on purpose: "how much has this user paid us" is the full amount, fee included.
  update.totalMoneySpent = n(w.totalMoneySpent) + amountPaid;
  // 🔴 A "LAST RECHARGE" TIMESTAMP ON A ZERO-RUPEE CREDIT IS A FALSE FACT (2026-09-21).
  //
  // This was unconditional, three lines below `amountPaid = n(txData.amountPaid)` — and `n()`
  // returns **0** for anything that is not a finite number. So a transaction row whose `amountPaid`
  // is absent, a string or NaN (a legacy row, a hand-fixed one, a provider payload that changed
  // shape), and the promo branch above, all added ₹0 to `totalMoneySpent` and still stamped
  // `lastRechargeAt`. The wallet then said *"they recharged"* and *"they have paid us nothing"* at
  // the same time — and BOTH sentences were read, by different modules, as the answer to "is this a
  // paying customer?":
  //
  //   • `FreeTierBuildRouting.hasEverPaid` reads the money ⇒ not a customer (routed to cheap engines,
  //     shown as "Free" on the admin Users list);
  //   • `giftSpend`'s predicate also accepts the timestamp ⇒ a customer, so on an untracked wallet
  //     `giftRemaining` returns 0 and **the welcome gift buys a hosting plan** — the one thing the
  //     admin banned in capitals (*"gift … plan purchase me kam nahi ayenge!!!!!"*).
  //
  // The two predicates are not the bug; this line is. `lastRechargeAt` is also shown to the USER
  // (`routes/profile.ts`), where a stamp for a recharge that never happened is its own dishonesty.
  // Money arrived, or no recharge happened. A wallet already carrying a real stamp keeps it — this
  // only stops a new false one being written.
  if (amountPaid > 0) update.lastRechargeAt = now;
  const ledgerEntry = {
    type: 'purchase',
    amountCoinsOrTokens: creditedTokens,
    moneySpent: amountPaid,
    timestamp: now,
    // The fee is NAMED in the user's own ledger when there was one — a deduction the user can see in
    // their history is a disclosure; one they can only infer from a smaller number is not.
    description: `Wallet recharge: ₹${amountPaid}${platformFee > 0 ? ` (₹${platformFee.toFixed(2)} platform fee)` : ''} (${creditedTokens.toLocaleString()} tokens added)`,
  };
  // 🔴 THIS APPEND USED TO BE UNBOUNDED while every DEBIT path trimmed at 500 — so a wallet's
  // purchase rows could grow without limit toward Firestore's 1 MiB document cap, and the two halves
  // of one ledger disagreed about whether it had a size at all. Through the shared appender it is
  // bounded like the rest, and whatever rolls off lands in the opening balance rather than vanishing.
  {
    const appended = appendLedgerEntry(w, ledgerEntry);
    update.walletLedger = appended.ledger;
    update[LEDGER_OPENING_FIELD] = appended.openingTokens;
    update[LEDGER_DROPPED_FIELD] = appended.droppedCount;
  }
  // NET here, and it must stay net: this is the ₹ view of the same balance `tokenBalance` holds, so
  // crediting gross on one and net on the other is how the wallet's two views drift apart.
  update.remaining_balance = n(w.remaining_balance) + balanceAdded;
  update.total_balance = n(w.total_balance) + balanceAdded;

  update.updatedAt = now;
  return { wallet: { ...w, ...update } };
}

/**
 * Reusable internal payment verification + wallet-credit service.
 * Extracted from the server.ts monolith (Phase 1) with behavior unchanged.
 * Verifies a Cashfree order with Cashfree itself (there is no simulator — Q-615), then
 * credits the user's wallet/tokens idempotently.
 */
/** A wallet document for an account that has never had one. */
function newWalletFor(userId: string): Record<string, any> {
  return {
    userId,
    unlockedModes: [],
    tokenBalance: 0,
    totalTokensPurchased: 0,
    totalTokensUsed: 0,
    totalMoneySpent: 0,
    lastRechargeAt: null,
    walletLedger: [],
    remaining_balance: 0,
    total_balance: 0,
    total_output_tokens_used: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * A GIFT CODE product: mint the code, credit NOBODY's wallet, and return.
 *
 * 🔴 THE BUYER IS NOT CREDITED, and that is the product rather than an omission. They bought a code for
 * somebody else; crediting their own balance as well would hand out the money twice. `balanceAdded` was
 * written as 0 at order creation for the same reason.
 *
 * Runs AFTER the order was claimed (PENDING→SUCCESS), and again on any later call that finds the order
 * claimed but carrying no code (Q-613): `mintCodeForOrder` is idempotent on the order id, so a resumed
 * mint returns the same code and never mints twice — the webhook, the redirect return and the sign-in
 * reconcile sweep can all arrive for one order.
 *
 * ⚠️ THE FACE VALUE COMES FROM THE TX DOC, which the SERVER wrote from its own arithmetic at order
 * creation — never from a client field.
 */
async function fulfilGiftOrder(db: any, txRef: any, orderId: string, txData: any): Promise<{ success: boolean; data?: any; error?: string }> {
  const face = Number((txData as { giftFaceInr?: unknown }).giftFaceInr);
  if (!Number.isFinite(face) || face <= 0) {
    console.error(
      `[GIFT] Order ${orderId} paid ₹${txData.amountPaid} but carries no face value — NOTHING minted; ` +
      `this payment needs a manual refund.`,
    );
    try { await updateDoc(txRef, { fulfilmentError: 'gift_face_missing', fulfilledAt: new Date().toISOString() }); } catch { /* logged above */ }
    return { success: false, error: 'That gift purchase could not be completed. Please contact support for a refund.' };
  }
  const code = await mintCodeForOrder(db, {
    orderId,
    buyerUid: txData.userId,
    faceInr: face,
    paidInr: Number(txData.amountPaid) || 0,
    feeInr: recordedPlatformFee(txData),
    nowMs: Date.now(),
    randomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  });
  try { await updateDoc(txRef, { giftCode: code, fulfilledAt: new Date().toISOString() }); } catch { /* the code exists; the audit note is best-effort */ }
  // 🔴 A REFUND THAT ARRIVED BEFORE THE CODE EXISTED (Q-614). The refund webhook found no code to void
  // and recorded its totals on the order; the code minted just now must not go out at full value. The
  // order is RE-READ (the `txData` above may predate the refund), and the reduction goes through the same
  // transaction every reversal uses, keyed on the order's own marker, so it can never apply twice.
  let faceNow = face;
  try {
    const fresh = await getDoc(txRef);
    if (fresh.exists() && recordedReversedInr(fresh.data()) > 0) {
      const reversal = await applyOrderReversal(db, { orderId, refundedInr: null, disputeLostInr: null });
      if (reversal.status === 'gift-code-voided') {
        return { success: false, error: 'This gift purchase was refunded, so its code is no longer valid.' };
      }
      if (reversal.status === 'gift-code-reduced' && typeof reversal.giftFaceInr === 'number') faceNow = reversal.giftFaceInr;
    }
  } catch (e: any) {
    console.error(`[GIFT] Order ${orderId}: could not apply a recorded refund to the new code — ${e?.message}`);
  }
  // `buyerUid` is for the route's owner check only; `verify-payment` strips it before answering (Q-630).
  return { success: true, data: { giftCode: code, giftFaceInr: faceNow, paidInr: Number(txData.amountPaid) || 0, buyerUid: txData.userId } };
}

/** Normalize the fresh order and the audit in the same transaction that settles it. */
function settledGatewayOrder(
  fresh: Record<string, any>,
  original: Record<string, any>,
  paidAmount: number,
  orderId: string,
  nowIso: string,
) {
  // The wallet target/product was selected before the provider read. A changed owner or product
  // must be retried from a fresh lookup, never credited to the stale target.
  if (fresh.userId !== original.userId || String(fresh.productType || '') !== String(original.productType || '')) {
    throw new Error('This payment changed during verification. Please try again.');
  }
  const verified = reconcileGatewayPaidAmount(paidAmount, fresh.amountPaid);
  const unreconciled = verified.unreadableRecorded
    ? unreconciledCreditPatch(verified.amountPaid, fresh.amountPaid, nowIso)
    : null;
  if (unreconciled) {
    console.error(`[CASHFREE] UNRECONCILED CREDIT for order ${orderId}: the paid-vs-recorded check could NOT run. Settling from the verified gateway amount and recorded fee; the original amount is retained on the order for review.`);
  }
  const paid = { ...fresh, amountPaid: verified.amountPaid } as WalletCreditTx & Record<string, any>;
  const isWallet = !['gift_code', 'professional_pass'].includes(String(fresh.productType || ''));
  // A gift's face value is a distinct server-written product entitlement, not the buyer's wallet.
  const paymentPatch = { amountPaid: verified.amountPaid, balanceAdded: isWallet ? orderNetPaidInr(paid) : 0 };
  return { settled: { ...paid, ...paymentPatch }, paymentPatch, unreconciled };
}

/**
 * 🔑 `settled` SAYS WHETHER A FAILURE IS FINAL, AND IT EXISTS FOR THE WEBHOOK (Q-888).
 *
 * The signed-webhook route used to answer **400** to every `success: false`, so Cashfree re-sent an
 * event we had already decided about — an amount mismatch, an order this server never created, an
 * EXPIRED or TERMINATED order — and delivered it again, forever. The route could not tell a decision
 * from an outage, because this function did not say.
 *
 * ⚠️ A FAILED or USER_DROPPED ATTEMPT IS NOT ONE OF THESE, and Q-888's row said it was. Those are
 * PAYMENT statuses; `cashfreeOrderClosedUnpaid` recognises only the ORDER statuses EXPIRED and
 * TERMINATED, so such an event lands on "Order not paid or invalid status" with the order still open.
 * It is retryable HERE (the order may yet be paid) and acknowledged by the ROUTE (re-sending a failed
 * attempt reports the same failure for ever) — `cashfreePaymentEventIsFailure` makes that call, because
 * only the route can see which event woke it.
 *
 * `settled: true` means THIS ORDER WILL NEVER BE FULFILLED AND THAT IS THE ANSWER — the gateway says it
 * closed unpaid, the amounts disagree, it is not an order this server created, or a pass payment was
 * below the price and is recorded for a manual refund. Re-delivery would reach the same conclusion.
 *
 * 🔴 ABSENT MEANS RETRYABLE, AND THAT DEFAULT IS DELIBERATE. A missing database, unreadable gateway
 * credentials or a PAID order whose `order_amount` cannot be read are conditions that may clear; a
 * later delivery fulfils the order. Acknowledging an event we could not complete LOSES it, and losing
 * a payment event costs a customer their credit, so the unflagged direction is the safe one. The
 * reversal path above answers 502 for the same reason, in its own words.
 * `tests/aSettledWebhookIsNotRejected.test.ts` fails if a failure return omits the field, so the next
 * one cannot inherit either behaviour by accident.
 */
export async function verifyPaymentInternal(orderId: string): Promise<{ success: boolean; data?: any; error?: string; settled?: boolean }> {
  const db = getDb() as any;
  // retryable (settled: false): no database is an outage, not a verdict on this order.
  if (!db) return { success: false, error: 'Database not initialized', settled: false };

  try {
    const txRef = doc(db, 'payment_transactions', orderId);
    const txSnap = await getDoc(txRef);
    if (!txSnap.exists()) {
      // settled: not an order this server created. The reversal path already answers 200/IGNORED for
      // its own unknown-order case; re-delivering this one forever would never produce a different answer.
      return { success: false, error: 'Transaction record not found', settled: true };
    }

    const txData = txSnap.data();
    if (txData.paymentStatus === 'SUCCESS') {
      // A GIFT order claimed but never minted (the process died between the claim and the mint) is
      // finished here, not reported as done: `mintCodeForOrder` is idempotent on the order id, so the
      // webhook's retry or the buyer's next check completes it (Q-613, forensic audit 2026-10-04).
      if (String(txData.productType || '') === 'gift_code' && !txData.giftCode && !txData.fulfilmentError) {
        return fulfilGiftOrder(db, txRef, orderId, txData);
      }
      return { success: true, data: { alreadyProcessed: true, balanceAdded: txData.balanceAdded } };
    }

    // The merchant credentials are NavBharatAI's own and come only from the server environment —
    // never from the order owner's secret vault (cashfreeCredentials.ts, forensic audit 2026-10-04).
    // There is NO simulator branch (Q-615): an order is paid only when Cashfree itself says PAID. Without
    // real keys, or with test keys in production, nothing is verified and nothing is credited.
    const availability = cashfreePaymentsAvailability();
    if (!availability.ok) {
      console.error(`[CASHFREE] Cannot verify order ${orderId}: ${availability.code}`);
      // retryable: the platform's own gateway keys are missing or test keys are live. Once the admin
      // fixes that, a re-delivery fulfils the order; acknowledging it now would strand the payer.
      return { success: false, error: availability.message, settled: false };
    }
    const { clientId, clientSecret, mode: env } = availability;

    let isPaid = false;
    let cfOrderIdRef = 'cf_' + orderId;
    let verifiedPaidAmount: number | null = null;

    {
      const cfUrl = env === 'production'
        ? `https://api.cashfree.com/pg/orders/${orderId}`
        : `https://sandbox.cashfree.com/pg/orders/${orderId}`;

      const response = await axios.get(cfUrl, {
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2023-08-01'
        },
        timeout: 15_000, // DB-16: a hung provider call must not block the sweep
      });

      const orderDetails = response.data;
      if (orderDetails.order_status === 'PAID') {
        // Reject an unreadable/non-positive gateway amount or a real mismatch. Numeric legacy
        // strings are accepted but normalized to a number before either credit view can read them.
        verifiedPaidAmount = reconcileGatewayPaidAmount(orderDetails.order_amount, txData.amountPaid).amountPaid;
        isPaid = true;
        cfOrderIdRef = orderDetails.cf_order_id || 'cf_' + orderId;
      } else if (cashfreeOrderClosedUnpaid(orderDetails.order_status)) {
        // DB-5 (go-live audit 2026-10-13): Cashfree says this order can never be paid. Settle it as
        // EXPIRED so it stops sitting in PENDING forever and crowding real payments out of the sweep.
        // Only a PENDING order is flipped, inside a transaction — a concurrent PAID credit always wins.
        await runTransaction(db, async (tx: any) => {
          const snap = await tx.get(txRef);
          if (snap.exists() && snap.data().paymentStatus === 'PENDING') {
            tx.update(txRef, { paymentStatus: 'EXPIRED', expiredAt: new Date().toISOString(), providerOrderStatus: String(orderDetails.order_status) });
          }
        });
        // settled: Cashfree says this order can never be paid, and it has just been marked EXPIRED.
        // This is Q-888's own case — PAYMENT_FAILED / USER_DROPPED, answered 400 and re-sent forever.
        return { success: false, error: 'This payment was not completed.', settled: true };
      }
    }

    if (isPaid && !['professional_pass', 'gift_code'].includes(String(txData.productType || ''))) {
      // 🔴 ONE TRANSACTION FOR THE CLAIM AND THE CREDIT (Q-613, forensic audit 2026-10-04). They used to be
      // two: the PENDING→SUCCESS flip committed, THEN the wallet credit ran. A process that died between
      // them (a deploy, an OOM, a lost Firestore call) left the order SUCCESS with nothing credited — and
      // every later call (the webhook's retry, the buyer's check, the reconcile sweep, which reads only
      // PENDING) answered "already processed". The customer had paid and would never be credited. Now both
      // writes commit together or not at all, so a retry always finds the order still PENDING and finishes
      // it. Exactly-once is unchanged: a concurrent caller re-reads SUCCESS inside its own transaction.
      // (SECURITY C4: tokens still derive from the VERIFIED paid amount inside computeCreditedWallet.)
      const walletRef = doc(db, 'user_token_wallets', await creditWalletId(db, txData.userId));
      const credited = await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(txRef);
        if (!snap.exists()) return null;
        if (snap.data().paymentStatus === 'SUCCESS') return { alreadyProcessed: true as const, balanceAdded: snap.data().balanceAdded };
        const walletSnap = await tx.get(walletRef);
        const walletData = walletSnap.exists() ? walletSnap.data() : newWalletFor(txData.userId);
        const nowIso = new Date().toISOString();
        const { settled: fresh, paymentPatch, unreconciled } = settledGatewayOrder(snap.data(), txData, verifiedPaidAmount!, orderId, nowIso);
        const { wallet: creditedWallet } = computeCreditedWallet(walletData, fresh, nowIso);
        // A refund or chargeback recorded on this order BEFORE it was credited (Q-614) is taken back in
        // this same transaction — otherwise the credit would add the full amount after the reversal
        // had already been handled, and nothing would ever take it back.
        const reversal = settleRecordedReversalAtCredit(creditedWallet, fresh, orderCreditedTokens(fresh), orderId, nowIso);
        const wallet = reversal ? reversal.wallet : creditedWallet;
        tx.update(txRef, { paymentStatus: 'SUCCESS', paymentReference: cfOrderIdRef, ...paymentPatch, ...(reversal ? reversal.txPatch : {}), ...(unreconciled ?? {}) });
        tx.set(walletRef, withLedgerV2(tx, (c, i) => doc(db, c, i), String(walletRef.id ?? txData.userId), walletSnap.exists() ? walletSnap.data() : null, wallet, `cashfree:${orderId}`));
        return { wallet, balanceAdded: fresh.balanceAdded, alreadyProcessed: false as const };
      });
      if (!credited) return { success: false, error: 'Transaction record not found', settled: true };
      if (credited.alreadyProcessed) {
        return { success: true, data: { alreadyProcessed: true, balanceAdded: credited.balanceAdded } };
      }
      return {
        success: true,
        data: {
          balanceAdded: credited.balanceAdded,
          currentBalance: credited.wallet.remaining_balance,
          tokenBalance: credited.wallet.tokenBalance,
        },
      };
    }

    if (isPaid) {
      // SECURITY (H1): atomically claim the PENDING→SUCCESS flip so N concurrent /verify-payment calls
      // on ONE genuinely-paid order can't each credit the wallet (a TOCTOU double-spend — the old
      // getDoc-status → updateDoc → credit had a race window). Only the caller that WINS the flip
      // proceeds; the others observe SUCCESS and return alreadyProcessed. Since Q-613 this separate claim
      // serves only the PASS and GIFT products (wallet credits claim inside their own transaction above);
      // a gift order claimed but not yet minted is resumed by the SUCCESS branch at the top.
      const claimedNow = await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(txRef);
        if (!snap.exists()) return null;
        if (snap.data().paymentStatus === 'SUCCESS') return { settled: snap.data(), alreadyProcessed: true };
        const { settled, paymentPatch, unreconciled } = settledGatewayOrder(snap.data(), txData, verifiedPaidAmount!, orderId, new Date().toISOString());
        tx.update(txRef, { paymentStatus: 'SUCCESS', paymentReference: cfOrderIdRef, ...paymentPatch, ...(unreconciled ?? {}) });
        return { settled, alreadyProcessed: false };
      });
      if (!claimedNow) return { success: false, error: 'Transaction record not found', settled: true };
      if (claimedNow.alreadyProcessed) {
        return { success: true, data: { alreadyProcessed: true, balanceAdded: claimedNow.settled.balanceAdded } };
      }
      const settled = claimedNow.settled;

      // ⚠️ KEPT ON PURPOSE AFTER THE PASS WAS WITHDRAWN (admin 2026-08-10, "pass system hata do").
      // New pass orders are refused at creation (`pass_withdrawn` in routes/payment.ts), so nothing can
      // reach here any more. This settlement path stays anyway: if a PENDING pass order somehow exists
      // — an in-flight checkout at deploy time, a webhook arriving late — deleting this would mean
      // taking the money and delivering nothing. Refusing NEW orders while still honouring any that
      // already exist is the honest order to remove a paid product in. It can be deleted once the
      // payment_transactions collection holds no pending 'professional_pass' rows.
      //
      // PROFESSIONAL PASS product: grant a time-based pass — never credit wallet tokens. The atomic
      // PENDING→SUCCESS claim above already guarantees this runs exactly once per paid order (webhook +
      // client poll can't double-grant). Days/plan come from the tx doc, falling back to the server
      // config (never trusts the client for the entitlement length).
      if (String(settled.productType || '') === 'professional_pass') {
        // SECURITY (money): the entitlement is DERIVED from the amount actually paid — which the block
        // above has already reconciled against what Cashfree really charged — times the SERVER's own
        // price. The client's `passDays` is deliberately ignored: it used to be trusted, so an order of
        // `{ amount: 1, passDays: 36500 }` bought a hundred-year pass for one rupee. Same defect class
        // as the C4 wallet fix (credited tokens derive from the verified paid amount), applied here.
        const entitlement = passEntitlementForPayment(settled.amountPaid);
        const plan = String(settled.passPlan || 'monthly');
        if (entitlement.days <= 0) {
          // Paid, but not enough for a single period. The order-creation guard should have refused this,
          // so reaching here means money moved with nothing to grant — record it loudly for a refund
          // rather than silently swallowing the payment.
          console.error(
            `[PASS] Order ${orderId} paid ₹${settled.amountPaid} — below the ₹${professionalPassPriceInr()} pass price. ` +
            `NOTHING granted; this payment needs a manual refund.`,
          );
          try { await updateDoc(txRef, { fulfilmentError: 'amount_below_pass_price', fulfilledAt: new Date().toISOString() }); } catch { /* logged above */ }
          // settled: recorded as `fulfilmentError` above and awaiting a manual refund. Re-running this
          // reaches the same conclusion, and the order already carries the record of it.
          return { success: false, error: 'That payment did not cover the Professional Pass price. Please contact support for a refund.', settled: true };
        }
        if (entitlement.capped) {
          console.error(
            `[PASS] Order ${orderId} paid ₹${settled.amountPaid} — covers more than the ${MAX_PASS_PERIODS}-period ` +
            `automatic maximum. Granted ${entitlement.days} days; the remainder needs an admin decision.`,
          );
        }
        const expiresAt = await professionalPassStore.grant(settled.userId, entitlement.days, plan);
        try {
          await updateDoc(txRef, {
            passDaysGranted: entitlement.days,
            ...(entitlement.capped ? { passCapped: true } : {}),
            fulfilledAt: new Date().toISOString(),
          });
        } catch { /* the pass is granted; the audit note is best-effort */ }
        return { success: true, data: { professionalPass: true, expiresAt, plan, days: entitlement.days } };
      }

      /**
       * A GIFT CODE product: mint the code, credit NOBODY's wallet, and return.
       *
       * 🔴 THE BUYER IS NOT CREDITED, and that is the product rather than an omission. They bought a
       * code for somebody else; crediting their own balance as well would hand out the money twice.
       * `balanceAdded` was written as 0 at order creation for the same reason, so even if this branch
       * were somehow bypassed the wallet path below would add nothing.
       *
       * Exactly-once is inherited from the PENDING→SUCCESS claim above, and `mintCodeForOrder` is
       * idempotent on the order id as well — belt and braces, because the webhook, the redirect
       * return and the sign-in reconcile sweep can all arrive for one order.
       *
       * ⚠️ THE FACE VALUE COMES FROM THE TX DOC, which the SERVER wrote from its own arithmetic at
       * order creation — never from a client field. Same rule as the Pass entitlement one block up,
       * and for the same reason: the amount paid and the thing delivered are two different numbers.
       */
      if (String(settled.productType || '') === 'gift_code') {
        return fulfilGiftOrder(db, txRef, orderId, settled);
      }

      // Unreachable: wallet products are claimed and credited in one transaction above; pass and gift
      // orders returned in their branches.
    }

    // retryable: the gateway still has this order OPEN (not paid, not closed-unpaid), so the payer may
    // yet complete it and a later delivery of this same event can fulfil it. Acknowledging now would
    // throw away the one notification that becomes useful the moment the money arrives.
    return { success: false, error: 'Order not paid or invalid status', settled: false };
  } catch (err: any) {
    console.error('[CASHFREE] Internal verification failed:', err.message);
    // Q-888: a readable amount mismatch is a decision, including one found on the fresh row.
    // Keep it distinct from unreadable gateway data, ownership changes, and transaction failures.
    if (err instanceof PaymentAmountMismatchError) return { success: false, error: err.message, settled: true };
    // retryable: an unexpected exception is an outage by definition, never a verdict on this order.
    return { success: false, error: err.message, settled: false };
  }
}
