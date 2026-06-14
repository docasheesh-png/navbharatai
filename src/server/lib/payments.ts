import axios from 'axios';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getDb } from './db';
import { getSecretValue } from './secrets';

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

    if (isPlaceholder || txData.isSimulator || orderId.startsWith('sim_')) {
      console.log(`[CASHFREE SIMULATION] Marking order ${orderId} as paid inside verification simulator.`);
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
        isPaid = true;
        cfOrderIdRef = orderDetails.cf_order_id || 'cf_' + orderId;
      }
    }

    if (isPaid) {
      await updateDoc(txRef, {
        paymentStatus: 'SUCCESS',
        paymentReference: cfOrderIdRef
      });

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
      const tokensToCredit = (txData.tokenAmount || 0) * 100;

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
