import axios from 'axios';
import { appendLedgerEntry, LEDGER_OPENING_FIELD, LEDGER_DROPPED_FIELD } from './walletStatement';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Credits user_token_wallets /
// payment_transactions / promo_redemptions, all server-only under navbharat-prod's rules.
import { doc, getDoc, updateDoc, runTransaction, getServerDb as getDb } from './serverDb';
import { getSecretValue } from './secrets';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
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
 * WELCOME BONUS tokens minted for a brand-new wallet.
 *
 * 25,000 = ₹250 (admin 2026-07-28). Previously 50,000 (₹500), from the era when the bonus only had to
 * cover a first app BUILD. It is now the opening balance of a single wallet that pays for everything —
 * builds, images, strong-model answers — and it is followed by a weekly top-up (see weeklyTopUp.ts), so
 * the SIGNUP grant no longer has to carry a user on its own. ₹250 still funds a complete first app.
 *
 * What it actually costs us: builds bill at roughly 4x the real provider cost, so ₹250 of credit is
 * about ₹62 of real spend per new account — the number that matters when signups scale.
 *
 * Env-overridable (WELCOME_BONUS_TOKENS) so the admin can tune it from Cloud Run without a deploy;
 * non-finite/negative overrides fall back to the default.
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

/** Tokens a purchase credits, derived ONLY from the amount actually paid (net of our fee). Pure. */
export function creditableTokens(netPaidRupees: unknown): number {
  const paid = Number(netPaidRupees);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  return Math.round(paid * TOKENS_PER_RUPEE);
}

export interface WalletCreditTx {
  userId: string;
  amountPaid: number;
  balanceAdded: number;
  /**
   * The platform fee this payment carried, in ₹ — written by the route that CREATED the order, from
   * the rate that was disclosed to the user on that screen. Absent on a transaction created before
   * the fee existed, and absent on a store purchase (Play/Apple packs are priced with their fee
   * already inside), and absent means ZERO: those credit in full, exactly as they were sold.
   */
  platformFeeInr?: number;
}

/**
 * The platform fee actually recorded on a transaction.
 *
 * 🔑 READ FROM THE TRANSACTION, NOT RE-COMPUTED FROM THE CURRENT RATE. The user agreed to a split on
 * the screen where they paid; if the admin changes the rate while an order sits pending, re-deriving
 * it here would credit a different amount than the one they were shown. The stored number is written
 * by our own route, never by the client, so reading it is not trusting the caller.
 *
 * Clamped to [0, amountPaid] so no corrupt or hand-edited row can ever produce a negative credit.
 */
export function recordedPlatformFee(txData: WalletCreditTx): number {
  const paid = Number(txData.amountPaid);
  const fee = Number(txData.platformFeeInr);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return Math.min(fee, paid);
}

/**
 * PURE credit computation: given the CURRENT wallet doc, a verified paid order, and an optional pending
 * promo, return the FULL new wallet doc after crediting. No I/O. The caller runs read→compute→write
 * INSIDE a Firestore transaction that re-reads `current` in-transaction, so two concurrent credits to
 * the same wallet (two orders, or webhook + client poll, or a coupon credit) can't lost-update: on a
 * concurrent commit the transaction retries, re-reads the now-higher balance, and re-applies the delta
 * on top. Every add is `(current field) + delta`, so accumulation is correct on retry. Tested.
 */
