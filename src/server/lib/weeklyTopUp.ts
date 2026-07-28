// The free tier's ONE-TIME gift ladder (admin 2026-07-28).
//
//     ₹250 at signup  →  +₹200 a week later  →  +₹200 a week after that  →  CUT OFF, permanently.
//
// Lifetime gift per account: ₹650. Not ₹650 a month, not ₹650 held at once — ₹650 EVER. After the
// second weekly rung the ladder ends and the account is an ordinary paying account.
//
// WHY THAT DISTINCTION IS THE WHOLE POINT. An ongoing "₹200 every week while you are under the cap"
// looks almost identical in code and costs a completely different amount: a continuously-active free
// account would draw ₹200 a week forever — about ₹2,600 of billed credit a year, roughly ₹650 of real
// provider spend PER USER PER YEAR. This ladder costs ₹650 of billed credit ONCE, about ₹163 of real
// spend, and then nothing at all. That is why the cap is measured against the TOTAL EVER GIFTED and
// never against the current balance: a balance cap quietly becomes the expensive version the moment the
// user spends anything.
//
// ONE CURRENCY. The gift lands in the same wallet everything spends from. Anything that costs
// NavBharatAI money (a build, an image, a strong-model answer) draws it down; anything that costs
// nothing (a reply served by the free flash model) draws nothing, so it stays free by itself. There are
// no per-feature daily quotas to tune — the price of the thing IS the limit.
//
// LAZY, NOT SCHEDULED. A rung is applied when the wallet is READ, comparing the stored anchor against
// the SERVER clock. No cron, no fan-out over every account — and a dormant account accrues nothing
// until it comes back, which is the retention behaviour the ladder exists for.
//
// ONE RUNG PER VISIT. Someone who disappears for five weeks does not return to five weeks of credit.
//
// Pure and fully unit-tested; the caller supplies `now` and persists the result.

