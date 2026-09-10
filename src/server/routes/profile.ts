/**
 * User profile routes.
 *
 * GET  /api/profile          — fetch profile + wallet balance + monthly AI spend
 * PUT  /api/profile          — update display name / bio / phone / photo URL
 * PUT  /api/profile/budget   — set or clear the monthly spend budget (INR)
 * GET  /api/profile/history  — build history, filterable by period/date range
 *
 * All routes require a valid Firebase ID token (Bearer header).
 */
import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads user_token_wallets (owner-only).
import { doc, getDoc, getServerDb as getDb } from '../lib/serverDb';
import { verifyFirebaseToken, verifyFirebaseIdentity, deleteAuthAccount } from '../lib/authMiddleware';
import { getRetentionDb, deleteUserData } from '../lib/DataRetentionManager';
import { deleteUserWorkspaceData } from '../lib/workspaceDataErase';
import { sendSafeError } from '../lib/httpError';
import { userProfileStore } from '../lib/UserProfileStore';
import { userBuildHistoryStore, type BuildHistoryQuery } from '../lib/UserBuildHistoryStore';
import { userCostStore } from '../lib/UserCostStore';
import { buildCostAlertReport } from '../lib/CostAlertEngine';
import { usdToInr } from '../lib/UsdInrRate';

