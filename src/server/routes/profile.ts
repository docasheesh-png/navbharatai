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
import { verifyFirebaseToken, verifyFirebaseIdentity, deleteAuthAccount, rateLimiter } from '../lib/authMiddleware';
import { getRetentionDb, deleteUserData } from '../lib/DataRetentionManager';
import { deleteUserDerivedIdData } from '../lib/derivedIdErase';
import { deleteUserWorkspaceData } from '../lib/workspaceDataErase';
import { eraseSyncedWorkspace, type SyncEraseFirestore } from '../lib/syncWorkspaceErase';
import { sendSafeError } from '../lib/httpError';
import { userProfileStore } from '../lib/UserProfileStore';
import { userBuildHistoryStore, type BuildHistoryQuery } from '../lib/UserBuildHistoryStore';
import { userCostStore } from '../lib/UserCostStore';
import { buildCostAlertReport } from '../lib/CostAlertEngine';
import { usdToInr } from '../lib/UsdInrRate';
import { adultPreferenceFrom, ADULT_CONFIRMATIONS } from '../../lib/adultContent';
import { audit } from '../lib/audit';
import { scanProfanity } from '../lib/pollinationsGuard';
import { publicCreatorId, forgetCreator } from '../lib/storeCreator';
import { forgetPerson } from '../lib/appMartSocialStore';
import {
  parseAvatarUpload, checkAvatar, saveAvatar, deleteAvatar, avatarUrl, AvatarStoreUnavailable,
} from '../lib/profileAvatar';

/**
 * A name or bio other people will read (App Mart profiles, comments, likers) — the same word list the
 * comments use (admin 2026-10-01: the App Mart profile is now editable in place). PURE.
 */
export function profileTextAbuse(fields: { displayName?: unknown; bio?: unknown }): string | null {
  for (const v of [fields.displayName, fields.bio]) {
    if (typeof v === 'string' && v.trim() && !scanProfanity(v).ok) {
      return 'Your name or bio has a word that is not allowed on a public profile. Please change it and save again.';
    }
  }
  return null;
}

