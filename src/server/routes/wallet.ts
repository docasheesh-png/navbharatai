import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (security-rules-bypassing) — see serverDb.ts. Reads/writes user_token_wallets,
// which navbharat-prod's rules restrict to the owner (server is unauthenticated → was denied).
import { doc, getDoc, setDoc, runTransaction, collection, query, where, orderBy, limit, getDocs, getServerDb as getDb } from '../lib/serverDb';
import { buildEmptyWallet } from '../lib/newWallet';
import { requireUserMatch } from '../lib/authMiddleware';
import { appLockBlocks } from '../lib/appLockEnforce';
import { TOKENS_PER_RUPEE } from '../lib/payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from '../lib/walletResolve';
import { readHostingPlanStatus, purchaseHostingPlan, setHostingPlanAutoRenew } from '../lib/hostingPlan';
import { readHostingAddons, purchaseHostingAddon, removeHostingAddon } from '../lib/hostingAddonLedger';
import { HOSTING_TIERS } from '../../lib/hostingTiers';
import { publishedAppCapForTier, liveAppCount } from '../lib/HostingQuota';
import { deploymentStore } from '../AgentV3/DeploymentStore';
import { firebaseDomainLinksForUser } from '../lib/firebaseDomainLink';
import { registerHostingPlanSweep, reattachSuspendedDomains } from '../lib/hostingPlanSweep';
import { sendSafeError } from '../lib/httpError';
import { userSafeUsageLog } from '../lib/usageLogPublic';
import { buildWalletStatement, ledgerPatch } from '../lib/walletStatement';
import { routeParam, routeParams } from '../lib/expressCompat';

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
  // Hosting-plan lifecycle sweep (reminders / auto-renew / lapse enforcement) — periodic, idempotent,
  // no-op under VITEST. Registered here because the wallet IS the plan's home.
  registerHostingPlanSweep();

  // SECURITY (audit): require the verified token uid to match :userId — these expose balance, PII
  // (email/name), usage logs and payment history; without the check any uid could be read. Client
  // sends the Bearer token via authedHeaders(); VITEST skips the check.
  app.get('/api/wallet/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId: rawUserId } = routeParams(req.params);
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

        if (data.tokenBalance === undefined) { data.tokenBalance = 0; updated = true; }
        if (data.totalTokensPurchased === undefined) { data.totalTokensPurchased = 0; updated = true; }
        if (data.totalTokensUsed === undefined) { data.totalTokensUsed = 0; updated = true; }
        if (data.walletLedger === undefined) { data.walletLedger = []; updated = true; }

        if (updated) {
          await setDoc(walletRef, data, { merge: true });
        }

        // Billing Phase 2 — the ₹↔token rate travels WITH the wallet (single source of truth:
        // payments.ts TOKENS_PER_RUPEE), so no client ever hardcodes its own conversion again.
        return res.json({ ...data, tokensPerRupee: TOKENS_PER_RUPEE });
      } else {
        // The wallet doc is missing → create it, EMPTY. Nothing is granted for opening a wallet
        // (admin 2026-09-26: "100*4 ko chor ke sab hata do") — the referral ladder is the only way
        // new money is given, and it pays through its own route. A transaction so that two
        // concurrent first reads return the SAME wallet instead of one overwriting the other.
        const nowIso = new Date().toISOString();
        const createdWallet = await runTransaction(db, async (tx) => {
          const wSnap = await tx.get(walletRef);
          if (wSnap.exists()) return wSnap.data(); // created concurrently — never overwrite
          const initialWallet = buildEmptyWallet({ userId, email, name, nowIso });
          tx.set(walletRef, initialWallet);
          return initialWallet;
        });
        return res.json({ ...createdWallet, tokensPerRupee: TOKENS_PER_RUPEE });
      }
    } catch (err: any) {
      console.error('[API WALLET GET ERROR]:', err);
      return sendSafeError(res, 500, 'Unable to load your wallet right now. Please try again.', err, 'wallet get');
    }
  });

  // ---------- Hosting plans (two tiers — admin 2026-09-10: "do tier banao") ----------
  // The plan lives ON the wallet doc; purchase debits the SAME wallet in the SAME transaction.
  // Lazy auto-renewal happens inside the status read (readHostingPlanStatus), so no cron exists.
  // The catalogue (prices, limits, agreement text) is src/lib/hostingTiers.ts — shared with the UI.

  app.get('/api/wallet/:userId/hosting-plan', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const status = await readHostingPlanStatus(getDb() as any, routeParam(req.params.userId));
      return res.json(status);
    } catch (err: any) {
      return sendSafeError(res, 500, 'Unable to load your plan right now. Please try again.', err, 'hosting plan status');
    }
  });

  app.post('/api/wallet/:userId/hosting-plan/purchase', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      // 🔒 APP LOCK (admin 2026-09-13). Checked BEFORE anything is charged, so a refusal costs the user
      // nothing but a PIN entry. Invisible to everyone who has not set a PIN or locked this area.
      const blocked = await appLockBlocks(req, routeParam(req.params.userId), 'hosting-plan-purchase');
      if (blocked) return res.status(blocked.status).json(blocked.body);
      // The tier and the agreement tick come from the body. `agreedToTerms` is checked SERVER-side
      // (computePlanPurchase refuses without it) rather than trusted to a disabled button: a purchase
      // whose terms were never accepted must be impossible, not merely awkward to reach.
      //
      // An ABSENT tier defaults to Starter so an older client that has not learned about tiers still
      // buys something real. It cannot silently buy the expensive one.
      const tierId = typeof req.body?.tierId === 'string' ? req.body.tierId : undefined;
      const agreedToTerms = req.body?.agreedToTerms === true;
      // The renewal choice is now made ON the purchase screen. ABSENT means "not sent" — an older
      // client keeps today's behaviour (renew on) rather than being silently switched to one-off.
      const autoRenew = typeof req.body?.autoRenew === 'boolean' ? req.body.autoRenew : undefined;
      const result = await purchaseHostingPlan(
        getDb() as any, routeParam(req.params.userId), undefined, tierId ?? HOSTING_TIERS[0].id,
        { agreedToTerms, ...(autoRenew === undefined ? {} : { autoRenew }) },
      );
      if (!result.ok) {
        // insufficient → 402 (recharge first); a missing tick or an unbuyable tier is the caller's
        // request being wrong → 400; disabled/unavailable → 503. Nothing was charged on any path.
        // `gift_only` is 402 alongside `insufficient`: in both the answer is "add money", and the
        // body carries the honest reason so the screen can say which of the two it was.
        const status = (result.reason === 'insufficient' || result.reason === 'gift_only') ? 402
          : (result.reason === 'agreement_required' || result.reason === 'unknown_tier') ? 400
          : 503;
        return res.status(status).json(result);
      }
      // Renewal undoes a lapse: any domain paused for the lapsed plan reconnects automatically.
      // Best-effort and non-blocking — the purchase result never waits on hosting calls.
      void reattachSuspendedDomains(routeParam(req.params.userId));
      return res.json(result);
    } catch (err: any) {
      return sendSafeError(res, 500, 'Could not complete the purchase — nothing was charged. Please try again.', err, 'hosting plan purchase');
    }
  });

  app.post('/api/wallet/:userId/hosting-plan/auto-renew', requireUserMatch('userId'), async (req: Request, res: Response) => {
    // 🔒 APP LOCK. Auto-renew decides whether this account is charged AGAIN, so it is guarded alongside
    // the purchase itself — switching it on is a commitment, and switching it off is one a thief would
    // never make but an argument over a shared phone might.
    const blockedRenew = await appLockBlocks(req, routeParam(req.params.userId), 'hosting-plan-auto-renew');
    if (blockedRenew) return res.status(blockedRenew.status).json(blockedRenew.body);
    const autoRenew = req.body?.autoRenew;
    if (typeof autoRenew !== 'boolean') {
      return res.status(400).json({ error: 'autoRenew must be true or false.' });
    }
    const ok = await setHostingPlanAutoRenew(getDb() as any, routeParam(req.params.userId), autoRenew);
    if (!ok) return res.status(404).json({ error: 'No hosting plan found on this account yet.' });
    return res.json({ ok: true, autoRenew });
  });

  // ---------- Hosting add-ons (one thing at a time, 2026-10-09) ----------
  // A sellable add-on is delivered in the same transaction as the debit. Anything we cannot
  // actually hand over is refused here and never charged. Removal refunds unused days only
  // after the slot is no longer in use.

  app.get('/api/wallet/:userId/hosting-addons', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const menu = await readHostingAddons(getDb() as any, routeParam(req.params.userId));
      return res.json(menu);
    } catch (err: any) {
      return sendSafeError(res, 500, 'Unable to load add-ons right now.', err, 'hosting addons');
    }
  });

  app.post('/api/wallet/:userId/hosting-addons/purchase', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const blocked = await appLockBlocks(req, routeParam(req.params.userId), 'hosting-addon-purchase');
      if (blocked) return res.status(blocked.status).json(blocked.body);
      const result = await purchaseHostingAddon(
        getDb() as any,
        routeParam(req.params.userId),
        typeof req.body?.addonId === 'string' ? req.body.addonId : '',
        { agreedToTerms: req.body?.agreedToTerms === true, clientRef: req.body?.clientRef },
      );
      if (!result.ok) {
        const status = (result.reason === 'insufficient' || result.reason === 'gift_only') ? 402
          : (result.reason === 'not_available' || result.reason === 'disabled') ? 503
          : 400;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (err: any) {
      return sendSafeError(res, 500, 'Could not add that — nothing was charged. Please try again.', err, 'hosting addon purchase');
    }
  });

  app.post('/api/wallet/:userId/hosting-addons/remove', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const blocked = await appLockBlocks(req, routeParam(req.params.userId), 'hosting-addon-remove');
      if (blocked) return res.status(blocked.status).json(blocked.body);
      const userId = routeParam(req.params.userId);
      const ref = typeof req.body?.ref === 'string' ? req.body.ref : '';
      const menu = await readHostingAddons(getDb() as any, userId);
      const row = menu.active.find((a) => a.ref === ref);
      if (!row) return res.status(404).json({ ok: false, error: 'That add-on was not found. Nothing was changed.' });
      // A server or a database is not a slot. Refunding here would return the money while the
      // Cloud Run service or the Supabase project kept running. Stop it from Publish, which
      // deletes it first and only then returns unused days.
      if (row.addonId === 'server' || row.addonId === 'dedicated_db') {
        return res.status(409).json({
          ok: false,
          reason: 'still_in_use',
          error: row.addonId === 'server'
            ? 'A server is stopped from Publish, not from this list. It is taken down first; only then are unused days returned. Nothing was refunded.'
            : 'A database is removed from Publish, not from this list. It is deleted first; only then are unused days returned. Nothing was refunded.',
        });
      }
      const status = await readHostingPlanStatus(getDb() as any, userId);
      let base = 0;
      let inUse = 0;
      if (row.addonId === 'extra_site') {
        const records = await deploymentStore.listByUser(userId, 500).catch(() => null);
        if (!records) {
          return res.status(503).json({ ok: false, error: 'Could not check your live websites, so this was left in place. Nothing was refunded.' });
        }
        base = publishedAppCapForTier(status.tier);
        inUse = liveAppCount(records);
      } else if (row.addonId === 'extra_domain') {
        const links = await firebaseDomainLinksForUser(userId).catch(() => null);
        if (!links) {
          return res.status(503).json({ ok: false, error: 'Could not check your domains, so this was left in place. Nothing was refunded.' });
        }
        base = status.tier?.domains ?? 0;
        inUse = links.filter((l) => !l.suspended).length;
      }
      const result = await removeHostingAddon(getDb() as any, userId, ref, base, inUse);
      if (!result.ok) {
        const http = result.reason === 'still_in_use' ? 409 : result.reason === 'not_found' ? 404 : 503;
        return res.status(http).json(result);
      }
      return res.json(result);
    } catch (err: any) {
      return sendSafeError(res, 500, 'Could not remove that. It is still active and nothing was refunded.', err, 'hosting addon remove');
    }
  });

  /**
   * THE STATEMENT — every credit and every debit, with a running balance, reconciled against the
   * wallet's own figure (admin 2026-09-15: *"ek ek paise ka sahi sahi hisab"*).
   *
   * 🔒 IT REPORTS, IT NEVER CORRECTS. If the entries do not add up to the balance it says so, in
   * rupees, rather than quietly adjusting either number — a reconciler that made its own arithmetic
   * work would be the most dangerous route in this file. And an account whose oldest rows rolled off
   * before opening balances were recorded is reported as UNKNOWN, never as a mismatch: that is
   * missing history, not a discrepancy, and crying wolf on every old account is how a real one gets
   * ignored.
   */
  app.get('/api/wallet/:userId/statement', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const userId = await canonicalWalletId(db, routeParam(req.params.userId));
      const snap = await getDoc(doc(db, 'user_token_wallets', userId));
      if (!snap.exists()) {
        // An account with no wallet has never been credited or charged. Saying so beats an empty
        // statement that looks like a wallet whose history was lost.
        return res.json({ ok: true, exists: false, rows: [], verdict: 'balanced', notes: [] });
      }
      const statement = buildWalletStatement(snap.data() as Record<string, unknown>);
      return res.json({ ok: true, exists: true, ...statement });
    } catch (e) {
      return sendSafeError(res, 500, 'Could not build your statement.', e, 'wallet:statement');
    }
  });

  app.get('/api/wallet/:userId/logs', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = routeParams(req.params);
    try {
      const logsRef = collection(db, 'ai_usage_logs');
      const q = query(logsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      // WHITE-LABEL LAW, AT THE ROUTE (2026-09-14). These documents carry `providerName` and
      // `modelName`, and this handler used to spread the WHOLE document into the response — so a
      // user's own browser received the vendor and model id of every call, whatever the UI chose to
      // render. "No admin-only diagnostic may ever be surfaced to an end user" is about what LEAVES
      // the server, not about what a component happens to paint.
      const logs = snap.docs.map(d => userSafeUsageLog(d.id, d.data()));
      return res.json(logs);
    } catch (err: any) {
      try {
        const logsRef = collection(db, 'ai_usage_logs');
        const q = query(logsRef, where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        // The SAME redaction on the index-missing fallback. A guard applied to only one of two paths
        // is a guard that leaks on exactly the day the primary query fails, which is the day nobody
        // is looking at the shape of the response.
        const logs = snap.docs.map(d => userSafeUsageLog(d.id, d.data()));
        logs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(logs);
      } catch (fallbackErr: any) {
        return sendSafeError(res, 500, 'Unable to load your usage logs right now. Please try again.', fallbackErr, 'wallet logs');
      }
    }
  });

  app.get('/api/wallet/:userId/transactions', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = routeParams(req.params);
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
