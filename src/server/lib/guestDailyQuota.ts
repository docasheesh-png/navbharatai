// One daily message budget for visitors who have not signed in (admin-mandated 2026-09-27).
//
// Admin, verbatim: "without login only 10 messages per day! iske bad login compulsory!! 11th message
// login ke bad ya next day! sabhi mila kar!!"
//
// So: a visitor who is not signed in may send TEN AI messages a day, counted across EVERY surface that
// accepts them ("sabhi mila kar" — free chat, Repo Analyst, App Review, the security scan and the AI
// tools share ONE count, not ten each). The eleventh is refused with a sign-in prompt, and the budget
// comes back at midnight India time. A signed-in account is never counted here.
//
// 🔴 WHY THE COUNT LIVES ON THE SERVER. There was already a "10 a day" rule, and it was a counter in the
// browser's localStorage (usePaymentEngine.ts): clearing site data, a private window or a second browser
// reset it, and it counted only free chat. A limit the caller holds is a suggestion.
//
// 🔑 WHO IS "ONE VISITOR". Not an IP address alone: Indian mobile networks put many phones behind one
// public address (CGNAT), so ten messages per IP would lock out every stranger on the same tower after
// one person used theirs. The visitor is the anonymous DEVICE id the app sends (`x-nb-guest`), with the
// IP kept only as a much larger backstop (`GUEST_DAILY_IP_CAP`, default 100) so a script that invents a
// fresh device id per message is still bounded. A request with no device id (an app build from before
// this change, or a caller that is not our app) is judged by that backstop alone — see decideGuestMessage.
//
// ⚠️ WHAT THIS IS NOT. It is a conversion rule and a spend bound, not identity: a determined person can
// clear the id, and the IP comes from the request's own forwarding header. That is the same ceiling every
// anonymous limit here has, and why the paid surfaces (builds, images, Professionals, Doctor AI, voice)
// already require an account from the first message and are not touched by this module.
//
// FAIL-OPEN, like every rate limit in this repo: a Firestore outage lets the message through rather than
// locking visitors out of a free chat. The per-minute and per-hour limiters stay in force regardless.

import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { doc, getServerDb, runTransaction } from './serverDb';
import { verifyFirebaseIdentity } from './authMiddleware';
import { clientAddress } from './clientAddress';

/** The header the app sends with its anonymous device id. */
export const GUEST_ID_HEADER = 'x-nb-guest';
/** The refusal code the client recognises (it opens sign-in instead of showing an error). */
export const GUEST_LIMIT_CODE = 'guest_limit_reached';

const DEFAULT_DAILY = 10;
const DEFAULT_IP_CAP = 100;
const COLLECTION = 'guest_daily_usage';

/**
 * How many messages a signed-out visitor gets per day. Unset ⇒ 10. `0` ⇒ sign-in from the first message.
 * `off` ⇒ no limit (today's behaviour before this module). Unreadable ⇒ 10, never "no limit".
 */
export function guestDailyLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = String(env.GUEST_DAILY_MESSAGES ?? '').trim().toLowerCase();
  if (raw === 'off') return null;
  if (raw === '') return DEFAULT_DAILY;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : DEFAULT_DAILY;
}

/** The per-IP backstop per day. Never smaller than the per-device limit; unreadable ⇒ 100. */
export function guestDailyIpCap(env: NodeJS.ProcessEnv = process.env, perDevice = DEFAULT_DAILY): number {
  const raw = String(env.GUEST_DAILY_IP_CAP ?? '').trim();
  const n = raw === '' ? DEFAULT_IP_CAP : Number(raw);
  const cap = Number.isInteger(n) && n > 0 && n <= 100_000 ? n : DEFAULT_IP_CAP;
  return Math.max(cap, perDevice);
}

/** The India calendar day (UTC+5:30) a moment falls on, as YYYY-MM-DD — "next day" means India's midnight. */
export function indiaDay(nowMs: number): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

/** A device id the app minted (a UUID-shaped token), or null. Anything else is ignored, never trusted. */
export function readGuestId(value: unknown): string | null {
  const v = String(Array.isArray(value) ? value[0] : value ?? '').trim();
  return /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null;
}

/**
 * The address this request came from, for the backstop only — the server's ONE reading of it
 * (`clientAddress.ts`): Cloud Run's front end APPENDS the address it saw to X-Forwarded-For, so the LAST
 * entry is the one a caller cannot write.
 */
export function requestAddress(req: Pick<Request, 'headers' | 'socket'>): string {
  return clientAddress(req);
}

/** A stored key that is not the raw id or address. */
function hashed(kind: string, value: string): string {
  return createHash('sha256').update(`${kind}:${value}`).digest('hex').slice(0, 32);
}

export interface GuestBudgetState {
  deviceUsed: number | null;
  ipUsed: number;
}

export type GuestDecision =
  | { allow: true; remaining: number }
  | { allow: false; reason: 'device' | 'address' | 'signin-only' };

