// Weekly free credit for the free tier (admin 2026-07-28: "₹250 signup, phir ₹200 weekly, maximum ₹650").
//
// THE MODEL. One currency for everything: a new account is gifted ₹250 of wallet credit, and every week
// it is topped up by ₹200 — but the free credit can never stack past ₹650, i.e. the signup grant plus
// exactly two unspent weeks (250 + 200 + 200). A third idle week adds nothing. Anything that costs
// NavBharatAI money (a build, an image, a strong-model answer) spends from that balance; anything that
// costs nothing (a reply served by the free flash model) spends nothing, so it stays free by itself.
// There are no per-feature daily quotas to tune — the price of the thing IS the limit.
//
// WHY LAZY, NOT SCHEDULED. The top-up is applied when the user's wallet is READ, by comparing the stored
// `lastTopUpAt` against now. That means no cron, no fan-out across every account in the database, and —
// most importantly — a dormant account accrues nothing. Only someone who comes back gets topped up,
// which is exactly the retention behaviour the weekly credit is FOR, and it is where the saving is.
//
// ONE WEEK PER VISIT, DELIBERATELY. Someone who disappears for five weeks does not return to five weeks
// of credit. Each visit grants at most one week, so being away is never rewarded over showing up.
//
// THE CAP EXCLUDES PAYING USERS BY CONSTRUCTION. The grant is limited to whatever is left below the
// ₹650 ceiling, so a customer holding ₹5,000 of purchased credit receives nothing — the weekly gift is
// there to keep a FREE user building, not to discount a paying one.
//
// Pure and fully unit-tested; the caller supplies `now` and persists the result.

import { TOKENS_PER_RUPEE } from './payments';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Weekly free credit in wallet tokens. `WEEKLY_TOPUP_TOKENS=0` switches the whole thing off. */
export function weeklyTopUpTokens(): number {
  const n = Number(process.env.WEEKLY_TOPUP_TOKENS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200 * TOKENS_PER_RUPEE; // ₹200
}

/**
 * The ceiling free credit may stack to. A balance at or above this receives no weekly top-up.
 *
 * ₹650 = the ₹250 signup grant plus two full unspent weeks (admin 2026-07-28). Someone who keeps
 * building never notices it; someone who never spends stops accruing after a fortnight, which is
 * exactly where a hoarded balance stops being a funnel and starts being a liability.
 */
export function freeCreditCapTokens(): number {
  const n = Number(process.env.WALLET_FREE_CAP_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 650 * TOKENS_PER_RUPEE; // ₹650
}

export type TopUpReason = 'disabled' | 'too-soon' | 'at-cap' | 'granted';

export interface TopUpDecision {
  /** Tokens to add. 0 means write nothing to the balance. */
  grantTokens: number;
  /** The new `lastTopUpAt` to persist, or null to leave it untouched. */
  newLastTopUpAt: string | null;
  reason: TopUpReason;
}

export interface TopUpInput {
  /** Current wallet token balance. */
  tokenBalance: unknown;
  /** ISO of the last weekly top-up, or null/absent for a wallet that has never had one. */
  lastTopUpAt?: string | null;
  /** ISO the wallet was created — the anchor for wallets that predate this feature. */
  createdAt?: string | null;
  now: number;
}

/**
 * Decide this wallet's weekly top-up.
 *
 * A wallet with no `lastTopUpAt` anchors on `createdAt` when it has one, so an existing account does not
 * receive a surprise grant the instant this ships — it waits out its first week like everyone else. With
 * neither timestamp the clock simply starts now (grant nothing, stamp the anchor).
 */
export function decideWeeklyTopUp(input: TopUpInput): TopUpDecision {
  const weekly = weeklyTopUpTokens();
  const nowIso = new Date(input.now).toISOString();
  if (weekly <= 0) return { grantTokens: 0, newLastTopUpAt: null, reason: 'disabled' };

  const anchorRaw = input.lastTopUpAt || input.createdAt || null;
  const anchor = anchorRaw ? Date.parse(anchorRaw) : NaN;
  if (!Number.isFinite(anchor)) {
    // No usable anchor — start the clock now rather than granting on an unknown history.
    return { grantTokens: 0, newLastTopUpAt: nowIso, reason: 'too-soon' };
  }
  if (input.now - anchor < WEEK_MS) {
    return { grantTokens: 0, newLastTopUpAt: null, reason: 'too-soon' };
  }

  const balance = Number(input.tokenBalance);
  const held = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const room = freeCreditCapTokens() - held;
  if (room <= 0) {
    // At or above the free ceiling. The week still counts — otherwise a user parked at the cap would
    // bank an instant grant the moment they spent anything.
    return { grantTokens: 0, newLastTopUpAt: nowIso, reason: 'at-cap' };
  }

  return { grantTokens: Math.min(weekly, room), newLastTopUpAt: nowIso, reason: 'granted' };
}

/** The ledger row a granted top-up writes, so the user can see where the credit came from. */
export function topUpLedgerEntry(grantTokens: number, nowIso: string): Record<string, unknown> {
  return {
    type: 'purchase',
    amountCoinsOrTokens: grantTokens,
    moneySpent: 0,
    timestamp: nowIso,
    description: `Weekly free credit: ₹${(grantTokens / TOKENS_PER_RUPEE).toLocaleString('en-IN')} added`,
  };
}
