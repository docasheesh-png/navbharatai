import axios from 'axios';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Credits user_token_wallets /
// payment_transactions / promo_redemptions, all server-only under navbharat-prod's rules.
import { doc, getDoc, updateDoc, runTransaction, getServerDb as getDb } from './serverDb';
import { getSecretValue } from './secrets';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import {
  professionalPassPriceInr, passEntitlementForPayment, MAX_PASS_PERIODS,
} from '../professionals/professionalPaid';

// SECURITY (audit C4 — CRITICAL, financial): the vishwakarma order's paid amount is
// `tokenAmount₹ + (buyPass ? pass : 0)` (client: createVishwakarmaOrder in App.tsx). The credit path
// used to mint `client tokenAmount × 100` tokens — a value NEVER bound to what was actually paid — so
// a `{amount: 1, tokenAmount: 1_000_000}` order paid ₹1 and minted 100M tokens. We now DERIVE the
// creditable tokens from the VERIFIED paid amount instead: tokens = (paid − pass) × TOKENS_PER_RUPEE.
// (The standard, non-vishwakarma path already binds to paid ₹ via balanceAdded.) Pass price + rate must
// match the client's createVishwakarmaOrder; change both together if pricing ever changes.
export const VISHWAKARMA_PASS_PRICE_RUPEES = 100;
export const TOKENS_PER_RUPEE = 100;

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
  const n = Number(process.env.WELCOME_BONUS_TOKENS);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 250 * TOKENS_PER_RUPEE;
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

/** Tokens a vishwakarma order may credit, derived ONLY from the amount actually paid. Pure + tested. */
export function creditableVishwakarmaTokens(amountPaidRupees: unknown, buyPass: boolean): number {
  const paid = Number(amountPaidRupees);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  const tokenRupees = Math.max(0, paid - (buyPass ? VISHWAKARMA_PASS_PRICE_RUPEES : 0));
  return Math.round(tokenRupees * TOKENS_PER_RUPEE);
}

export interface WalletCreditTx {
  userId: string;
  amountPaid: number;
  balanceAdded: number;
  isVishwakarmaOrder?: boolean;
  buyPass?: boolean;
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
  const isVishwakarmaOrder = !!txData.isVishwakarmaOrder;
  const buyPass = !!txData.buyPass;
  const tokensToCredit = creditableVishwakarmaTokens(txData.amountPaid, buyPass);
  const amountPaid = n(txData.amountPaid);
  const balanceAdded = n(txData.balanceAdded);

  const update: Record<string, any> = {};
  let promoApplied = false;
  if (promo) {
    update.unlockedModes = [...(w.unlockedModes || []), promo.mode];
    update.hasVishwakarmaPass = true;
    update.vishwakarmaPassActivatedAt = now;
    update.tokenBalance = n(w.tokenBalance) + 1000; // 1000 promo tokens
    promoApplied = true;
  }

  if (isVishwakarmaOrder) {
    if (buyPass) {
      update.hasVishwakarmaPass = true;
      update.vishwakarmaPassActivatedAt = now;
    }
    if (!promoApplied) update.tokenBalance = n(w.tokenBalance) + tokensToCredit;
    update.totalTokensPurchased = n(w.totalTokensPurchased) + (promoApplied ? 1000 : tokensToCredit);
    update.totalMoneySpent = n(w.totalMoneySpent) + amountPaid;
    update.lastRechargeAt = now;
    const ledgerEntry = {
      type: 'purchase',
      amountCoinsOrTokens: promoApplied ? 1000 : tokensToCredit,
      moneySpent: amountPaid,
      timestamp: now,
      description: `Bought ${tokensToCredit.toLocaleString()} tokens${buyPass ? ` + Lifetime Pass Activated (₹${VISHWAKARMA_PASS_PRICE_RUPEES})` : ''}${promoApplied ? ' + Promo 1000 Tokens' : ''}`,
    };
    update.walletLedger = [...(w.walletLedger || []), ledgerEntry];
    update.remaining_balance = n(w.remaining_balance) + amountPaid;
    update.total_balance = n(w.total_balance) + amountPaid;
  } else {
    const tokensToCreditFallback = balanceAdded * 100;
    if (!promoApplied) update.tokenBalance = n(w.tokenBalance) + tokensToCreditFallback;
    update.totalTokensPurchased = n(w.totalTokensPurchased) + (promoApplied ? 10000 : tokensToCreditFallback);
    update.totalMoneySpent = n(w.totalMoneySpent) + amountPaid;
    update.lastRechargeAt = now;
    const ledgerEntry = {
      type: 'purchase',
      amountCoinsOrTokens: promoApplied ? 10000 : tokensToCreditFallback,
      moneySpent: amountPaid,
      timestamp: now,
      description: `Standard wallet recharge: ₹${amountPaid} (${tokensToCreditFallback.toLocaleString()} tokens added)${promoApplied ? ' + Promo 100₹ Tokens' : ''}`,
    };
    update.walletLedger = [...(w.walletLedger || []), ledgerEntry];
    update.remaining_balance = n(w.remaining_balance) + balanceAdded;
    update.total_balance = n(w.total_balance) + balanceAdded;
  }

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
        hasVishwakarmaPass: false,
        unlockedModes: [],
        vishwakarmaPassActivatedAt: null,
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
          tokenBalance: integratedWallet.tokenBalance,
          hasVishwakarmaPass: integratedWallet.hasVishwakarmaPass
        }
      };
    }

    return { success: false, error: 'Order not paid or invalid status' };
  } catch (err: any) {
    console.error('[CASHFREE] Internal verification failed:', err.message);
    return { success: false, error: err.message };
  }
}