/**
 * PURE — may one more message go through?
 *
 *  • the address backstop is checked first: past it, nobody behind that address sends more today;
 *  • a device id is held to the daily limit;
 *  • a request with NO device id is held to the backstop alone. That is deliberate, not a gap: a script
 *    can mint a fresh device id per message and reach the backstop anyway, so the backstop is the real
 *    bound on automated use in both cases — and holding an id-less caller to ten would lock out every
 *    person on the same mobile address who is still on an app build that does not send the id yet.
 */
export function decideGuestMessage(state: GuestBudgetState, limit: number, ipCap: number): GuestDecision {
  if (limit <= 0) return { allow: false, reason: 'signin-only' };
  if (state.ipUsed >= ipCap) return { allow: false, reason: 'address' };
  if (state.deviceUsed !== null && state.deviceUsed >= limit) return { allow: false, reason: 'device' };
  const remaining = state.deviceUsed !== null ? limit - state.deviceUsed - 1 : ipCap - state.ipUsed - 1;
  return { allow: true, remaining: Math.max(0, remaining) };
}

/** The words a visitor sees. Branded, no numbers they cannot act on, and the way out is stated. */
export function guestLimitMessage(limit: number): string {
  return limit <= 0
    ? 'Please sign in to chat with NavBharatAI. It is free.'
    : `You have used your ${limit} free messages for today. Sign in to keep going — it is free — or come back tomorrow.`;
}

/** Storage seam, so the decision can be tested without Firestore. */
export interface GuestUsageStore {
  /** Read both counters, decide with `decide`, and increment both only when it allows. Atomic. */
  consume(
    day: string,
    deviceKey: string | null,
    ipKey: string,
    decide: (state: GuestBudgetState) => GuestDecision,
  ): Promise<GuestDecision>;
}

export const firestoreGuestUsageStore: GuestUsageStore = {
  async consume(day, deviceKey, ipKey, decide) {
    const db = getServerDb();
    // No database (local dev, or an outage at boot): fail open.
    if (!db) return decide({ deviceUsed: deviceKey ? 0 : null, ipUsed: 0 });
    const ipRef = doc(db, COLLECTION, `${day}_ip_${ipKey}`);
    const devRef = deviceKey ? doc(db, COLLECTION, `${day}_dev_${deviceKey}`) : null;
    return runTransaction(db, async (tx) => {
      const ipSnap = await tx.get(ipRef);
      const devSnap = devRef ? await tx.get(devRef) : null;
      const ipUsed = ipSnap.exists() ? Number(ipSnap.data()?.count || 0) : 0;
      const deviceUsed = devSnap ? (devSnap.exists() ? Number(devSnap.data()?.count || 0) : 0) : null;
      const decision = decide({ deviceUsed, ipUsed });
      if (decision.allow) {
        // `expireAt` lets a Firestore TTL policy delete the day's counters; harmless without one.
        const expireAt = new Date(Date.parse(`${day}T00:00:00Z`) + 3 * 86_400_000);
        tx.set(ipRef, { count: ipUsed + 1, day, expireAt }, { merge: true });
        if (devRef) tx.set(devRef, { count: (deviceUsed ?? 0) + 1, day, expireAt }, { merge: true });
      }
      return decision;
    });
  },
};

/**
 * Express middleware for an AI route a signed-out visitor can reach. A verified account passes untouched;
 * a visitor is counted against the shared daily budget and refused with 403 `guest_limit_reached` once it
 * is spent. 403, not 401: the free-chat client treats a 401 as an expired session and signs the user out.
 */
export function guestDailyQuota(
  surface: string,
  deps: {
    store?: GuestUsageStore;
    identify?: (req: Request) => Promise<{ uid: string } | null>;
    now?: () => number;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const store = deps.store ?? firestoreGuestUsageStore;
  const identify = deps.identify ?? verifyFirebaseIdentity;
  const now = deps.now ?? (() => Date.now());
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const env = deps.env ?? process.env;
    const limit = guestDailyLimit(env);
    if (limit === null) return next();
    let signedIn = false;
    try { signedIn = Boolean((await identify(req))?.uid); } catch { signedIn = false; }
    if (signedIn) return next();
    const ipCap = guestDailyIpCap(env, limit);
    const guestId = readGuestId(req.headers[GUEST_ID_HEADER]);
    const day = indiaDay(now());
    let decision: GuestDecision;
    try {
      decision = await store.consume(
        day,
        guestId ? hashed('dev', guestId) : null,
        hashed('ip', requestAddress(req)),
        (state) => decideGuestMessage(state, limit, ipCap),
      );
    } catch {
      return next(); // fail open — see the note at the top
    }
    if (decision.allow) {
      res.setHeader('X-Guest-Messages-Left', String(decision.remaining));
      return next();
    }
    res.status(403).json({
      error: guestLimitMessage(limit),
      code: GUEST_LIMIT_CODE,
      limit,
      surface,
    });
  };
}