export function registerProfileRoutes(app: Express): void {
  // ── GET /api/profile ──────────────────────────────────────────────────────────
  app.get('/api/profile', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const [profile, walletSnap, monthlyUsage] = await Promise.all([
      userProfileStore.get(userId),
      fetchWallet(userId),
      userCostStore.get(userId),
    ]);

    return res.json({
      profile: profile ?? {
        userId,
        displayName: '',
        bio: '',
        phone: '',
        photoUrl: '',
        budgetLimitInr: 0,
        updatedAt: 0,
        createdAt: 0,
      },
      wallet: walletSnap
        ? {
            remainingBalance: walletSnap.remaining_balance ?? 0,
            totalBalance: walletSnap.total_balance ?? 0,
            tokenBalance: walletSnap.tokenBalance ?? 0,
            lastRechargeAt: walletSnap.lastRechargeAt ?? null,
          }
        : null,
      monthlyAiSpend: monthlyUsage ?? {
        month: new Date().toISOString().slice(0, 7),
        totalBuilds: 0,
        totalCostUsd: 0,
        updatedAt: 0,
      },
    });
  });

  // ── PUT /api/profile ──────────────────────────────────────────────────────────
  app.put('/api/profile', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const { displayName, bio, phone, photoUrl } = req.body ?? {};
    const update: Record<string, string> = {};
    if (typeof displayName === 'string') update.displayName = displayName.trim().slice(0, 80);
    if (typeof bio === 'string') update.bio = bio.trim().slice(0, 300);
    if (typeof phone === 'string') update.phone = phone.trim().slice(0, 20);
    if (typeof photoUrl === 'string') update.photoUrl = photoUrl.trim().slice(0, 500);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    await userProfileStore.update(userId, update);
    return res.json({ ok: true });
  });

  // ── PUT /api/profile/budget ───────────────────────────────────────────────────
  app.put('/api/profile/budget', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const { budgetLimitInr } = req.body ?? {};
    if (typeof budgetLimitInr !== 'number' || budgetLimitInr < 0) {
      return res.status(400).json({ error: 'budgetLimitInr must be a non-negative number.' });
    }

    await userProfileStore.update(userId, { budgetLimitInr });
    return res.json({ ok: true, budgetLimitInr });
  });

  // ── GET /api/profile/cost-alerts ──────────────────────────────────────────────
  // U-5 — real month-to-date spend vs the user's own monthly budget → approaching/exceeded alerts.
  // Identity from the verified token (own data only); spend converted USD→INR at the canonical rate.
  app.get('/api/profile/cost-alerts', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const [profile, monthlyUsage] = await Promise.all([
      userProfileStore.get(userId),
      userCostStore.get(userId),
    ]);
    const spendInr = usdToInr(monthlyUsage?.totalCostUsd ?? 0);
    const budgetInr = profile?.budgetLimitInr ?? 0;
    return res.json({
      ...buildCostAlertReport(spendInr, budgetInr),
      month: monthlyUsage?.month ?? new Date().toISOString().slice(0, 7),
    });
  });

  // ── GET /api/profile/history ──────────────────────────────────────────────────
  app.get('/api/profile/history', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const period = (req.query.period as string) || 'month';
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    const opts: BuildHistoryQuery = { limit: 200 };
    if (period === 'week' || period === 'month') {
      opts.period = period;
    } else if (period === 'custom' && from && to) {
      opts.period = 'custom';
      opts.from = from;
      opts.to = to;
    } else {
      opts.period = 'month';
    }

    const [records, summary] = await Promise.all([
      userBuildHistoryStore.list(userId, opts),
      userBuildHistoryStore.getSummary(userId, opts),
    ]);

    return res.json({ records, summary });
  });

  // ── DELETE /api/profile — right-to-be-forgotten (P-DATA.4) ──────────────────────
  // Erase ALL of this user's data across every verified user-scoped collection. Identity is taken from
  // the VERIFIED Firebase token (never a body param), so a user can only ever delete their OWN data.
  // An explicit `{ "confirm": "DELETE" }` body is required so it can never fire by accident.
  app.delete('/api/profile', async (req: Request, res: Response) => {
    const identity = await verifyFirebaseIdentity(req);
    if (!identity) return res.status(401).json({ error: 'Unauthorized' });
    if ((req.body?.confirm) !== 'DELETE') {
      return res.status(400).json({
        error: 'Confirmation required',
        hint: 'Send { "confirm": "DELETE" } to permanently erase all your data. This cannot be undone.',
      });
    }
    const db = getRetentionDb();
    if (!db) return res.status(503).json({ error: 'Data store unavailable — please try again shortly.' });
    try {
      // DATA FIRST, THEN THE CREDENTIAL. Erasing the sign-in first would strand any data whose
      // deletion then failed, with the owner unable to sign in and retry.
      const report = await deleteUserData(db, identity.uid);
      // …AND THE APPS THEY BUILT. `deleteUserData` covers the platform's own user records and says so
      // in its header ("not generated apps"); PROGRESS.md carried the rest as an OPEN root cause twice.
      // Without this a user could delete their account and leave every app they ever built sitting in
      // our Firestore. Best-effort like the cascade above: a failure is reported, never thrown, so it
      // can never block the account deletion the user actually asked for.
      const apps = await deleteUserWorkspaceData(identity.uid)
        .catch((e) => ({ uid: identity.uid, collections: [], totalDeleted: 0, error: e instanceof Error ? e.message : String(e) }));
      // Deleting the documents is not deleting the ACCOUNT: without this the Auth record survives and
      // the person who asked to be deleted can sign back in to a blank account. That is not what the
      // button says, and not what Play's deletion requirement means.
      const account = await deleteAuthAccount(identity.uid);
      const accountDeleted = account === 'deleted' || account === 'not-found';
      return res.json({
        ok: true,
        // Say which of the two actually happened rather than one cheerful sentence for both. A user
        // whose sign-in survived needs to know to email us, not to be told everything is gone.
        message: accountDeleted
          ? 'Your account and all of its data have been permanently deleted.'
          : 'Your data has been permanently erased, but your sign-in could not be removed automatically. Please email info@navbharatai.com so we can finish it.',
        accountDeleted,
        account,
        ...report,
        // Reported SEPARATELY rather than folded into the totals above: these are the user's built
        // apps, and someone checking whether their work is really gone should be able to see that line
        // on its own. `refusal` appears only in the one case the eraser declines to guess at (see
        // planWorkspaceErase) — surfaced, never swallowed.
        apps,
      });
    } catch (err: any) {
      return sendSafeError(res, 500, 'Deletion failed. Please try again.', err, 'account deletion');
    }
  });
}

async function fetchWallet(userId: string): Promise<any | null> {
  const db = getDb() as any;
  if (!db || !userId) return null;
  try {
    const snap = await getDoc(doc(db, 'user_token_wallets', userId));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}