export function computeCreditedWallet(
  current: Record<string, any>,
  txData: WalletCreditTx,
  promo: { mode?: string } | null,
  now: string,
): { wallet: Record<string, any>; promoApplied: boolean } {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const amountPaid = n(txData.amountPaid);
  const balanceAdded = n(txData.balanceAdded);
  // THE PLATFORM FEE (see platformFee.ts). The wallet is credited the NET of the payment; the fee is
  // NavBharatAI's revenue and never reaches the balance. `totalMoneySpent` below still records the
  // GROSS — that field answers "how much has this user paid us", which is the full amount.
  const platformFee = recordedPlatformFee(txData);
  const netPaid = Math.round((amountPaid - platformFee) * 100) / 100;
  // SECURITY C4 stands: the tokens still derive from the VERIFIED paid amount, only now net of our
  // own server-written fee — never from anything the client sent.
  //
  // 🔴 ONE CREDIT PATH (2026-09-12, when the Vishwakarma entry pass was deleted). There used to be
  // two, chosen by `isVishwakarmaOrder`, and the only thing that genuinely differed between them was
  // the pass: the Vishwakarma branch subtracted ₹100 before minting tokens. With the pass gone the
  // two were arithmetically IDENTICAL, and that was verified rather than assumed, both ways:
  //   • web recharge — `amountPaid` is GROSS and `balanceAdded` is the net the route computed, so
  //     `netPaid = amountPaid − platformFee === balanceAdded`;
  //   • Play / Apple top-up — carries no `platformFeeInr` (the store's cut is taken before payout and
  //     recorded separately as `storeNetInr`), so `recordedPlatformFee` returns 0 and
  //     `netPaid === amountPaid === balanceAdded`.
  // Collapsing them removes the duplicated money arithmetic this file's own header warns about: a
  // money rule with two homes is free to drift between them, which is exactly how the pass price came
  // to read ₹50 on one screen and ₹100 on another.
  const tokensToCredit = creditableTokens(netPaid);

  const update: Record<string, any> = {};

  // THE PENDING-PROMO BRANCH, and what was cut out of it.
  //
  // It used to ALSO grant `hasVishwakarmaPass` and push `promo.mode` onto `unlockedModes` — both
  // Vishwakarma entitlements, both now meaningless, so both removed. The promo itself still credits
  // its tokens, so the mechanism survives its dead reward.
  //
  // ⚠️ IT IS UNREACHABLE TODAY, and that is recorded rather than relied on: the only thing that ever
  // wrote `promo_redemptions/promo_pending_*` would have been `/api/payment/validate-mode-promo`, a
  // route that never existed on the server (see usePaymentEngine.ts, which removed its caller for
  // exactly that reason). The branch is kept because the read costs one Firestore get inside a
  // transaction that already does two, and because a future promo can hook into it honestly. The
  // LIVE coupon path is `/api/payment/redeem-coupon` and is untouched by any of this.
  //
  // It also had a real arithmetic bug worth naming: it credited 1,000 tokens while recording 10,000
  // in `totalTokensPurchased` and in the user's own ledger line. One number now drives all three.
  const PROMO_TOKENS = 1000;
  const promoApplied = !!promo;
  if (promoApplied) update.tokenBalance = n(w.tokenBalance) + PROMO_TOKENS;

  // ── ONE credit path for every purchase: web recharge, Play pack, Apple pack ──
  const creditedTokens = promoApplied ? PROMO_TOKENS : tokensToCredit;
  if (!promoApplied) update.tokenBalance = n(w.tokenBalance) + tokensToCredit;
  update.totalTokensPurchased = n(w.totalTokensPurchased) + creditedTokens;
  // GROSS here on purpose: "how much has this user paid us" is the full amount, fee included.
  update.totalMoneySpent = n(w.totalMoneySpent) + amountPaid;
  update.lastRechargeAt = now;
  const ledgerEntry = {
    type: 'purchase',
    amountCoinsOrTokens: creditedTokens,
    moneySpent: amountPaid,
    timestamp: now,
    // The fee is NAMED in the user's own ledger when there was one — a deduction the user can see in
    // their history is a disclosure; one they can only infer from a smaller number is not.
    description: `Wallet recharge: ₹${amountPaid}${platformFee > 0 ? ` (₹${platformFee.toFixed(2)} platform fee)` : ''} (${creditedTokens.toLocaleString()} tokens added)${promoApplied ? ' — promo credit' : ''}`,
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
  return { wallet: { ...w, ...update }, promoApplied };
}

/**
 * Reusable internal payment verification + wallet-credit service.
 * Extracted from the server.ts monolith (Phase 1) with behavior unchanged.
 * Verifies a Cashfree order (or simulates when keys are placeholder), then
 * credits the user's wallet/tokens idempotently.
 */
export async function verifyPaymentInternal(orderId: string): Promise<{ success: boolean; data?: any; error?: string }> {
  const db = getDb() as any;
  if (!db) return { success: false, error: 'Database not initialized' };

  try {
    const txRef = doc(db, 'payment_transactions', orderId);
    const txSnap = await getDoc(txRef);
    if (!txSnap.exists()) {
      return { success: false, error: 'Transaction record not found' };
    }

    const txData = txSnap.data();
    if (txData.paymentStatus === 'SUCCESS') {
      return { success: true, data: { alreadyProcessed: true, balanceAdded: txData.balanceAdded } };
    }

    const userId = txData.userId;
    const dbClientId = await getSecretValue(userId, 'CASHFREE_CLIENT_ID') || await getSecretValue(userId, 'CASHFREE_APP_ID');
    const dbClientSecret = await getSecretValue(userId, 'CASHFREE_CLIENT_SECRET') || await getSecretValue(userId, 'CASHFREE_SECRET_KEY');

    const clientId = (dbClientId || process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID)?.trim();
    const clientSecret = (dbClientSecret || process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY)?.trim();
    const env = process.env.CASHFREE_ENV || (clientSecret && (clientSecret.toLowerCase().includes('test') || clientSecret.toLowerCase().includes('sandbox')) ? 'sandbox' : 'production');

    const isPlaceholder = !clientId || !clientSecret ||
      clientId.toLowerCase().includes('placeholder') ||
      clientSecret.toLowerCase().includes('placeholder') ||
      clientId.trim() === '' ||
      clientSecret.trim() === '';

    let isPaid = false;
    let cfOrderIdRef = 'cf_' + orderId;

    const isSimulatorOrder = isPlaceholder || txData.isSimulator || orderId.startsWith('sim_');
    if (isSimulatorOrder) {
      // The dev simulator credits a real wallet. That is acceptable ONLY outside production —
      // in production a missing/placeholder credential must NEVER mint free balance. Fail safe.
      if (process.env.NODE_ENV === 'production') {
        console.error(`[CASHFREE] Refusing simulator credit in production for order ${orderId} — real Cashfree credentials are required.`);
        return { success: false, error: 'Payment provider is not configured. Please contact support.' };
      }
      console.log(`[CASHFREE SIMULATION] (non-production) Marking order ${orderId} as paid inside verification simulator.`);
      isPaid = true;
    } else {
      const cfUrl = env === 'production'
        ? `https://api.cashfree.com/pg/orders/${orderId}`
        : `https://sandbox.cashfree.com/pg/orders/${orderId}`;

      const response = await axios.get(cfUrl, {
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2023-08-01'
        }
      });

      const orderDetails = response.data;
      if (orderDetails.order_status === 'PAID') {
        // Reconcile what Cashfree actually charged against the amount we recorded at create
        // time. Without this, a tampered/mismatched local record could credit more than was
        // paid. If they diverge beyond a 1-paisa rounding tolerance, refuse to credit.
        const paidAmount = Number(orderDetails.order_amount);
        const expectedAmount = Number(txData.amountPaid);
        if (Number.isFinite(paidAmount) && Number.isFinite(expectedAmount) && Math.abs(paidAmount - expectedAmount) > 0.01) {
          console.error(`[CASHFREE] Amount mismatch for order ${orderId}: Cashfree charged ${paidAmount}, expected ${expectedAmount}. Refusing to credit.`);
          return { success: false, error: 'Payment amount mismatch detected — please contact support.' };
        }
        isPaid = true;
        cfOrderIdRef = orderDetails.cf_order_id || 'cf_' + orderId;
      }
    }

    if (isPaid) {
      // SECURITY (H1): atomically claim the PENDING→SUCCESS flip so N concurrent /verify-payment calls
      // on ONE genuinely-paid order can't each credit the wallet (a TOCTOU double-spend — the old
      // getDoc-status → updateDoc → credit had a race window). Only the caller that WINS the flip
      // proceeds to credit; the others observe SUCCESS and return alreadyProcessed. The credit block
      // below therefore runs for exactly one caller per order and needs no further locking.
      const claimedNow = await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(txRef);
        if (!snap.exists()) return false;
        if (snap.data().paymentStatus === 'SUCCESS') return false; // already claimed by a concurrent call
        tx.update(txRef, { paymentStatus: 'SUCCESS', paymentReference: cfOrderIdRef });
        return true;
      });
      if (!claimedNow) {
        return { success: true, data: { alreadyProcessed: true, balanceAdded: txData.balanceAdded } };
      }

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
      if (String(txData.productType || '') === 'professional_pass') {
        // SECURITY (money): the entitlement is DERIVED from the amount actually paid — which the block
        // above has already reconciled against what Cashfree really charged — times the SERVER's own
        // price. The client's `passDays` is deliberately ignored: it used to be trusted, so an order of
        // `{ amount: 1, passDays: 36500 }` bought a hundred-year pass for one rupee. Same defect class
        // as the C4 wallet fix (credited tokens derive from the verified paid amount), applied here.
        const entitlement = passEntitlementForPayment(txData.amountPaid);
        const plan = String(txData.passPlan || 'monthly');
        if (entitlement.days <= 0) {
          // Paid, but not enough for a single period. The order-creation guard should have refused this,
          // so reaching here means money moved with nothing to grant — record it loudly for a refund
          // rather than silently swallowing the payment.
          console.error(
            `[PASS] Order ${orderId} paid ₹${txData.amountPaid} — below the ₹${professionalPassPriceInr()} pass price. ` +
            `NOTHING granted; this payment needs a manual refund.`,
          );
          try { await updateDoc(txRef, { fulfilmentError: 'amount_below_pass_price', fulfilledAt: new Date().toISOString() }); } catch { /* logged above */ }
          return { success: false, error: 'That payment did not cover the Professional Pass price. Please contact support for a refund.' };
        }
        if (entitlement.capped) {
          console.error(
            `[PASS] Order ${orderId} paid ₹${txData.amountPaid} — covers more than the ${MAX_PASS_PERIODS}-period ` +
            `automatic maximum. Granted ${entitlement.days} days; the remainder needs an admin decision.`,
          );
        }
        const expiresAt = await professionalPassStore.grant(txData.userId, entitlement.days, plan);
        try {
          await updateDoc(txRef, {
            passDaysGranted: entitlement.days,
            ...(entitlement.capped ? { passCapped: true } : {}),
            fulfilledAt: new Date().toISOString(),
          });
        } catch { /* the pass is granted; the audit note is best-effort */ }
        return { success: true, data: { professionalPass: true, expiresAt, plan, days: entitlement.days } };
      }

      const walletRef = doc(db, 'user_token_wallets', txData.userId);
      const promoRef = doc(db, 'promo_redemptions', `promo_pending_${txData.userId}`);
      const DEFAULT_WALLET: Record<string, any> = {
        userId: txData.userId,
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

      // CONCURRENCY (fix): credit the wallet INSIDE a transaction that re-reads the wallet + pending
      // promo in-transaction. Two concurrent credits to the SAME wallet (two orders, webhook + client
      // poll, or a coupon credit) used to lost-update because the old getDoc→compute→full setDoc ran
      // outside any transaction. Now Firestore aborts+retries this transaction on a concurrent commit,
      // so every credit re-reads the latest balance and adds its delta on top — never overwrites.
      // (SECURITY C4: tokens still derive from the VERIFIED paid amount inside computeCreditedWallet.)
      const integratedWallet = await runTransaction(db, async (tx: any) => {
        const walletSnap = await tx.get(walletRef);
        const promoSnap = await tx.get(promoRef); // all reads BEFORE any write (Firestore rule)
        const walletData = walletSnap.exists() ? walletSnap.data() : { ...DEFAULT_WALLET };
        const promo = promoSnap.exists() && promoSnap.data().status === 'PENDING'
          ? { mode: promoSnap.data().mode }
          : null;
        const { wallet, promoApplied } = computeCreditedWallet(walletData, txData as WalletCreditTx, promo, new Date().toISOString());
        if (promoApplied) tx.update(promoRef, { status: 'USED' });
        tx.set(walletRef, wallet);
        return wallet;
      });

      return {
        success: true,
        data: {
          balanceAdded: txData.balanceAdded,
          currentBalance: integratedWallet.remaining_balance,
          tokenBalance: integratedWallet.tokenBalance
        }
      };
    }

    return { success: false, error: 'Order not paid or invalid status' };
  } catch (err: any) {
    console.error('[CASHFREE] Internal verification failed:', err.message);
    return { success: false, error: err.message };
  }
}