import { TOKENS_PER_RUPEE } from './payments';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** One rung of the ladder, in wallet tokens. `WEEKLY_TOPUP_TOKENS=0` switches the ladder off. */
export function weeklyTopUpTokens(): number {
  const n = Number(process.env.WEEKLY_TOPUP_TOKENS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200 * TOKENS_PER_RUPEE; // ₹200
}

/**
 * The TOTAL gift an account may ever receive, signup bonus included. ₹650 = ₹250 + ₹200 + ₹200.
 *
 * Reaching it is a permanent cut-off, not a pause: spending the balance back down does NOT re-open the
 * ladder, because this counts what was GIVEN, never what is held.
 */
export function lifetimeGiftCapTokens(): number {
  const n = Number(process.env.WALLET_FREE_CAP_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 650 * TOKENS_PER_RUPEE; // ₹650
}

export type TopUpReason = 'disabled' | 'too-soon' | 'exhausted' | 'granted';

export interface TopUpDecision {
  /** Tokens to add. 0 means write nothing to the balance. */
  grantTokens: number;
  /** The new anchor to persist, or null to leave it untouched. */
  newLastTopUpAt: string | null;
  /** True once the account has had its full lifetime gift — the ladder is over for good. */
  exhausted: boolean;
  reason: TopUpReason;
}

export interface TopUpInput {
  /**
   * Total tokens EVER gifted to this account (signup bonus + every rung so far). NOT the balance — see
   * the header for why that distinction is the entire cost model.
   */
  giftedSoFar: unknown;
  /** ISO of the last rung, or null/absent for an account that has had none. */
  lastTopUpAt?: string | null;
  /** ISO the wallet was created — the anchor for accounts that predate this feature. */
  createdAt?: string | null;
  now: number;
}

/**
 * Decide this account's next rung.
 *
 * An account with no `lastTopUpAt` anchors on `createdAt` when it has one, so an existing account does
 * not receive a surprise grant the instant this ships — it waits out its week like everyone else. With
 * neither timestamp the clock simply starts now (grant nothing, stamp the anchor).
 */
export function decideWeeklyTopUp(input: TopUpInput): TopUpDecision {
  const weekly = weeklyTopUpTokens();
  const nowIso = new Date(input.now).toISOString();
  const NONE = { grantTokens: 0, newLastTopUpAt: null, exhausted: false } as const;
  if (weekly <= 0) return { ...NONE, reason: 'disabled' };

  const givenRaw = Number(input.giftedSoFar);
  const given = Number.isFinite(givenRaw) && givenRaw > 0 ? givenRaw : 0;
  const remaining = lifetimeGiftCapTokens() - given;
  if (remaining <= 0) {
    // Finished, for good. Nothing is written — not even the anchor, because there is no longer any week
    // left to measure.
    return { grantTokens: 0, newLastTopUpAt: null, exhausted: true, reason: 'exhausted' };
  }

  const anchorRaw = input.lastTopUpAt || input.createdAt || null;
  const anchor = anchorRaw ? Date.parse(anchorRaw) : NaN;
  if (!Number.isFinite(anchor)) {
    // No usable anchor — start the clock now rather than granting on an unknown history.
    return { grantTokens: 0, newLastTopUpAt: nowIso, exhausted: false, reason: 'too-soon' };
  }
  if (input.now - anchor < WEEK_MS) {
    return { ...NONE, reason: 'too-soon' };
  }

  const grantTokens = Math.min(weekly, remaining);
  return {
    grantTokens,
    newLastTopUpAt: nowIso,
    exhausted: given + grantTokens >= lifetimeGiftCapTokens(),
    reason: 'granted',
  };
}

export interface GiftLadderSummary {
  /** Tokens gifted so far, out of `capTokens`. */
  giftedTokens: number;
  /** The lifetime ceiling. */
  capTokens: number;
  /** Still to come, 0 once finished. */
  remainingTokens: number;
  /** True when the ladder is over for good. */
  exhausted: boolean;
  /** ISO of the next rung, or null when there is no next one (finished, or the ladder is off). */
  nextCreditAt: string | null;
}

/**
 * The ladder's state, for showing the user.
 *
 * WHY THIS EXISTS: the grant itself was invisible. The credit landed, a ledger row was written, and
 * nothing on any screen said where it came from, how much was left, or when the next one arrives — so
 * the feature was, from the user's side, a number that occasionally changed on its own. It is also the
 * moment that matters commercially: "this is your last free credit" is when someone decides to recharge,
 * and we were not saying it.
 *
 * Derived from the SAME inputs as `decideWeeklyTopUp`, so what is displayed can never disagree with what
 * is granted. Pure.
 */
export function summarizeGiftLadder(input: Omit<TopUpInput, 'now'> & { now: number }): GiftLadderSummary {
  const cap = lifetimeGiftCapTokens();
  const givenRaw = Number(input.giftedSoFar);
  const giftedTokens = Math.min(cap, Number.isFinite(givenRaw) && givenRaw > 0 ? givenRaw : 0);
  const remainingTokens = Math.max(0, cap - giftedTokens);
  const off = weeklyTopUpTokens() <= 0;
  const exhausted = remainingTokens <= 0;

  let nextCreditAt: string | null = null;
  if (!exhausted && !off) {
    const anchorRaw = input.lastTopUpAt || input.createdAt || null;
    const anchor = anchorRaw ? Date.parse(anchorRaw) : NaN;
    // A due-but-not-yet-applied rung reads as "now" rather than a past date — it lands on the next read.
    nextCreditAt = Number.isFinite(anchor)
      ? new Date(Math.max(anchor + WEEK_MS, input.now)).toISOString()
      : new Date(input.now + WEEK_MS).toISOString();
  }

  return { giftedTokens, capTokens: cap, remainingTokens, exhausted, nextCreditAt };
}

/** The ledger row a granted rung writes, so the user can see where the credit came from. */
export function topUpLedgerEntry(grantTokens: number, nowIso: string): Record<string, unknown> {
  return {
    type: 'purchase',
    amountCoinsOrTokens: grantTokens,
    moneySpent: 0,
    timestamp: nowIso,
    description: `Weekly free credit: ₹${(grantTokens / TOKENS_PER_RUPEE).toLocaleString('en-IN')} added`,
  };
}
