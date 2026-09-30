// THE REFERRAL ROUTES — where the four earned steps become real money.
//
// The rules live in `referralRewards.ts` (pure, tested), the device proof in `deviceIntegrity.ts`.
// This file is the part that touches the store and the wallet, and it exists to get ONE thing right
// that neither of those can: **the payment and the record of it are a single atomic write.**
//
// 🔴 WHY THAT IS THE WHOLE JOB. Every decision in referralRewards.ts is idempotent only if the
// caller reads `alreadyPaidSteps` and writes both the credit and the new step inside one
// transaction. Pay first and record after, and a retried request — a flaky mobile network, a user
// tapping twice, an app resumed from the background — pays twice. This repo has already paid for
// exactly that shape once: the 2026-09-12 money audit found the store-purchase receipt check
// sitting OUTSIDE its transaction, where two concurrent deliveries of one purchase could both pass.
//
// 🔒 AND THE DEVICE CHECK RUNS BEFORE THE TRANSACTION, NOT INSIDE IT. It is a network call to
// Google; holding a Firestore transaction open across it would make every contended write wait on a
// third party. It is safe outside because the transaction re-reads the paid steps regardless — the
// device proves WHO is asking, the transaction decides WHETHER anything is owed.
//
// 🔒 EVERY ROUTE IS OWNERSHIP-CHECKED (`requireUserMatch`), because every one of them either spends
// or reveals somebody's money.

import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  doc, getDoc, setDoc, runTransaction, getServerDb as getDb,
  collection, getDocs, query, where, limit,
} from '../lib/serverDb';
import { requireUserMatch, resolveAccountContact } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';
import { routeParam } from '../lib/expressCompat';
import { TOKENS_PER_RUPEE } from '../lib/payments';
import { mirroredCreditPatch } from '../lib/walletMirror';
import { MAX_WEB_GIFT_TOKENS } from '../lib/giftPolicy';
import { recordClaimOutcome, deviceRefusalCategory, phoneCheckFailureCategory } from '../lib/referralClaimOutcomes';
import { ledgerPatch } from '../lib/walletStatement';
import { mintReferralCode, normalizeReferralCode, referralShareMessage } from '../lib/referralCode';
import { checkDeviceIntegrity, deviceRefusalMessage, type DeviceCheck } from '../lib/deviceIntegrity';
import {
  decideSelfReward, decideReferrerReward, decideAttribution, attributionRefusalMessage,
  selfProgress, readSteps, referralRewardsEnabled, referrerLifetimeCapTokens,
  stepIsProven, stepNotDoneMessage, githubIsLinked, friendVerificationStatus,
  ALL_STEPS, WEB_ELIGIBLE_STEPS, canStillRedeem, stepAllowedOnWeb, webHoldUntilMobile, type RewardStep, type StepProof,
} from '../lib/referralRewards';
import {
  accountCreatedAt, codeWindow, countAppOpen, readAppOpenState, type CodeWindow,
} from '../lib/referralCodeWindow';

/** One person's referral record. Absent until they first open the screen or redeem a code. */
interface ReferralDoc {
  code?: string;
  /** Who referred THIS user, if anyone. Immutable once set. */
  referrerUserId?: string | null;
  /** Steps this user has been PAID for. The idempotency key for their own ₹400. */
  paidSteps?: unknown;
  /** Steps of THIS user that their referrer has already been paid for. */
  referrerPaidSteps?: unknown;
  /** Tokens this user has EVER earned as a referrer. The ₹1,500 cap is measured against it. */
  earnedTokens?: unknown;
  /** Tokens this user has been paid THROUGH THE WEBSITE. The ₹200 web sub-cap is measured against it. */
  webGiftedTokens?: unknown;
  /** Devices this user has been seen on — the device-level self-referral check reads it. */
  deviceIds?: unknown;
  createdAt?: string;
  /** Set once, by /redeem, the moment a referrer's code was applied. Sorts the Earning list. */
  referredAt?: unknown;
  /** App opens counted for the referral-code window (`referralCodeWindow.ts`). */
  appOpens?: unknown;
  /** When the last COUNTED app open began. */
  lastAppOpenAt?: unknown;
}

const REFERRALS = 'user_referrals';
const CODES = 'referral_codes';
/** One device, one gift, ever. The marker that makes a factory reset the only way round it. */
const DEVICES = 'referral_devices';

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Get this user's code, minting one on first use.
 *
 * ⚠️ A COLLISION IS RETRIED, NOT IGNORED. `setDoc` would happily overwrite the code document of
 * whoever owned that string first, silently transferring their referrals to somebody else. The
 * create-only write is what makes the store, not this function, the authority on uniqueness.
 */
