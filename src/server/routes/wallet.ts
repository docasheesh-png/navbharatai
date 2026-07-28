import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Reads/writes user_token_wallets,
// which navbharat-prod's rules restrict to the owner (server is unauthenticated → was denied).
import { doc, getDoc, setDoc, runTransaction, collection, query, where, orderBy, limit, getDocs, getServerDb as getDb } from '../lib/serverDb';
import { welcomeGrantTokens, buildInitialWallet } from '../lib/welcomeBonus';
import { requireUserMatch } from '../lib/authMiddleware';
import { TOKENS_PER_RUPEE, welcomeBonusTokens } from '../lib/payments';
import { decideWeeklyTopUp, topUpLedgerEntry, summarizeGiftLadder } from '../lib/weeklyTopUp';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from '../lib/walletResolve';
import { sendSafeError } from '../lib/httpError';

/** Resolve a login uid to its canonical wallet id (follows `mergedInto`). No-op unless
 *  WALLET_MERGE_RESOLVE=on, so a merged/retired account transparently reads its unified wallet. */
async function canonicalWalletId(db: any, uid: string): Promise<string> {
  if (!walletMergeResolveEnabled()) return uid;
  return resolveCanonicalWalletId(async (u) => {
    const s = await getDoc(doc(db, 'user_token_wallets', u));
    return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
  }, uid);
}

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
    const { userId: rawUserId } = req.params;
    const email = req.query.email as string || '';
    const name = req.query.name as string || '';

    try {
      // One-wallet: if this login's account was merged into another, read the CANONICAL wallet so the
      // user sees their ONE unified balance however they signed in. No-op unless WALLET_MERGE_RESOLVE=on.
      const userId = await canonicalWalletId(db, rawUserId);
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

        // THE FREE GIFT LADDER (admin 2026-07-28): ₹250 at signup → +₹200 → +₹200 → cut off for good.
        // Applied LAZILY right here on the wallet read, against the SERVER clock — no cron, no fan-out
        // over every account, and a dormant account accrues nothing until it comes back.
        //
        // `freeGiftedTokens` is what bounds it: the TOTAL ever gifted, never the balance. A balance cap
        // would quietly become an unlimited weekly stipend the moment the user spent anything.
        // Wallets created before this field existed are seeded from the signup bonus they received.
        try {
          const giftedSoFar = Number.isFinite(Number(data.freeGiftedTokens))
            ? Number(data.freeGiftedTokens)
            : welcomeBonusTokens();
          const decision = decideWeeklyTopUp({
            giftedSoFar,
            lastTopUpAt: data.lastWeeklyTopUpAt ?? null,
            createdAt: data.createdAt ?? null,
            now: Date.now(),
          });
          if (decision.newLastTopUpAt) {
            const nowIso = decision.newLastTopUpAt;
            const applied = await runTransaction(db, async (tx) => {
              const fresh = await tx.get(walletRef);
              if (!fresh.exists()) return null;
              const w = fresh.data();
              // Re-decide on the IN-TRANSACTION balance: a concurrent debit may have changed how much
              // room is left under the cap since the read above.
              const given2 = Number.isFinite(Number(w.freeGiftedTokens))
                ? Number(w.freeGiftedTokens)
                : welcomeBonusTokens();
              const d2 = decideWeeklyTopUp({
                giftedSoFar: given2,
                lastTopUpAt: w.lastWeeklyTopUpAt ?? null,
                createdAt: w.createdAt ?? null,
                now: Date.now(),
              });
              if (!d2.newLastTopUpAt) return null; // already applied, or the ladder is finished
              const patch: Record<string, unknown> = { lastWeeklyTopUpAt: d2.newLastTopUpAt, updatedAt: nowIso };
              if (d2.grantTokens > 0) {
                const held = Number(w.tokenBalance) > 0 ? Number(w.tokenBalance) : 0;
                patch.tokenBalance = held + d2.grantTokens;
                patch.totalTokensPurchased = (Number(w.totalTokensPurchased) || 0) + d2.grantTokens;
                // The running total that ENDS the ladder. Written in the same transaction as the credit,
                // so a grant can never land without being counted against the lifetime cap.
                patch.freeGiftedTokens = given2 + d2.grantTokens;
                const creditInr = d2.grantTokens / TOKENS_PER_RUPEE;
                patch.remaining_balance = (Number(w.remaining_balance) || 0) + creditInr;
                patch.total_balance = (Number(w.total_balance) || 0) + creditInr;
                patch.walletLedger = [...(w.walletLedger || []), topUpLedgerEntry(d2.grantTokens, d2.newLastTopUpAt)];
              }
              tx.update(walletRef, patch);
              return patch;
            });
            if (applied) Object.assign(data, applied);
          }
        } catch (topUpErr) {
          // A top-up failure must never cost the user their wallet screen — log it and serve the
          // balance we already have. The next read tries again.
          console.error('[WALLET] Weekly top-up failed (balance served unchanged):', topUpErr);
        }
        // Billing Phase 2 — the ₹↔token rate travels WITH the wallet (single source of truth:
        // payments.ts TOKENS_PER_RUPEE), so no client ever hardcodes its own conversion again.
        //
        // `freeGift` travels with it too (2026-07-28): the grant used to be invisible — credit simply
        // appeared and nothing said where it came from, how much was left, or when the next one lands.
        // It is derived from the SAME inputs the grant uses, so the screen can never disagree with the
        // ledger. It is also the moment that matters commercially: "this was your last free credit" is
        // when someone decides to recharge.
        return res.json({
          ...data,
          tokensPerRupee: TOKENS_PER_RUPEE,
          freeGift: summarizeGiftLadder({
            giftedSoFar: Number.isFinite(Number(data.freeGiftedTokens)) ? Number(data.freeGiftedTokens) : welcomeBonusTokens(),
            lastTopUpAt: data.lastWeeklyTopUpAt ?? null,
            createdAt: data.createdAt ?? null,
            now: Date.now(),
          }),
        });
      } else {
        // The wallet doc is missing → (re)create it. MONEY-BLEED FIX (admin 2026-07-12): grant the
        // welcome bonus (₹250 since 2026-07-28) ONLY if this user has NEVER received it, guarded by the DURABLE welcome-bonus marker
        // (`payment_transactions/welcome_${userId}`) which lives in a SEPARATE collection and so SURVIVES any
        // wallet-doc recreation. The old code granted the bonus purely because the wallet doc was absent, so a
        // re-created wallet re-minted 50k every logout→login — an infinite free-token farm. Done in a
        // transaction so two concurrent first-time reads can't double-grant, and so a wallet created
        // concurrently is returned instead of overwritten.
        const welcomeMarkerRef = doc(db, 'payment_transactions', `welcome_${userId}`);
        const nowIso = new Date().toISOString();
        const createdWallet = await runTransaction(db, async (tx) => {
          const wSnap = await tx.get(walletRef);
          if (wSnap.exists()) return wSnap.data(); // created concurrently — never overwrite, never re-grant
          const markerSnap = await tx.get(welcomeMarkerRef);
          const alreadyGranted = markerSnap.exists();
          const welcomeTokens = welcomeGrantTokens(alreadyGranted);
          const initialWallet = buildInitialWallet({ userId, email, name, welcomeTokens, nowIso });
          tx.set(walletRef, initialWallet);
          // Only stamp the durable grant marker on a REAL grant (first time). A 0-token recreation must not
          // write it (there was nothing to grant), and if it already exists we leave it untouched.
          if (!alreadyGranted && welcomeTokens > 0) {
            tx.set(welcomeMarkerRef, {
              transactionId: `welcome_${userId}`,
              userId,
              amountPaid: 0,
              balanceAdded: welcomeTokens / TOKENS_PER_RUPEE,
              paymentProvider: 'WELCOME_BONUS',
              paymentStatus: 'SUCCESS',
              paymentReference: 'WELCOME_BONUS',
              createdAt: nowIso,
            });
          }
          return initialWallet;
        });

        // The rate + the gift-ladder state travel WITH the wallet on the new-wallet path too.
        return res.json({
          ...createdWallet,
          tokensPerRupee: TOKENS_PER_RUPEE,
          freeGift: summarizeGiftLadder({
            giftedSoFar: Number((createdWallet as Record<string, unknown>).freeGiftedTokens) || 0,
            lastTopUpAt: (createdWallet as Record<string, unknown>).lastWeeklyTopUpAt as string ?? null,
            createdAt: (createdWallet as Record<string, unknown>).createdAt as string ?? null,
            now: Date.now(),
          }),
        });
      }
    } catch (err: any) {
      console.error('[API WALLET GET ERROR]:', err);
      return sendSafeError(res, 500, 'Unable to load your wallet right now. Please try again.', err, 'wallet get');
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
        return sendSafeError(res, 500, 'Unable to load your usage logs right now. Please try again.', fallbackErr, 'wallet logs');
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
        return sendSafeError(res, 500, 'Unable to load your transactions right now. Please try again.', fallbackErr, 'wallet transactions');
      }
    }
  });
}