/** A name or photo changed: the next App Mart read of this person must be fresh, on this server at least. */
function forgetPublicProfile(uid: string): void {
  try { forgetPerson(uid); forgetCreator(uid); } catch { /* best-effort */ }
}

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
      // The +18 setting, normalised — the client never has to interpret a missing field, and an
      // unreadable value arrives as OFF rather than as something the screen has to guess about.
      adult: adultPreferenceFrom({ optedIn: profile?.adultOptIn, optedInAt: profile?.adultOptInAt }),
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
    const abuse = profileTextAbuse(update);
    if (abuse) return res.status(400).json({ error: abuse });

    await userProfileStore.update(userId, update);
    forgetPublicProfile(userId);
    return res.json({ ok: true });
  });

  // ── PUT /api/profile/budget ───────────────────────────────────────────────────
  // ── POST/DELETE /api/profile/photo ────────────────────────────────────────────
  // An uploaded profile photo (profileAvatar.ts): checked by its real bytes, checked for nudity before
  // it is saved (a check that cannot run refuses), stored under the public creator code and served by
  // GET /api/app-mart/avatar/:creatorId. Rate-limited because every upload costs a vision call.
  const photoLimiter = rateLimiter({ name: 'profile-photo', authed: 20, anon: 5, noun: 'photo uploads' });
  app.post('/api/profile/photo', photoLimiter, async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const parsed = parseAvatarUpload((req.body ?? {}).dataUrl);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const verdict = await checkAvatar(parsed.mime, parsed.bytes);
    if (verdict === 'unsafe') {
      return res.status(400).json({ error: 'This photo cannot be used on a public profile. Please choose a different one.' });
    }
    if (verdict !== 'safe') {
      return res.status(503).json({ error: 'The photo could not be checked right now, so it was not saved. Please try again in a moment.' });
    }
    try {
      const creatorId = publicCreatorId(userId);
      const version = await saveAvatar(creatorId, userId, parsed.mime, parsed.bytes);
      const photoUrl = avatarUrl(creatorId, version);
      await userProfileStore.update(userId, { photoUrl });
      forgetPublicProfile(userId);
      return res.json({ ok: true, photoUrl });
    } catch (e) {
      if (e instanceof AvatarStoreUnavailable) return res.status(503).json({ error: 'The photo could not be saved right now. Please try again.' });
      return sendSafeError(res, 500, 'The photo could not be saved. Please try again.', e);
    }
  });

  app.delete('/api/profile/photo', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    try {
      await deleteAvatar(publicCreatorId(userId)).catch((e) => { if (!(e instanceof AvatarStoreUnavailable)) throw e; });
      await userProfileStore.update(userId, { photoUrl: '' });
      forgetPublicProfile(userId);
      return res.json({ ok: true });
    } catch (e) {
      return sendSafeError(res, 500, 'The photo could not be removed. Please try again.', e);
    }
  });

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

  /**
   * PUT /api/profile/adult — the +18 setting.
   *
   * ITS OWN ROUTE, not a field on PUT /api/profile, and that is deliberate: this one is a recorded
   * CONSENT, not a preference. It demands an explicit confirmation, it is audited, and it stamps the
   * date. Folding it in with display-name edits would mean a client that sends the whole profile
   * back could flip it as a side effect of saving a bio.
   *
   * 🔒 It does not unlock anything unlawful, and cannot: the gate
   * (src/lib/adultContent.ts) checks the content CLASS before this preference, so every
   * always-refused category ignores it entirely. See that file for why the line is enforced there
   * rather than described here.
   */
  app.put('/api/profile/adult', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const optedIn = req.body?.optedIn === true;
    // Turning it ON requires the tick; turning it OFF never does — withdrawing consent must always
    // be easier than giving it.
    if (optedIn && req.body?.confirmed !== true) {
      return res.status(400).json({ error: 'Please confirm you are 18 or older and have read what this allows.', confirmations: ADULT_CONFIRMATIONS });
    }
    const at = optedIn ? new Date().toISOString() : '';
    await userProfileStore.update(userId, { adultOptIn: optedIn, adultOptInAt: at });
    audit(optedIn ? 'ADULT_CONTENT_OPT_IN' : 'ADULT_CONTENT_OPT_OUT', { userId, ip: req.ip });
    return res.json({ ok: true, adult: adultPreferenceFrom({ optedIn, optedInAt: at }) });
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
      // DERIVED IDS FIRST OF ALL — BEFORE ANYTHING THAT DELETES THE KEYS THEY ARE DERIVED FROM.
      // `derivedIdErase` reaches documents whose id is BUILT from a key rather than equal to one:
      // `bot_sessions/{botId}_{chatId}` (from the user's `bots`) and `build_history/{sessionId}` (from
      // `user_build_history` and the workspace id range). The two erasers below delete exactly those
      // parents, so running this second would resolve no keys, delete nothing, and report success —
      // the "an erase that LOOKS complete and is not" failure the apps eraser was written to prevent.
      // Best-effort like the rest: reported, never thrown, so it can never block the deletion the user
      // actually asked for.
      const derived = await deleteUserDerivedIdData(identity.uid)
        .catch((e) => ({ uid: identity.uid, collections: [], totalDeleted: 0, keys: { bots: 0, historySessions: 0 }, error: e instanceof Error ? e.message : String(e) }));
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
      // …AND THE SYNCED WORKSPACE (Q-763). `user_workspaces/{uid}` is only a MANIFEST; the person's
      // chat sessions and last built app live in `user_workspaces/{uid}__c{i}`. It was in no erase
      // path at all, and registering it with the retention manager would have deleted the manifest
      // and kept the chunks — an erase that reports success and leaves the data unreachable. Its own
      // module deletes the chunks FIRST and the manifest LAST, so a partial failure can be retried.
      // Best-effort like the two above: reported, never thrown, so it cannot block the deletion.
      const syncDb = getDb() as unknown as SyncEraseFirestore | null;
      const synced = syncDb
        ? await eraseSyncedWorkspace(syncDb, identity.uid)
          .catch((e) => ({ uid: identity.uid, chunks: 0, manifestDeleted: false, probed: 0, error: e instanceof Error ? e.message : String(e) }))
        : { uid: identity.uid, chunks: 0, manifestDeleted: false, probed: 0, error: 'data store unavailable' };
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
        // Likewise its own line: the cross-device workspace, which is neither a platform record nor a
        // built app. `probed` says how many chunk ids were swept, so the number is checkable rather
        // than a bare claim.
        synced,
        // Its own line too, for the same reason as `apps` and `synced`: these are documents no key
        // could previously reach, so someone checking whether their data is really gone should be able
        // to see that they were swept. `keys` says how many derived ids were resolved, so the counts
        // are checkable rather than a bare claim.
        derived,
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
