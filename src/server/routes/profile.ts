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
import { doc, getDoc } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { userProfileStore } from '../lib/UserProfileStore';
import { userBuildHistoryStore, type BuildHistoryQuery } from '../lib/UserBuildHistoryStore';
import { userCostStore } from '../lib/UserCostStore';

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
