// ₹150 FOR NEW USERS, GIVEN BY THE ADMIN IN ONE PRESS (admin 2026-09-27).
//
// The admin's three rules, verbatim, and they are the whole design:
//   1. "user new hona chahiye"                       → the account JOINED within the last N days.
//   2. "balance gift 00 hona chahiye (₹ se purchase kiye huye alag)"
//                                                    → the GIFT part of the balance is ₹0. Money the
//                                                      user paid is separate and never counts.
//   3. "ek bar 150₹ mil gaye, wapas na mile, chahe admin one click kitni bhi baar kare"
//                                                    → once given, never again, however many presses.
//
// 🔴 WHY RULE 1 IS A DATE, AND WHAT IT CORRECTS. The first version (#3342) defined "new" as "has never
// received any credit". That is true of every account opened after the flat welcome gift was retired
// on 2026-09-17 (#3030) — ten days of sign-ups — so the button offered ₹150 to all of them, which is
// what the admin saw ("yeh 150₹ sabhi user ko kar rahe hai"). "Never credited" describes a wallet;
// "new" describes a PERSON, and only the join date says that. The join date is the SAME one the users
// list shows in its "Joined" column (`resolveJoinedAt`: Firebase Auth first, the wallet's own
// `createdAt` second), so the button and the screen can never disagree about who is new.
// An account whose join date cannot be read is NOT new: unknown must never mean "pay".
//
// RULE 2 is `giftRemaining` — the one reader of "how much of this balance is gift money", which every
// debit keeps current (gift is spent first) and which the hosting-plan rule already relies on.
//
// RULE 3 is the `adminWelcomeGiftAt` stamp, written in the SAME transaction as the credit and re-read
// inside it, so two presses — or two admins pressing at once — pay an account once. It is the same
// stamp the retired ₹50 button wrote, so an account that received that ₹50 is not paid again.
//
// 🔒 TWO GUARDS THE ADMIN DID NOT HAVE TO ASK FOR, because they are older rules this must not undo:
//   • a BANNED or MERGED-AWAY account is never paid;
//   • the ₹400 lifetime gift ceiling (`capSelfGift`) still holds — an account without room for the
//     whole ₹150 is skipped rather than paid part of it.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { giftRemaining } from './giftSpend';
import { capSelfGift } from './giftPolicy';

export const ADMIN_WELCOME_GIFT_RUPEES = 150;
export const ADMIN_WELCOME_GIFT_TOKENS = ADMIN_WELCOME_GIFT_RUPEES * TOKENS_PER_RUPEE;

/** How far back "new" reaches by default, and the widest the admin may choose. */
export const NEW_USER_DEFAULT_DAYS = 7;
export const NEW_USER_MAX_DAYS = 30;

/** At most this many accounts are paid per press; the rest are reported as remaining. */
export const BULK_WELCOME_GIFT_MAX = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * PURE: the "joined within the last N days" the admin chose, or null when it is not a whole number
 * from 1 to NEW_USER_MAX_DAYS. Null is a refusal — a money route never reads a bad value as "all time".
 */
export function parseNewUserDays(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > NEW_USER_MAX_DAYS) return null;
  return n;
}

/** PURE: rule 1. An unknown join date is not new. */
export function joinedWithin(joinedAtMs: number | null | undefined, nowMs: number, days: number): boolean {
  if (typeof joinedAtMs !== 'number' || !Number.isFinite(joinedAtMs) || joinedAtMs <= 0) return false;
  return nowMs - joinedAtMs <= days * DAY_MS;
}

/** Why a wallet may not receive the credit — the wallet-side rules 2 and 3 plus the two guards. */
export type WalletRefusal =
  | 'no-wallet'
  | 'already-given'
  | 'banned'
  | 'merged'
  | 'has-gift-balance'
  | 'gift-ceiling';

/** PURE: the wallet-side refusal, or null when the wallet may be paid. */
export function walletRefusal(wallet: Record<string, unknown> | null | undefined): WalletRefusal | null {
  if (!wallet) return 'no-wallet';
  if (wallet.adminWelcomeGiftAt) return 'already-given';
  if (wallet.banned) return 'banned';
  if (wallet.mergedInto) return 'merged';
  if (giftRemaining(wallet as Parameters<typeof giftRemaining>[0]) > 0) return 'has-gift-balance';
  if (capSelfGift(ADMIN_WELCOME_GIFT_TOKENS, num(wallet.freeGiftedTokens)) < ADMIN_WELCOME_GIFT_TOKENS) return 'gift-ceiling';
  return null;
}

/** PURE: the same answer as a yes/no — what the transaction re-checks. */
export function welcomeGiftEligible(wallet: Record<string, unknown> | null | undefined): boolean {
  return walletRefusal(wallet) === null;
}

/** The admin's view of one press: who gets it, and why everybody else does not. */
export interface WelcomeGiftPlan {
  /** Wallet ids that will be paid, in order. */
  payIds: string[];
  checked: number;
  skipped: {
    notNew: number;
    hasGiftBalance: number;
    alreadyGiven: number;
    other: number;
  };
}

/**
 * PURE: decide one press. `joinedAtMs` answers each wallet's join date (from the same reader the
 * users list uses); wallets it cannot date are counted as not new.
 */
export function planWelcomeGift(
  wallets: Array<{ id: string } & Record<string, unknown>>,
  joinedAtMs: (id: string, wallet: Record<string, unknown>) => number | null,
  nowMs: number,
  days: number,
): WelcomeGiftPlan {
  const plan: WelcomeGiftPlan = {
    payIds: [],
    checked: 0,
    skipped: { notNew: 0, hasGiftBalance: 0, alreadyGiven: 0, other: 0 },
  };
  for (const w of wallets) {
    if (!w.id) continue;
    plan.checked++;
    // Wallet rules first: they cost nothing to read, so the join date is looked up only for the
    // accounts that could actually be paid.
    const refusal = walletRefusal(w);
    if (refusal === 'already-given') plan.skipped.alreadyGiven++;
    else if (refusal === 'has-gift-balance') plan.skipped.hasGiftBalance++;
    else if (refusal) plan.skipped.other++;
    else if (!joinedWithin(joinedAtMs(w.id, w), nowMs, days)) plan.skipped.notNew++;
    else plan.payIds.push(w.id);
  }
  return plan;
}

/**
 * PURE: may a press pay `actual` accounts when the admin confirmed `expected`? `null` = yes,
 * otherwise the refusal. A missing or malformed number is a refusal, never "no limit" — people sign
 * up between the check and the press, and "₹15,000" must never quietly become "₹18,000".
 */
export function bulkWelcomeGiftRefusal(expected: unknown, actual: number): string | null {
  const n = Number(expected);
  if (expected === undefined || expected === null || expected === '' || !Number.isInteger(n) || n < 0) {
    return 'Check the count first, then confirm it.';
  }
  if (actual > n) {
    return `${actual - n} more user(s) became eligible since you checked. Check again and confirm the new total.`;
  }
  return null;
}
