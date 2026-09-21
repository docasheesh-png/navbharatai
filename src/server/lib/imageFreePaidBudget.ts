// THE PLATFORM-WIDE DAILY CEILING on images the FREE tier gets from a PAID engine (2026-09-21).
//
// 🔴 WHY IT EXISTS — the number PR #3234 left open. The free image tier costs ₹0 while the free
// provider serves; its paid rungs (Gemini, Grok) exist for when it does not, and an EDIT of the
// user's own picture on the free tier is a paid rung by construction. Until today the only bound on
// that spend was PER USER (`AI_IMAGE_FREE_DAILY_LIMIT`, default 3). At 10,000 users that is 30,000
// paid images a day the moment the free provider has a bad hour — at a price `providerRates.ts`
// has never carried. A per-user cap bounds one account; nothing bounded the platform.
//
// 🔑 A COUNT, NOT A RUPEE FIGURE, deliberately. THE ONE-WALLET LAW forbids inventing a cost, and no
// image model is on the rate card yet; a count is a number that is true. `AI_IMAGE_FREE_PAID_DAILY_CAP`
// — default 300 a day across the whole platform, `0` means the free tier never touches a paid engine
// (the free provider or nothing), an unreadable value falls back to the default and NEVER to
// unlimited (the `AGENTV3_FEATURE_HEAL_PCT` lesson), and only the explicit word `off` lifts it.
//
// 🔒 IT FAILS CLOSED, like `webRiskBudget.ts` and unlike the wallet gate — and the asymmetry is the
// reason: refusing a paid rescue on a Firestore blip costs one user a picture they can ask for again
// in a minute (the FREE provider is still tried first, every time); opening the paid rungs on a
// counter nobody can read is the unbounded bill this module exists to prevent.
//
// 📏 WRITE RATE: one increment per PAID delivery, and the cap itself bounds the day to a few hundred —
// far below Firestore's ~1 write/second/document line. Sharding (§SCALE-PLAN item 1) is for a cap
// two orders of magnitude higher, not before. Collection `image_free_paid_daily`, one document per
// UTC day, dated on the SERVER clock (a device clock cannot move it).
//
// ⚠️ THE PAID (Pro) TIER IS UNTOUCHED: the user pays ₹1 there and the wallet is the bound. This is the
// FREE route's paid rungs only — `allowPaidRung()` in `routes/imageGen.ts` is its single reader.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export const IMAGE_FREE_PAID_DAILY_CAP_DEFAULT = 300;
export const IMAGE_FREE_PAID_COLLECTION = 'image_free_paid_daily';

/** The cap, or `Infinity` for the explicit word `off`. PURE. */
export function imageFreePaidDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.AI_IMAGE_FREE_PAID_DAILY_CAP || '').trim().toLowerCase();
  if (!raw) return IMAGE_FREE_PAID_DAILY_CAP_DEFAULT;
  if (raw === 'off') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[IMAGE_GEN] AI_IMAGE_FREE_PAID_DAILY_CAP="${env.AI_IMAGE_FREE_PAID_DAILY_CAP}" is unreadable — using ${IMAGE_FREE_PAID_DAILY_CAP_DEFAULT}, never unlimited.`);
    return IMAGE_FREE_PAID_DAILY_CAP_DEFAULT;
  }
  return Math.floor(n);
}

/** `YYYY-MM-DD` in UTC from a server timestamp. PURE. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export type FreePaidVerdict =
  | { allow: true; used: number; cap: number }
  | { allow: false; reason: 'cap-reached' | 'cap-zero' | 'unreadable'; used: number; cap: number };

/** The decision from the two numbers. PURE, so the whole rule is testable without Firestore. */
export function decideFreePaid(used: number | null, cap: number): FreePaidVerdict {
  if (cap === 0) return { allow: false, reason: 'cap-zero', used: used ?? 0, cap };
  if (used === null) return { allow: false, reason: 'unreadable', used: 0, cap };
  if (used >= cap) return { allow: false, reason: 'cap-reached', used, cap };
  return { allow: true, used, cap };
}

/**
 * What a FREE user is told when the platform's daily paid allowance is spent. Branded, and true in
 * the ordinary case: the free provider was tried first and did not answer, and it will be tried
 * again on the next press. Names no vendor and no cap.
 */
export const FREE_PAID_CAP_MESSAGE =
  'NavBharatAI’s free engine is busy and the day’s backup allowance is used up — please try again in a few minutes.';

let warnedForDay = '';

export class ImageFreePaidBudget {
  private getDb(): admin.firestore.Firestore | null {
    try { return getServerDb() as unknown as admin.firestore.Firestore; } catch { return null; }
  }

  /** Today's count, or `null` when it could not be read (which the decision treats as "closed"). */
  async usedToday(day: string): Promise<number | null> {
    const db = this.getDb();
    if (!db) return null;
    try {
      const snap = await db.collection(IMAGE_FREE_PAID_COLLECTION).doc(day).get();
      const n = Number((snap.exists ? (snap.data() as { count?: unknown }).count : 0) ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch (e) {
      console.error('[IMAGE_GEN] free-tier paid budget could not be read — refusing the paid rungs today:', e);
      return null;
    }
  }

  async decide(nowMs = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<FreePaidVerdict> {
    const cap = imageFreePaidDailyCap(env);
    if (cap === Number.POSITIVE_INFINITY) return { allow: true, used: 0, cap };
    if (cap === 0) return decideFreePaid(0, 0);
    const day = utcDay(nowMs);
    const verdict = decideFreePaid(await this.usedToday(day), cap);
    if (!verdict.allow && verdict.reason === 'cap-reached' && warnedForDay !== day) {
      // Once per process per day: the admin reads this as "the free provider failed N+ times today
      // and the platform stopped paying" — the number that decides whether the cap is right.
      warnedForDay = day;
      console.warn(`[IMAGE_GEN] free-tier PAID image cap reached for ${day} (${verdict.used}/${cap}) — further free-tier fallbacks refused until tomorrow (AI_IMAGE_FREE_PAID_DAILY_CAP).`);
    }
    return verdict;
  }

  /** One PAID delivery to a free-tier user. `increment`, so concurrent deliveries never lose a count. */
  async record(nowMs = Date.now()): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    const day = utcDay(nowMs);
    try {
      await db.collection(IMAGE_FREE_PAID_COLLECTION).doc(day).set(
        { day, count: admin.firestore.FieldValue.increment(1), updatedAt: nowMs }, { merge: true },
      );
    } catch (e) {
      // Loudly: a counter that stopped moving is a cap that stopped biting.
      console.error('[IMAGE_GEN] could not record a free-tier paid image:', e);
    }
  }
}

export const imageFreePaidBudget = new ImageFreePaidBudget();
