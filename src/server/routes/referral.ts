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
import { ledgerPatch } from '../lib/walletStatement';
import { mintReferralCode, normalizeReferralCode, referralShareMessage } from '../lib/referralCode';
import { checkDeviceIntegrity, deviceRefusalMessage, type DeviceCheck } from '../lib/deviceIntegrity';
import {
  decideSelfReward, decideReferrerReward, decideAttribution, attributionRefusalMessage,
  selfProgress, readSteps, referralRewardsEnabled, referrerLifetimeCapTokens,
  stepIsProven, stepNotDoneMessage, githubIsLinked, friendVerificationStatus,
  ALL_STEPS, WEB_ELIGIBLE_STEPS, type RewardStep, type StepProof,
} from '../lib/referralRewards';

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
 * A WEBSITE claim: pay the new user for their web-eligible verifications (mobile, github), capped at
 * ₹200 and held until a real mobile (OTP) is verified. No device check — the web has none; the mobile
 * SIM is the gate. Reconciles BOTH steps in one transaction, mobile first, so verifying the mobile
 * releases a github linked earlier, atomically and idempotently.
 *
 * 🔗 Pays the REFERRER too (admin 2026-09-26: *"website par jo user hai woh refer kar sakta hai, usko
 * refer token milne chahiye — wahi maximum 1500 ke"*). A web user cannot REDEEM a code (there is no
 * code-entry box on the website — the redeem/attribution route stays Android-only), so a friend only
 * ever acquires a referrer on Android; but once they have one, that referrer earns ₹25 for each of the
 * friend's verifications wherever they happen. `decideReferrerReward` is mobile-anchored (nothing until
 * the friend's real number lands) and ₹1,500-capped, so a web verification pays the referrer exactly as
 * a device-verified one does — a real SIM either way. Separate transaction, so it can never roll back
 * the friend's own credit.
 */