async function ensureCode(db: any, userId: string): Promise<string> {
  const ref = doc(db, REFERRALS, userId);
  const snap = await getDoc(ref);
  const existing = (snap.exists() ? (snap.data() as ReferralDoc) : null)?.code;
  if (existing) return existing;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = mintReferralCode((n) => new Uint8Array(randomBytes(n)));
    try {
      // create() fails if the document exists, which is exactly the uniqueness guarantee wanted.
      await (doc(db, CODES, code) as any).create({ userId, createdAt: new Date().toISOString() });
    } catch {
      continue; // taken — mint another
    }
    await setDoc(ref, { code, createdAt: new Date().toISOString() }, { merge: true });
    return code;
  }
  // 309 million codes and eight collisions is not chance; it is the store misbehaving. Better to
  // fail honestly than to return a code the user cannot actually be found by.
  throw new Error('could not mint a unique referral code');
}

/** Read a referral doc as a plain shape, with every field defaulted. */
async function readReferral(db: any, userId: string): Promise<ReferralDoc> {
  const snap = await getDoc(doc(db, REFERRALS, userId));
  return snap.exists() ? (snap.data() as ReferralDoc) : {};
}

/**
 * Prove the caller is on a genuine Android device.
 *
 * Returns the check so the caller can distinguish `unavailable` (our setup, our problem) from
 * `not-verified` (this device does not qualify) — they pay the same ₹0 but they are not the same
 * event, and telling a user their account is fine matters when the fault is ours.
 */
async function proveDevice(req: Request): Promise<DeviceCheck> {
  const body = (req.body || {}) as { deviceId?: unknown; integrityToken?: unknown };
  return checkDeviceIntegrity({
    integrityToken: String(body.integrityToken ?? ''),
    deviceId: body.deviceId,
  });
}

/** The platform the request claims to be from — only ever used to REFUSE, never to permit. */
function claimedPlatform(req: Request): string {
  return String((req.body as { platform?: unknown } | undefined)?.platform ?? '').trim().toLowerCase();
}

/**
 * Pay this account every WEBSITE-ELIGIBLE step it has done and not been paid for — signup ₹50, login
 * ₹50, mobile ₹100 — under the web rules: no device check, the ₹200 web ceiling and the ₹400 lifetime
 * ceiling. ONE transaction reconciles all three, so a repeat call pays ₹0 and a concurrent one cannot
 * pay twice: every granted step is recorded in the same write as the credit.
 *
 * 🔗 TWO CALLERS, one implementation: the website's claim (`/claim` with `platform: 'web'`) and the
 * sign-in settle (`/api/payment/reconcile`), which every NavBharatAI client already calls on sign-in —
 * including app builds too old to carry a working device check. That second caller is what makes these
 * three steps independent of recognising the phone at all: they are paid the same on both surfaces, so
 * nothing about them needs the device.
 *
 * 🔗 Pays the REFERRER too (admin 2026-09-26: *"website par jo user hai woh refer kar sakta hai, usko
 * refer token milne chahiye — wahi maximum 1500 ke"*). `decideReferrerReward` is mobile-anchored and
 * ₹1,500-capped, so a web verification pays the referrer exactly as a device-verified one does. Separate
 * transaction, so it can never roll back the friend's own credit.
 */
