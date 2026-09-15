// WHAT REFERRALS COST, AND WHO LOOKS LIKE A FARM — the admin's view of the scheme.
//
// ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────────────────
// The ₹1,500 lifetime cap BOUNDS what one referrer can take; it does not tell anybody what the
// scheme is actually costing, and a bound nobody can see is a bound nobody can tune. Everything here
// is arithmetic over rows the referral routes already write — it invents nothing and, because it
// only reads, it cannot affect a single payment.
//
// ── THE PATTERN WORTH LOOKING AT, and why it is a QUESTION rather than a verdict ─────────────────
// A factory-reset farm looks like this: one referrer, many friends, none of whom verified a mobile,
// none of whom ever paid. Each of those four facts is individually innocent — a genuinely popular
// referrer has many friends; a new user has not verified their phone YET; nobody pays on day one.
// Together they are worth a look.
//
// 🔒 SO NOTHING HERE PUNISHES ANYBODY, and that is deliberate rather than timid. This module
// produces a SORTED LIST for a human to read, never a block, never a clawback, never a flag written
// back to an account. The cost of being wrong about a real enthusiastic user is that we take money
// they earned; the cost of being slow about a farm is bounded at ₹1,500 by the cap. Those are not
// the same size, so the response to the smaller risk is a report, not an automation.
//
// PURE — no Firestore, no clock, no env. The caller supplies the rows.

/** One referral row, as the store holds it. Everything is `unknown` — these are untyped documents. */
export interface ReferralRow {
  userId: string;
  referrerUserId?: unknown;
  paidSteps?: unknown;
  earnedTokens?: unknown;
}

export interface ReferrerSummary {
  referrerUserId: string;
  friends: number;
  /** Friends who verified a real mobile — the only ones who ever paid this referrer anything. */
  friendsWithMobile: number;
  earnedTokens: number;
  /**
   * True when this referrer's friends are many and none of them verified a mobile. A QUESTION for a
   * human, never a verdict — see the header.
   */
  worthALook: boolean;
}

export interface ReferralSummary {
  /** Accounts that have earned at least one step. */
  participants: number;
  /** Accounts that applied somebody's code. */
  referred: number;
  /** Everything ever paid to NEW USERS across the four steps, in tokens. */
  selfTokens: number;
  /** Everything ever paid to REFERRERS, in tokens. */
  referrerTokens: number;
  /** The two together — what the scheme has cost, in tokens. */
  totalTokens: number;
  /** Referrers, busiest first. */
  topReferrers: ReferrerSummary[];
  /** True when the row set was capped, so every figure is a LOWER BOUND and must be shown as one. */
  capped: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function steps(v: unknown): string[] {
  return Array.isArray(v) ? v.map((s) => String(s ?? '')) : [];
}

/**
 * How many friends without a verified mobile make a referrer worth looking at.
 *
 * Three, because the honest referrer this could inconvenience is the one with three friends who all
 * happen not to have finished — common enough that a lower number would fill the list with ordinary
 * people. It is a threshold for a human's attention, not for any automatic action, so being a little
 * wrong in either direction costs nothing.
 */
export const LOOK_AT_THRESHOLD = 3;

/** Summarise the rows. PURE. */
export function summarizeReferrals(rows: ReferralRow[], capped = false): ReferralSummary {
  const byReferrer = new Map<string, ReferrerSummary>();
  let participants = 0;
  let referred = 0;
  let selfTokens = 0;

  // The per-step value is NOT read from a config here on purpose: this summarises what WAS paid, and
  // a rate change would otherwise silently rewrite history. It is passed in by the caller instead.
  for (const row of rows) {
    const mine = steps(row.paidSteps);
    if (mine.length > 0) participants++;
    const referrerId = String(row.referrerUserId ?? '').trim();
    if (referrerId) {
      referred++;
      const entry = byReferrer.get(referrerId) ?? {
        referrerUserId: referrerId, friends: 0, friendsWithMobile: 0, earnedTokens: 0, worthALook: false,
      };
      entry.friends++;
      if (mine.includes('mobile')) entry.friendsWithMobile++;
      byReferrer.set(referrerId, entry);
    }
  }

  // A referrer's OWN earnings live on their own row, which may or may not be in this page of rows.
  let referrerTokens = 0;
  for (const row of rows) {
    const earned = num(row.earnedTokens);
    if (earned <= 0) continue;
    referrerTokens += earned;
    const entry = byReferrer.get(row.userId);
    if (entry) entry.earnedTokens = earned;
  }

  const topReferrers = [...byReferrer.values()]
    .map((r) => ({ ...r, worthALook: r.friends >= LOOK_AT_THRESHOLD && r.friendsWithMobile === 0 }))
    .sort((a, b) => b.friends - a.friends || b.earnedTokens - a.earnedTokens);

  return {
    participants,
    referred,
    selfTokens,
    referrerTokens,
    totalTokens: selfTokens + referrerTokens,
    topReferrers,
    capped,
  };
}

/**
 * What the new users' steps cost, given the per-step rate.
 *
 * SEPARATE from the summary above because it needs today's rate, and the summary must stay pure
 * arithmetic over what was actually written. If the rate is ever changed, this figure becomes an
 * approximation of history — which is why the admin card says "at today's rate" rather than
 * presenting it as a ledger total.
 */
export function selfPayoutTokens(rows: ReferralRow[], perStepTokens: number): number {
  const rate = Number.isFinite(perStepTokens) && perStepTokens > 0 ? perStepTokens : 0;
  return rows.reduce((sum, r) => sum + steps(r.paidSteps).length * rate, 0);
}