async function claimWeb(db: any, userId: string, res: Response): Promise<Response> {
  const contact = await resolveAccountContact(userId);
  const proof: StepProof = {
    emailVerified: contact.emailVerified && Boolean(contact.email),
    phoneVerified: Boolean(contact.phone),
    githubLinked: githubIsLinked(contact.providers),
    hasReferrer: false, // the referral code is Android-only; it is never earned on the web
  };
  const nowIso = new Date().toISOString();
  const selfRef = doc(db, REFERRALS, userId);
  const walletRef = doc(db, 'user_token_wallets', userId);

  const result = await runTransaction(db, async (tx: any) => {
    const [refSnap, walletSnap] = await Promise.all([tx.get(selfRef), tx.get(walletRef)]);
    const rec = (refSnap.exists() ? refSnap.data() : {}) as ReferralDoc;
    const wallet = (walletSnap.exists() ? walletSnap.data() : {}) as Record<string, unknown>;

    // Fold the running totals forward across BOTH steps so each decision sees what the previous one in
    // this same loop already granted — the ₹400 lifetime cap and the ₹200 web cap stay honest across a
    // two-step release (mobile + github paid together the moment the mobile lands).
    let paidSteps = readSteps(rec.paidSteps);
    let webGifted = num(rec.webGiftedTokens);
    let lifetimeGifted = num(wallet.freeGiftedTokens);
    let totalGranted = 0;

    for (const s of WEB_ELIGIBLE_STEPS) {
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
        description: `Referral bonus: ₹${rupees.toLocaleString('en-IN')} credited`,
      }),
      updatedAt: nowIso,
    }, { merge: true });
    tx.set(selfRef, { paidSteps, webGiftedTokens: webGifted, updatedAt: nowIso }, { merge: true });
    return { granted: totalGranted, referrerUserId: rec.referrerUserId ?? null };
  });

  // The referrer's half — separate transaction, separate user, never able to undo the credit above.
  // `decideReferrerReward` reconciles over the friend's state, so it is safe to call after ANY of the
  // friend's steps and pays ₹0 on a repeat; mobile-anchored and ₹1,500-capped inside it.
  if (result.granted > 0 && result.referrerUserId) {
    await payReferrer(db, String(result.referrerUserId), userId, nowIso)
      .catch(() => { /* re-offered on this friend's next step; never breaks the claimer's reply */ });
  }

  const grantedRupees = result.granted / TOKENS_PER_RUPEE;
  return res.json({
    ok: result.granted > 0,
    granted: result.granted,
    rupees: grantedRupees,
    message: result.granted > 0
      ? `₹${grantedRupees.toLocaleString('en-IN')} added to your wallet.`
      : (proof.phoneVerified
          ? 'Nothing new to claim on the website right now.'
          : 'Verify your mobile number to unlock your website reward — ₹100 for mobile and ₹100 for GitHub.'),
  });
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
      return res.json({
        ok: true,
        enabled: true,
        code,
        // What the account has ACTUALLY done. The screen uses it to say what is missing instead of
        // offering a Claim button that the proof gate would refuse — a button that cannot work is
        // the half-built state the second absolute rule forbids.
        emailVerified: contact.emailVerified && Boolean(contact.email),
        phoneVerified: Boolean(contact.phone),
        githubLinked: githubIsLinked(contact.providers),
        shareMessage: referralShareMessage(code),
        steps: selfProgress(rec.paidSteps).map((s) => ({
          step: s.step,
          claimed: s.claimed,
          rupees: s.tokens / TOKENS_PER_RUPEE,
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

      const [mine, owner, deviceMarker] = await Promise.all([
        readReferral(db, userId),
        ownerId ? readReferral(db, ownerId) : Promise.resolve({} as ReferralDoc),
        getDoc(doc(db, DEVICES, deviceId)),
      ]);

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
        // "old ko never": an account that already earned a step predates the referral and cannot be
        // retro-attributed. A brand-new account has claimed nothing.
        isNewUser: readSteps(mine.paidSteps).length === 0,
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
      // The website earns only mobile + github, capped at ₹200, and NOTHING until a real mobile (OTP)
      // is verified (admin 2026-09-26). There is NO device check here — the web has none; the mobile
      // SIM is the gate and github rides inside the ₹200. `platform` is client-declared and can only
      // ever REFUSE the Android-only steps, never grant more: `decideSelfReward`'s web branch pays only
      // the two web-eligible steps and requires the mobile, so a caller who spoofs `platform:'web'`
      // gets exactly what a web user gets and nothing an Android device would unlock.
      //
      // 🔒 It RECONCILES both web steps in ONE transaction, in WEB_ELIGIBLE_STEPS order (mobile first),
      // so verifying the mobile releases a github that was linked earlier — in the same call, with no
      // separate release path to forget (the shape rule 3 already uses for the referrer). Idempotent:
      // a repeat call pays ₹0 because every granted step is recorded in the same write as the credit.
      if (claimedPlatform(req) === 'web') {
        return await claimWeb(getDb() as any, routeParam(req.params.userId), res);
      }

      const device = await proveDevice(req);
      if (device.verdict !== 'verified') {
        return res.status(403).json({ ok: false, granted: 0, message: deviceRefusalMessage(device.verdict) });
      }
      const deviceId = device.deviceId as string;

      // 🔴 IS THE STEP ACTUALLY DONE? Asked of FIREBASE and of our own store, never of the request
      // body. Without this the device check alone would let any caller on a real Android phone POST
      // all four steps and collect ₹400 having verified nothing — a claim is a request, not a fact.
      const contact = await resolveAccountContact(userId);
      const existing = await readReferral(db, userId);
      const proof: StepProof = {
        emailVerified: contact.emailVerified && Boolean(contact.email),
        phoneVerified: Boolean(contact.phone),
        githubLinked: githubIsLinked(contact.providers),
        hasReferrer: Boolean(existing.referrerUserId),
      };
      if (!stepIsProven(step, proof)) {
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

      return res.json({
        ok: paid.granted > 0,
        granted: paid.granted,
        rupees: paid.granted / TOKENS_PER_RUPEE,
        reason: paid.reason,
      });
    } catch (e) {
      return sendSafeError(res, 500, 'Could not claim that bonus.', e, 'referral:claim');
    }
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
