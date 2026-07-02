import axios from 'axios';
import { doc, getDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { getDb } from './db';
import { getSecretValue } from './secrets';

// SECURITY (audit C4 — CRITICAL, financial): the vishwakarma order's paid amount is
// `tokenAmount₹ + (buyPass ? pass : 0)` (client: createVishwakarmaOrder in App.tsx). The credit path
// used to mint `client tokenAmount × 100` tokens — a value NEVER bound to what was actually paid — so
// a `{amount: 1, tokenAmount: 1_000_000}` order paid ₹1 and minted 100M tokens. We now DERIVE the
// creditable tokens from the VERIFIED paid amount instead: tokens = (paid − pass) × TOKENS_PER_RUPEE.
// (The standard, non-vishwakarma path already binds to paid ₹ via balanceAdded.) Pass price + rate must
// match the client's createVishwakarmaOrder; change both together if pricing ever changes.
export const VISHWAKARMA_PASS_PRICE_RUPEES = 100;
export const TOKENS_PER_RUPEE = 100;

/** Tokens a vishwakarma order may credit, derived ONLY from the amount actually paid. Pure + tested. */
export function creditableVishwakarmaTokens(amountPaidRupees: unknown, buyPass: boolean): number {
  const paid = Number(amountPaidRupees);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  const tokenRupees = Math.max(0, paid - (buyPass ? VISHWAKARMA_PASS_PRICE_RUPEES : 0));
  return Math.round(tokenRupees * TOKENS_PER_RUPEE);
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

      const walletRef = doc(db, 'user_token_wallets', txData.userId);
      const walletSnap = await getDoc(walletRef);

      let walletData = walletSnap.exists() ? walletSnap.data() : {
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
        updatedAt: new Date().toISOString()
      };

      let walletUpdate: any = {};
      const isVishwakarmaOrder = !!txData.isVishwakarmaOrder;
      const buyPass = !!txData.buyPass;
      // SECURITY (C4): derive from the VERIFIED paid amount, NOT the client-supplied txData.tokenAmount.
      const tokensToCredit = creditableVishwakarmaTokens(txData.amountPaid, buyPass);

      // PROMO HANDLING
      const promoSnap = await getDoc(doc(db, 'promo_redemptions', `promo_pending_${txData.userId}`));
      let promoApplied = false;
      if (promoSnap.exists() && promoSnap.data().status === 'PENDING') {
        const promoData = promoSnap.data();
        await updateDoc(doc(db, 'promo_redemptions', `promo_pending_${txData.userId}`), { status: 'USED' });
        walletUpdate.unlockedModes = [...(walletData.unlockedModes || []), promoData.mode];
        walletUpdate.hasVishwakarmaPass = true;
        walletUpdate.vishwakarmaPassActivatedAt = new Date().toISOString();
        walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + 1000; // 1000 tokens
        promoApplied = true;
      }

      if (isVishwakarmaOrder) {
        if (buyPass) {
          walletUpdate.hasVishwakarmaPass = true;
          walletUpdate.vishwakarmaPassActivatedAt = new Date().toISOString();
        }

        if (!promoApplied) {
            walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + tokensToCredit;
        }
        walletUpdate.totalTokensPurchased = (walletData.totalTokensPurchased || 0) + (promoApplied ? 1000 : tokensToCredit);
        walletUpdate.totalMoneySpent = (walletData.totalMoneySpent || 0) + txData.amountPaid;
        walletUpdate.lastRechargeAt = new Date().toISOString();

        const ledgerEntry = {
          type: 'purchase',
          amountCoinsOrTokens: promoApplied ? 1000 : tokensToCredit,
          moneySpent: txData.amountPaid,
          timestamp: new Date().toISOString(),
          description: `Bought ${tokensToCredit.toLocaleString()} tokens${buyPass ? ' + Lifetime Pass Activated (₹50)' : ''}${promoApplied ? ' + Promo 1000 Tokens' : ''}`
        };
        walletUpdate.walletLedger = [
          ...(walletData.walletLedger || []),
          ledgerEntry
        ];

        walletUpdate.remaining_balance = (walletData.remaining_balance || 0) + txData.amountPaid;
        walletUpdate.total_balance = (walletData.total_balance || 0) + txData.amountPaid;
      } else {
        const tokensToCreditFallback = txData.balanceAdded * 100;
        if (!promoApplied) {
            walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + tokensToCreditFallback;
        }
        walletUpdate.totalTokensPurchased = (walletData.totalTokensPurchased || 0) + (promoApplied ? 10000 : tokensToCreditFallback);
        walletUpdate.totalMoneySpent = (walletData.totalMoneySpent || 0) + txData.amountPaid;
        walletUpdate.lastRechargeAt = new Date().toISOString();

        const ledgerEntry = {
          type: 'purchase',
          amountCoinsOrTokens: promoApplied ? 10000 : tokensToCreditFallback,
          moneySpent: txData.amountPaid,
          timestamp: new Date().toISOString(),
          description: `Standard wallet recharge: ₹${txData.amountPaid} (${tokensToCreditFallback.toLocaleString()} tokens added)${promoApplied ? ' + Promo 100₹ Tokens' : ''}`
        };
        walletUpdate.walletLedger = [
          ...(walletData.walletLedger || []),
          ledgerEntry
        ];

        walletUpdate.remaining_balance = (walletData.remaining_balance || 0) + txData.balanceAdded;
        walletUpdate.total_balance = (walletData.total_balance || 0) + txData.balanceAdded;
      }

      walletUpdate.updatedAt = new Date().toISOString();
      const integratedWallet = { ...walletData, ...walletUpdate };
      await setDoc(walletRef, integratedWallet);

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
