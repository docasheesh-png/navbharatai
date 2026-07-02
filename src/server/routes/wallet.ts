import type { Express, Request, Response } from 'express';
import { doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { requireUserMatch } from '../lib/authMiddleware';

/**
 * Wallet / token-balance read routes extracted from the server.ts monolith
 * (Phase 1). Behavior is unchanged — the shared Firestore handle is read via
 * getDb() instead of the server-scope `db` closure.
 *
 * - GET /api/wallet/:userId               — fetch or lazily create a wallet
 * - GET /api/wallet/:userId/logs          — recent AI usage logs
 * - GET /api/wallet/:userId/transactions  — recent payment transactions
 */
export function registerWalletRoutes(app: Express): void {
  // SECURITY (audit): require the verified token uid to match :userId — these expose balance, PII
  // (email/name), usage logs and payment history; without the check any uid could be read. Client
  // sends the Bearer token via authedHeaders(); VITEST skips the check.
  app.get('/api/wallet/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    const email = req.query.email as string || '';
    const name = req.query.name as string || '';

    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      const snap = await getDoc(walletRef);
      if (snap.exists()) {
        const data = snap.data();
        let updated = false;

        if (data.hasVishwakarmaPass === undefined) { data.hasVishwakarmaPass = false; updated = true; }
        if (data.tokenBalance === undefined) { data.tokenBalance = 0; updated = true; }
        if (data.totalTokensPurchased === undefined) { data.totalTokensPurchased = 0; updated = true; }
        if (data.totalTokensUsed === undefined) { data.totalTokensUsed = 0; updated = true; }
        if (data.walletLedger === undefined) { data.walletLedger = []; updated = true; }

        if (updated) {
          await setDoc(walletRef, data, { merge: true });
        }
        return res.json(data);
      } else {
        const welcomeBalance = 10.00;
        const welcomeTokens = 1000; // ₹10 = 1000 tokens
        const initialWallet = {
          userId,
          userEmail: email,
          userName: name,
          total_balance: welcomeBalance,
          remaining_balance: welcomeBalance,
          total_output_tokens_used: 0,
          total_money_spent: 0,
          hasVishwakarmaPass: false,
          vishwakarmaPassActivatedAt: null,
          tokenBalance: welcomeTokens,
          totalTokensPurchased: welcomeTokens,
          totalTokensUsed: 0,
          lastRechargeAt: null,
          walletLedger: [
            {
              type: 'purchase',
              amountCoinsOrTokens: welcomeTokens,
              moneySpent: 0,
              timestamp: new Date().toISOString(),
              description: 'Welcome Bonus: 1,000 AI Tokens Credited!'
            }
          ],
          updatedAt: new Date().toISOString()
        };
        await setDoc(walletRef, initialWallet);

        // Add welcome bonus transaction to transaction list
        const welcomeTxRef = doc(db, 'payment_transactions', `welcome_${userId}`);
        await setDoc(welcomeTxRef, {
          transactionId: `welcome_${userId}`,
          userId,
          amountPaid: 0,
          balanceAdded: welcomeBalance,
          paymentProvider: 'WELCOME_BONUS',
          paymentStatus: 'SUCCESS',
          paymentReference: 'WELCOME_BONUS',
          createdAt: new Date().toISOString()
        });

        return res.json(initialWallet);
      }
    } catch (err: any) {
      console.error('[API WALLET GET ERROR]:', err);
      return res.status(500).json({ error: err.message || 'Unknown internal wallet error' });
    }
  });

  app.get('/api/wallet/:userId/logs', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    try {
      const logsRef = collection(db, 'ai_usage_logs');
      const q = query(logsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json(logs);
    } catch (err: any) {
      try {
        const logsRef = collection(db, 'ai_usage_logs');
        const q = query(logsRef, where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        logs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(logs);
      } catch (fallbackErr: any) {
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
  });

  app.get('/api/wallet/:userId/transactions', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    try {
      const txRef = collection(db, 'payment_transactions');
      const q = query(txRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json(txs);
    } catch (err: any) {
      try {
        const txRef = collection(db, 'payment_transactions');
        const q = query(txRef, where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        txs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(txs);
      } catch (fallbackErr: any) {
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
  });
}