export async function settleWebReferralSteps(db: any, userId: string, opts: {
  /**
   * Settle only these steps. The sign-in settle passes the DAY-ONE steps (signup, login): paying the
   * mobile there would make a brand-new app user "old" a moment before the referral code they typed
   * on the sign-in screen is applied (`canStillRedeem`), and the app's own claim already waits for
   * that code. Omitted ⇒ every web-eligible step.
   */
  only?: readonly RewardStep[];
} = {}): Promise<{
  granted: number;
  phoneVerified: boolean;
}> {
  if (!referralRewardsEnabled() || !userId) return { granted: 0, phoneVerified: false };
  const selfRef = doc(db, REFERRALS, userId);
  const steps = WEB_ELIGIBLE_STEPS.filter((s) => !opts.only || opts.only.includes(s));

  // Cheap exit before the account lookup: an account already paid these steps has nothing to settle,
  // and the sign-in settle runs on every app open.
  const before = await readReferral(db, userId);
  if (steps.every((s) => readSteps(before.paidSteps).includes(s))) {
    return { granted: 0, phoneVerified: readSteps(before.paidSteps).includes('mobile') };
  }

  const contact = await resolveAccountContact(userId);
  const proof: StepProof = {
    hasIdentity: Boolean(contact.email) || Boolean(contact.phone),
    emailVerified: contact.emailVerified && Boolean(contact.email),
    phoneVerified: Boolean(contact.phone),
    githubLinked: githubIsLinked(contact.providers),
    hasReferrer: false, // the referral code is Android-only; it is never earned on the web
  };
  const nowIso = new Date().toISOString();
  const walletRef = doc(db, 'user_token_wallets', userId);

  const result = await runTransaction(db, async (tx: any) => {
    const [refSnap, walletSnap] = await Promise.all([tx.get(selfRef), tx.get(walletRef)]);
    const rec = (refSnap.exists() ? refSnap.data() : {}) as ReferralDoc;
    const wallet = (walletSnap.exists() ? walletSnap.data() : {}) as Record<string, unknown>;

    // Fold the running totals forward across the steps so each decision sees what the previous one in
    // this same loop already granted — the ₹400 lifetime cap and the ₹200 web cap stay honest.
    let paidSteps = readSteps(rec.paidSteps);
    let webGifted = num(rec.webGiftedTokens);
    let lifetimeGifted = num(wallet.freeGiftedTokens);
    let totalGranted = 0;

    for (const s of steps) {
      if (paidSteps.includes(s) || !stepIsProven(s, proof)) continue;
      const reward = decideSelfReward({
        step: s,
        alreadyPaidSteps: paidSteps,
        deviceVerified: false,
        platform: 'web',
        alreadyGiftedTokens: lifetimeGifted,
        alreadyWebGiftedTokens: webGifted,
        mobileVerified: proof.phoneVerified,
      });
      if (reward.tokens <= 0 || !reward.recordStep) continue;
      totalGranted += reward.tokens;
      paidSteps = [...paidSteps, reward.recordStep];
      webGifted += reward.tokens;
      lifetimeGifted += reward.tokens;
    }

    if (totalGranted <= 0) return { granted: 0, referrerUserId: rec.referrerUserId ?? null };

    // ONE combined credit + ledger row + updated markers, atomically — the same idempotency guarantee
    // the Android path relies on: the credit and the record of what earned it are a single write.
    const patch = mirroredCreditPatch(wallet, totalGranted, 'gift');
    const rupees = totalGranted / TOKENS_PER_RUPEE;
    tx.set(walletRef, {
      ...patch,
      freeGiftedTokens: num(wallet.freeGiftedTokens) + totalGranted,
      totalTokensPurchased: num(wallet.totalTokensPurchased) + totalGranted,
      ...ledgerPatch(wallet, {
        type: 'purchase',
        amountCoinsOrTokens: totalGranted,
        moneySpent: 0,
        timestamp: nowIso,
        description: `Free credit: ₹${rupees.toLocaleString('en-IN')} credited`,
      }),
      updatedAt: nowIso,
    }, { merge: true });
    tx.set(selfRef, { paidSteps, webGiftedTokens: webGifted, updatedAt: nowIso }, { merge: true });
    return { granted: totalGranted, referrerUserId: rec.referrerUserId ?? null };
  });

  // The referrer's half — separate transaction, separate user, never able to undo the credit above.
  if (result.granted > 0 && result.referrerUserId) {
    await payReferrer(db, String(result.referrerUserId), userId, nowIso)
      .catch(() => { /* re-offered on this friend's next step; never breaks the claimer's reply */ });
  }
  return { granted: result.granted, phoneVerified: proof.phoneVerified };
}

/** A WEBSITE claim: settle the web-eligible steps and answer the screen. */
async function claimWeb(db: any, userId: string, res: Response, surface: 'web' | 'android' = 'web'): Promise<Response> {
  const result = await settleWebReferralSteps(db, userId);

  // Counted, never awaited: a refused or empty claim used to leave no trace at all (see referralClaimOutcomes.ts).
  void recordClaimOutcome(userId, surface,
    result.granted > 0 ? 'paid' : (!result.phoneVerified && webHoldUntilMobile() ? 'held-no-mobile' : 'nothing-new'),
    { tokens: result.granted, reason: surface === 'android' ? 'device-fallback' : undefined });

  const grantedRupees = result.granted / TOKENS_PER_RUPEE;
  return res.json({
    ok: result.granted > 0,
    granted: result.granted,
    rupees: grantedRupees,
    message: result.granted > 0
      ? `₹${grantedRupees.toLocaleString('en-IN')} added to your wallet.`
      : (result.phoneVerified
          ? 'Nothing new to claim right now.'
          : 'Verify your mobile number to earn ₹100 more.'),
  });
}

/**
 * The referral-code window for this account (`referralCodeWindow.ts`), counting this request as an app
 * open when it is one.
 *
 * WHY THE STATUS READ IS THE "APP OPEN". Every app build that has the rewards screen — including the
 * builds already installed on phones — asks for this status as the app starts, so counting here makes the
 * rule hold for every installed app the moment the server ships, with no new app build needed. The App
 * screen, the Profile and the Wallet all ask at start-up; the 30-minute rule is what folds those into one
 * open, and the transaction is what stops two of them racing into two.
 *
 * Nothing is counted — and nothing written — once it can no longer matter: a code already applied, an
 * account that is no longer new, or a window already shut.
 */
