// THE FRIENDS WHO USED MY CODE — the shape check and the plain words, for what
// `GET /api/referral/:userId/referred` returns.
//
// 🔒 A SERVER BODY IS NOT THE ANSWER UNTIL IT IS CHECKED (the repo's rule for every client that stores a
// server body): `res.ok` and a shape check at the one place the body enters state. A refusal such as
// `{ error }` is therefore not "you have no friends yet".
//
// 🔒 NO MONEY IS DERIVED HERE. The referrer's reward per friend depends on rules only the server applies
// (the mobile step gates the rest, a lifetime ceiling, exactly-once payment), so working out "₹25 × steps"
// on the screen would sometimes print a figure the wallet never received. The screen shows each friend's
// VERIFICATIONS (the server's own `friendVerificationStatus`) and the account's real earned total
// (`useReferralProgress`) — the two are never multiplied together.
//
// 🔒 NO PERSONAL DATA BEYOND WHAT IS NEEDED. The server now sends a masked label (`am••••@mail.com`), never
// the friend's address; this module renders only that.
//
// PURE.

import { isRecord } from './serverAnswer';

export interface ReferredFriend {
  /** A privacy-safe label from the server (masked address). */
  label: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  completedCount: number;
  referredAt: string | null;
}

export interface ReferredAnswer {
  ok: true;
  enabled: boolean;
  friends: ReferredFriend[];
}

/** The number of verifications a friend can complete for the referrer: login, mobile, GitHub. */
export const FRIEND_STEPS_TOTAL = 3;

function friendOf(raw: unknown): ReferredFriend | null {
  if (!isRecord(raw)) return null;
  const completedCount = Number(raw.completedCount);
  if (!Number.isFinite(completedCount)) return null;
  return {
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : 'A friend',
    emailVerified: raw.emailVerified === true,
    phoneVerified: raw.phoneVerified === true,
    githubLinked: raw.githubLinked === true,
    completedCount: Math.max(0, Math.min(FRIEND_STEPS_TOTAL, Math.floor(completedCount))),
    referredAt: typeof raw.referredAt === 'string' && raw.referredAt ? raw.referredAt : null,
  };
}

/** The `/referred` answer, or null when the body is not one (a refusal, a proxy page, a half-written reply). */
export function parseReferredAnswer(body: unknown): ReferredAnswer | null {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.friends)) return null;
  const friends: ReferredFriend[] = [];
  for (const raw of body.friends) {
    const f = friendOf(raw);
    // A row that cannot be read is DROPPED, not guessed — but the count below is taken from what was
    // readable, so the totals can never claim a friend the list does not show.
    if (f) friends.push(f);
  }
  return { ok: true, enabled: body.enabled !== false, friends };
}

export function friendStatusLabel(f: ReferredFriend): string {
  const left = FRIEND_STEPS_TOTAL - f.completedCount;
  if (left <= 0) return 'All verifications complete';
  return left === 1 ? '1 step left' : `${left} steps left`;
}

export interface ReferredTotals {
  total: number;
  completed: number;
  pending: number;
}

export function referredTotals(friends: readonly ReferredFriend[]): ReferredTotals {
  const completed = friends.filter((f) => f.completedCount >= FRIEND_STEPS_TOTAL).length;
  return { total: friends.length, completed, pending: friends.length - completed };
}