async function referralCodeWindowFor(db: any, userId: string, rec: ReferralDoc, opts: {
  createdAt: string | null | undefined;
  countOpen: boolean;
  nowMs: number;
}): Promise<CodeWindow> {
  const createdAt = accountCreatedAt(opts.createdAt, typeof rec.createdAt === 'string' ? rec.createdAt : null);
  const before = codeWindow({ appOpens: readAppOpenState(rec).appOpens, accountCreatedAt: createdAt, nowMs: opts.nowMs });
  const relevant = !rec.referrerUserId && canStillRedeem(rec.paidSteps) && before.open;
  if (!opts.countOpen || !relevant) return before;
  const ref = doc(db, REFERRALS, userId);
  const appOpens = await runTransaction(db, async (tx: any) => {
    const snap = await tx.get(ref);
    const live = readAppOpenState((snap.exists() ? snap.data() : {}) as ReferralDoc);
    const { next, counted } = countAppOpen(live, opts.nowMs);
    if (counted) tx.set(ref, { appOpens: next.appOpens, lastAppOpenAt: next.lastAppOpenAt }, { merge: true });
    return next.appOpens;
  });
  return codeWindow({ appOpens, accountCreatedAt: createdAt, nowMs: opts.nowMs });
}

export function registerReferralRoutes(app: Express): void {
  /**
   * The user's own referral state: their code, what they have claimed, what is still pending, and
   * what they have earned. Safe to call anywhere — it pays nothing, so it needs no device proof.
   */
  app.get('/api/referral/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      if (!referralRewardsEnabled()) {
        return res.json({ ok: true, enabled: false, code: null, steps: [], earnedTokens: 0 });
      }
      const db = getDb() as any;
      const userId = routeParam(req.params.userId);
      const code = await ensureCode(db, userId);
      const [rec, contact] = await Promise.all([readReferral(db, userId), resolveAccountContact(userId)]);
      const earned = num(rec.earnedTokens);
      // 📱 WHICH SURFACE IS ASKING. The website earns signup, login and mobile (₹200 max), the app earns
      // all five — so each is shown only the steps it can actually complete. Client-declared, and it can only
      // ever NARROW what is shown: the claim route re-decides everything server-side regardless.
      const platform = String(req.query?.platform ?? '').trim().toLowerCase() === 'web' ? 'web' : 'android';
      // The referral-code window: three app opens or seven days (admin 2026-09-30). Only the app counts
      // opens — the website cannot apply a code at all, so a visit there must not spend a chance.
      const codeWin = await referralCodeWindowFor(db, userId, rec, {
        createdAt: contact.createdAt,
        countOpen: platform === 'android',
        nowMs: Date.now(),
      });
      // "Refer — only for new user": the code step is offered while the account can still redeem, and
      // kept (✅ or claimable) once a code has been applied. Otherwise it would be a row nobody can finish.
      const canRedeem = platform === 'android' && !rec.referrerUserId && canStillRedeem(rec.paidSteps) && codeWin.open;
      // "Missed": the app, no code applied, and the account can no longer apply one. Shown as ❌ only to a
      // client that says it can draw it (`missed=1`); an app build from before this change would render an
      // unknown row as money still waiting, so it keeps the old behaviour of not showing the row at all.
      const showsMissed = String(req.query?.missed ?? '') === '1';
      const codeMissed = platform === 'android' && !rec.referrerUserId && !canRedeem;
      const visibleSteps = selfProgress(rec.paidSteps).filter((s) => {
        if (platform === 'web') return stepAllowedOnWeb(s.step);
        if (s.step === 'referral-code') return s.claimed || Boolean(rec.referrerUserId) || canRedeem || (codeMissed && showsMissed);
        return true;
      });
      return res.json({
        ok: true,
        enabled: true,
        platform,
        canRedeem,
        // How many more app opens may still apply a code — only while it can; null otherwise.
        codeOpensLeft: canRedeem && codeWin.open ? codeWin.opensLeft : null,
        webCapRupees: platform === 'web' ? MAX_WEB_GIFT_TOKENS / TOKENS_PER_RUPEE : null,
        webEarnedRupees: num(rec.webGiftedTokens) / TOKENS_PER_RUPEE,
        code,
        // What the account has ACTUALLY done. The screen uses it to say what is missing instead of
        // offering a Claim button that the proof gate would refuse — a button that cannot work is
        // the half-built state the second absolute rule forbids.
        emailVerified: contact.emailVerified && Boolean(contact.email),
        phoneVerified: Boolean(contact.phone),
        githubLinked: githubIsLinked(contact.providers),
        shareMessage: referralShareMessage(code),
        steps: visibleSteps.map((s) => ({
          step: s.step,
          claimed: s.claimed,
          rupees: s.tokens / TOKENS_PER_RUPEE,
          missed: s.step === 'referral-code' && !s.claimed && codeMissed,
        })),
        referred: Boolean(rec.referrerUserId),
        earnedTokens: earned,
        earnedRupees: earned / TOKENS_PER_RUPEE,
        capRupees: referrerLifetimeCapTokens() / TOKENS_PER_RUPEE,
        capReached: earned >= referrerLifetimeCapTokens(),
      });
    } catch (e) {
      return sendSafeError(res, 500, 'Could not read your referral status.', e, 'referral:status');
    }
  });

  /**
   * The "Earning" list: everyone who has used THIS user's referral code, and how far each has got.
   *
   * 🔒 READ-ONLY AND MONEY-FREE. Unlike /claim and /redeem this moves no wallet and needs no device
   * proof — it only ANSWERS a question the referrer is allowed to ask about their own code. Each
   * friend's step count comes from `friendVerificationStatus(paidSteps)`, the exact signal
   * `decideReferrerReward` already pays the referrer from — so a friend showing "2 of 3" here can
   * never disagree with the ₹ that friend has actually earned the referrer.
   *
   * Bounded the same way the admin's own referral summary is (`referralAdminSummary.ts`): the
   * ₹1,500 lifetime cap already bounds a real referrer to roughly twenty friends, so MAX exists only
   * against a runaway query, never because genuine usage approaches it.
   */
  app.get('/api/referral/:userId/referred', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      if (!referralRewardsEnabled()) {
        return res.json({ ok: true, enabled: false, count: 0, friends: [] });
      }
      const db = getDb() as any;
      const userId = routeParam(req.params.userId);
      const MAX = 500;
      const snap = await getDocs(
        query(collection(db, REFERRALS) as any, where('referrerUserId', '==', userId), limit(MAX)) as any,
      );
      const rows = (snap.docs || []).map((d: any) => ({ userId: String(d.id), ...(d.data() || {}) })) as
        (ReferralDoc & { userId: string })[];

      const friends = await Promise.all(rows.map(async (row) => {
        const contact = await resolveAccountContact(row.userId);
        const status = friendVerificationStatus(row.paidSteps);
        return {
          email: contact.email,
          // Named to match the SAME fields the /api/referral/:userId status route already uses
          // (emailVerified / phoneVerified / githubLinked) — one vocabulary for the same three facts,
          // never `email: true/false` beside `email: "a@b.com"` on the same object.
          emailVerified: status.email,
          phoneVerified: status.mobile,
          githubLinked: status.github,
          completedCount: status.completedCount,
          referredAt: typeof row.referredAt === 'string' ? row.referredAt : null,
        };
      }));

      // Most recently referred first — a returning referrer checks on the friend they just invited.
      friends.sort((a, b) => (b.referredAt || '').localeCompare(a.referredAt || ''));

      return res.json({ ok: true, enabled: true, count: friends.length, capped: rows.length >= MAX, friends });
    } catch (e) {
      return sendSafeError(res, 500, 'Could not read who has used your referral code.', e, 'referral:referred');
    }
  });

  /**
   * Redeem somebody's code. Attribution only — it pays NOTHING on its own, by design: the referrer
   * earns from verifications, never from a redemption, which is what stops a chain (rule 2).
   *
   * The new user's own ₹100 for this step is claimed through /claim like the other three, so there
   * is exactly one payment path and one idempotency rule rather than two that must agree.
   */
  app.post('/api/referral/:userId/redeem', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      if (!referralRewardsEnabled()) {
        return res.json({ ok: false, message: attributionRefusalMessage('disabled') });
      }
      const db = getDb() as any;
      const userId = routeParam(req.params.userId);
      const code = normalizeReferralCode((req.body as { code?: unknown } | undefined)?.code);
      if (!code) return res.status(400).json({ ok: false, message: attributionRefusalMessage('unknown-code') });

      const device = await proveDevice(req);
      if (device.verdict !== 'verified') {
        return res.status(403).json({ ok: false, message: deviceRefusalMessage(device.verdict) });
      }
      const deviceId = device.deviceId as string;

      const ownerSnap = await getDoc(doc(db, CODES, code));
      const ownerId = ownerSnap.exists() ? String((ownerSnap.data() as { userId?: unknown })?.userId ?? '') : '';

      const [mine, owner, deviceMarker, contact] = await Promise.all([
        readReferral(db, userId),
        ownerId ? readReferral(db, ownerId) : Promise.resolve({} as ReferralDoc),
        getDoc(doc(db, DEVICES, deviceId)),
        resolveAccountContact(userId),
      ]);
      // Applying a code is not an app open, so nothing is counted here — only read.
      const codeWin = await referralCodeWindowFor(db, userId, mine, {
        createdAt: contact.createdAt, countOpen: false, nowMs: Date.now(),
      });

      const verdict = decideAttribution({
        codeOwnerUserId: ownerId || null,
        newUserId: userId,
        deviceId,
        referrerDeviceIds: asStringArray(owner.deviceIds),
        alreadyReferred: Boolean(mine.referrerUserId),
        // A device that has already been ATTRIBUTED to someone. Not the same as having been seen:
        // the owner's own handset is caught by the self-referral check above.
        deviceAlreadyReferred: deviceMarker.exists()
          && String((deviceMarker.data() as { referredUserId?: unknown })?.referredUserId ?? '') !== userId,
        // "old ko never": an account that already earned a REAL verification predates the referral and
        // cannot be retro-attributed. The automatic Gmail-login grant does not count — see canStillRedeem.
        isNewUser: canStillRedeem(mine.paidSteps),
        // Three app opens or seven days (admin 2026-09-30) — see referralCodeWindow.ts.
        codeWindowOpen: codeWin.open,
        platform: claimedPlatform(req) || 'android',
      });
      if (!verdict.ok) return res.status(409).json({ ok: false, message: attributionRefusalMessage(verdict.reason) });

      const nowIso = new Date().toISOString();
      await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(doc(db, REFERRALS, userId));
        const live = (snap.exists() ? snap.data() : {}) as ReferralDoc;
        // Re-checked in-transaction: two redemptions racing must not both attach a referrer.
        if (live.referrerUserId) return;
        tx.set(doc(db, REFERRALS, userId), { referrerUserId: ownerId, referredAt: nowIso }, { merge: true });
        tx.set(doc(db, DEVICES, deviceId), { referredUserId: userId, at: nowIso }, { merge: true });
      });

      return res.json({ ok: true, message: 'Referral code applied. Complete the steps to claim your credit.' });
    } catch (e) {
      return sendSafeError(res, 500, 'Could not apply that referral code.', e, 'referral:redeem');
    }
  });

  /**
   * Claim one step. This is the only route that moves money.
   *
   * Order: prove the device → pay the user (atomically, once) → reconcile what their referrer is
   * owed (atomically, once). The referrer's half is deliberately a SECOND transaction: it touches a
   * different user's documents, and a failure there must never roll back a payment the claimer has
   * already earned. A referrer payment that does not land is re-offered on the friend's next step,
   * because `decideReferrerReward` reconciles over state rather than reacting to an event.
   */
  app.post('/api/referral/:userId/claim', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      if (!referralRewardsEnabled()) {
        return res.json({ ok: false, granted: 0, message: 'Referral rewards are not available right now.' });
      }
      const db = getDb() as any;
      const userId = routeParam(req.params.userId);
      const step = String((req.body as { step?: unknown } | undefined)?.step ?? '') as RewardStep;
      if (!ALL_STEPS.includes(step)) return res.status(400).json({ ok: false, granted: 0, message: 'Unknown step.' });

      // ── WEB PATH ──────────────────────────────────────────────────────────────────────────────
      // The website earns signup ₹50, login ₹50 and mobile ₹100 — at most ₹200 (admin 2026-09-27). There
      // is NO device check here — the web has none. `platform` is client-declared and can only ever
      // REFUSE the Android-only steps, never grant more: `decideSelfReward`'s web branch pays only the
      // web-eligible steps, so a caller who spoofs `platform:'web'` gets exactly what a web user gets
      // and nothing an Android device would unlock.
      //
      // 🔒 It RECONCILES every web step in ONE transaction (`settleWebReferralSteps`). Idempotent: a
      // repeat call pays ₹0 because every granted step is recorded in the same write as the credit.
      if (claimedPlatform(req) === 'web') {
        return await claimWeb(getDb() as any, routeParam(req.params.userId), res);
      }

      const device = await proveDevice(req);
      if (device.verdict !== 'verified') {
        // 🔒 The CLASS of refusal is kept, never the raw detail: `unavailable` is our setup, `not-verified`
        // is this phone — two different fixes, and before this they left the same trace (none).
        void recordClaimOutcome(userId, 'android',
          device.verdict === 'unavailable' ? 'device-unavailable' : 'device-refused',
          { reason: deviceRefusalCategory(device.detail) });
        // 📱 A PHONE WE COULD NOT RECOGNISE STILL EARNS WHAT THE WEBSITE EARNS (admin 2026-09-27:
        // "mobile recognition 100% fix karna hai"). Signup, login and mobile pay the same on both
        // surfaces, so for them the device check proves nothing the web rules do not already ask —
        // and any caller could get exactly this by sending `platform: 'web'`. Only the referral code
        // and GitHub, which the website never pays, still need the device.
        if (stepAllowedOnWeb(step)) return await claimWeb(db, userId, res, 'android');
        return res.status(403).json({ ok: false, granted: 0, message: deviceRefusalMessage(device.verdict) });
      }
      const deviceId = device.deviceId as string;

      // 🔴 IS THE STEP ACTUALLY DONE? Asked of FIREBASE and of our own store, never of the request
      // body. Without this the device check alone would let any caller on a real Android phone POST
      // all four steps and collect ₹400 having verified nothing — a claim is a request, not a fact.
      const contact = await resolveAccountContact(userId);
      const existing = await readReferral(db, userId);
      const proof: StepProof = {
        hasIdentity: Boolean(contact.email) || Boolean(contact.phone),
        emailVerified: contact.emailVerified && Boolean(contact.email),
        phoneVerified: Boolean(contact.phone),
        githubLinked: githubIsLinked(contact.providers),
        hasReferrer: Boolean(existing.referrerUserId),
      };
      if (!stepIsProven(step, proof)) {
        void recordClaimOutcome(userId, 'android', 'step-not-done', { reason: step });
        return res.status(409).json({ ok: false, granted: 0, message: stepNotDoneMessage(step) });
      }

      const nowIso = new Date().toISOString();
      const selfRef = doc(db, REFERRALS, userId);
      const walletRef = doc(db, 'user_token_wallets', userId);

      const paid = await runTransaction(db, async (tx: any) => {
        const [refSnap, walletSnap] = await Promise.all([tx.get(selfRef), tx.get(walletRef)]);
        const rec = (refSnap.exists() ? refSnap.data() : {}) as ReferralDoc;

        // 🔒 THE DECISION IS MADE INSIDE THE TRANSACTION, against the live list. A decision taken
        // outside is a decision about a world that may have changed — which is the whole bug class.
        const reward = decideSelfReward({
          step,
          alreadyPaidSteps: rec.paidSteps,
          deviceVerified: true,
          platform: 'android',
          // 🔒 The account's REAL lifetime gift total, read in this same transaction — so the ₹400
          // ceiling is applied to what was actually received rather than to what the step list
          // implies. See giftPolicy.ts: "ek paisa jyada nahi" cannot rest on a tunable.
          alreadyGiftedTokens: (walletSnap.exists() ? walletSnap.data() : {})?.freeGiftedTokens,
        });
        if (reward.tokens <= 0 || !reward.recordStep) return { granted: 0, reason: reward.reason };

        // The referrer check again, INSIDE the transaction. `stepIsProven` above already asked it,
        // but that read happened before this transaction opened; only an in-transaction read is
        // safe against a redemption being undone in between. Cheap, and it is the one proof whose
        // source is our own store rather than Firebase.
        if (step === 'referral-code' && !rec.referrerUserId) return { granted: 0, reason: 'not-referred' as const };

        const wallet = (walletSnap.exists() ? walletSnap.data() : {}) as Record<string, unknown>;
        // A referral reward is money NavBharatAI hands over, so it is gift money: it obeys the plan
        // rule (a gift cannot buy a hosting plan) and it is spent before anything the user paid for.
        const patch = mirroredCreditPatch(wallet, reward.tokens, 'gift');
        const rupees = reward.tokens / TOKENS_PER_RUPEE;

        tx.set(walletRef, {
          ...patch,
          freeGiftedTokens: num(wallet.freeGiftedTokens) + reward.tokens,
          totalTokensPurchased: num(wallet.totalTokensPurchased) + reward.tokens,
          // 🔒 Through the shared appender — see walletStatement.ts. This credit is bounded like
          // every other ledger write, and whatever rolls off lands in the opening balance so the
          // user's statement still reconciles. Written directly, it would have been the eighth
          // instance of the very defect the statement work had just fixed.
          ...ledgerPatch(wallet, {
            type: 'purchase',
            amountCoinsOrTokens: reward.tokens,
            moneySpent: 0,
            timestamp: nowIso,
            description: `Referral bonus: ₹${rupees.toLocaleString('en-IN')} credited`,
          }),
          updatedAt: nowIso,
        }, { merge: true });

        // THE SAME WRITE records the step. This is the idempotency guarantee, and splitting these
        // two into separate writes is how a retry pays twice.
        tx.set(selfRef, {
          paidSteps: [...readSteps(rec.paidSteps), reward.recordStep],
          deviceIds: Array.from(new Set([...asStringArray(rec.deviceIds), deviceId])),
          updatedAt: nowIso,
        }, { merge: true });

        return { granted: reward.tokens, reason: reward.reason, referrerUserId: rec.referrerUserId ?? null };
      });

      // The referrer's half — separate transaction, separate user, never able to undo the above.
      if (paid.granted > 0 && (paid as { referrerUserId?: string | null }).referrerUserId) {
        await payReferrer(db, String((paid as { referrerUserId?: string | null }).referrerUserId), userId, nowIso)
          .catch(() => { /* re-offered on this friend's next step; never breaks the claimer's reply */ });
      }

      void recordClaimOutcome(userId, 'android', paid.granted > 0 ? 'paid' : 'nothing-new', {
        tokens: paid.granted,
        reason: paid.granted > 0 ? undefined : String(paid.reason ?? ''),
      });

      return res.json({
        ok: paid.granted > 0,
        granted: paid.granted,
        rupees: paid.granted / TOKENS_PER_RUPEE,
        reason: paid.reason,
      });
    } catch (e) {
      void recordClaimOutcome(routeParam(req.params.userId),
        claimedPlatform(req) === 'web' ? 'web' : 'android', 'error');
      return sendSafeError(res, 500, 'Could not claim that bonus.', e, 'referral:claim');
    }
  });

  /**
   * The phone could not even produce a device token, so the claim above was never sent. COUNTED, never
   * paid: this route moves no money and trusts nothing but "this signed-in user says it failed", which
   * is all a count needs. Without it the likeliest failure on a real handset — the Play Integrity call
   * itself failing on the device — would be the one kind the claim counter could never see.
   */
  app.post('/api/referral/:userId/claim-failed', requireUserMatch('userId'), async (req: Request, res: Response) => {
    if (!referralRewardsEnabled()) return res.json({ ok: true });
    const body = (req.body ?? {}) as { reason?: unknown; message?: unknown };
    const reason = phoneCheckFailureCategory(String(body.reason ?? ''), String(body.message ?? '').slice(0, 300));
    void recordClaimOutcome(routeParam(req.params.userId), 'android', 'device-failed-on-phone', { reason });
    return res.json({ ok: true });
  });
}

/**
 * Pay a referrer whatever their friend's completed steps now entitle them to.
 *
 * Reconciles over the friend's whole state rather than reacting to one event, so it is safe to call
 * after ANY step, in any order, any number of times: the held email and github rungs are released by
 * the same call that pays for the mobile, and a repeat call pays zero.
 */
async function payReferrer(db: any, referrerId: string, friendId: string, nowIso: string): Promise<void> {
  const referrerRef = doc(db, REFERRALS, referrerId);
  const friendRef = doc(db, REFERRALS, friendId);
  const walletRef = doc(db, 'user_token_wallets', referrerId);

  await runTransaction(db, async (tx: any) => {
    const [refSnap, friendSnap, walletSnap] = await Promise.all([
      tx.get(referrerRef), tx.get(friendRef), tx.get(walletRef),
    ]);
    const referrer = (refSnap.exists() ? refSnap.data() : {}) as ReferralDoc;
    const friend = (friendSnap.exists() ? friendSnap.data() : {}) as ReferralDoc;

    const reward = decideReferrerReward({
      friendPaidSteps: friend.paidSteps,
      alreadyPaidToReferrer: friend.referrerPaidSteps,
      referrerEarnedTokens: referrer.earnedTokens,
    });
    if (reward.tokens <= 0) {
      // A capped or held referrer still records nothing — `recordSteps` is empty in both cases, so
      // the same steps are re-offered later if the cap is ever raised.
      return;
    }

    const wallet = (walletSnap.exists() ? walletSnap.data() : {}) as Record<string, unknown>;
    const patch = mirroredCreditPatch(wallet, reward.tokens, 'gift');
    const rupees = reward.tokens / TOKENS_PER_RUPEE;

    tx.set(walletRef, {
      ...patch,
      freeGiftedTokens: num(wallet.freeGiftedTokens) + reward.tokens,
      totalTokensPurchased: num(wallet.totalTokensPurchased) + reward.tokens,
      // 🔒 Through the shared appender — see walletStatement.ts.
      ...ledgerPatch(wallet, {
        type: 'purchase',
        amountCoinsOrTokens: reward.tokens,
        moneySpent: 0,
        timestamp: nowIso,
        // Never names the friend: who took up an invitation is their business, not the referrer's.
        description: `Referral reward: ₹${rupees.toLocaleString('en-IN')} credited`,
      }),
      updatedAt: nowIso,
    }, { merge: true });

    // The lifetime total and the per-friend record move in the SAME write as the money.
    tx.set(referrerRef, { earnedTokens: num(referrer.earnedTokens) + reward.tokens, updatedAt: nowIso }, { merge: true });
    tx.set(friendRef, {
      referrerPaidSteps: Array.from(new Set([...readSteps(friend.referrerPaidSteps), ...reward.recordSteps])),
    }, { merge: true });
  });
}
