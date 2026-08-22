// THE FREE GIFT, v2 (admin 2026-08-21) — two doors, one destination, one gift per person.
//
//     Phone OTP se sign up          →  ₹500 turant
//     Email / Google se sign up     →  ₹250, phir number verify karne par +₹250  =  ₹500
//
// and the weekly ladder is GONE for accounts on this plan.
//
// WHY THESE SHAPES, so a later session does not "simplify" the reasoning away:
//
// • WHY ₹250 UNVERIFIED, NOT LESS. `payments.ts` records that ₹250 is what funds a COMPLETE first
//   app. Trimming the first rung to save money buys the worst outcome available: a first app that
//   dies half-built. A fraudster costs ~₹62; a broken first impression costs a customer's lifetime.
//
// • WHY THE ASK COMES LATER, NOT AT SIGN-UP. Nothing is demanded before the user has anything. They
//   sign up, they build, and the number is asked for at the moment their balance runs out — i.e. the
//   moment they most want more. We never pick that moment; their own use does.
//
// • WHY THE WEEKLY LADDER GOES. Beyond the code it costs, it competed with revenue: a user whose
//   balance hit zero and who knew ₹200 was arriving in three days had a reason to WAIT rather than
//   recharge. On this plan an empty balance offers two doors, and both are good for us: give a
//   number, or pay.
//
// • WHY THIS IS BOUND TO THE PHONE AND NOT THE ACCOUNT. Without a single per-number marker shared by
//   BOTH doors, one number yields ₹750: sign up by phone (₹500), open a second account by email
//   (₹250), then verify it with the SAME number (+₹250). `decidePhoneClaim` refuses a number that has
//   been used, whichever door used it.
//
// HONEST LIMIT, stated once so nobody mistakes this for a solved problem: this does not make abuse
// impossible. A virtual number costs ₹20-80, so ₹500 of credit remains buyable. It makes abuse
// UNPROFITABLE and slow, and it caps an unverified account at ₹250 instead of ₹650. That is the win
// condition — not "impossible".
//
// Pure + fully unit-tested. Callers own persistence and the "has this identity been used?" lookups.

import { TOKENS_PER_RUPEE } from './payments';
import { parseEnvFlag } from './envFlag';

/**
 * Master switch. Default OFF — while off, every wallet keeps today's ₹250 + weekly-ladder behaviour
 * byte for byte, so this whole module is inert until the admin flips it in Cloud Run.
 *
 * ⚠️ DO NOT flip this on before the OTP send limits are durable. They live in an in-process Map
 * (`routes/auth.ts`), and Cloud Run runs several instances and recycles them, so the real ceiling is
 * far higher than the 5/hour it appears to be. With ₹500 payable on a single verification, that gap
 * is worth scripting against.
 */
export function giftPlanV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag((env.WALLET_GIFT_V2 || '').trim().toLowerCase()) === true;
}

function tokensFromEnv(raw: string | undefined, fallbackRupees: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallbackRupees * TOKENS_PER_RUPEE;
}

/** What an account gets WITHOUT a verified phone. ₹250 — enough for one complete app. */
export function unverifiedGiftTokens(env: NodeJS.ProcessEnv = process.env): number {
  return tokensFromEnv(env.GIFT_UNVERIFIED_TOKENS, 250);
}

/**
 * The TOTAL an account may ever be gifted once a phone is verified. ₹500 — not "₹500 more".
 * Expressing the verified tier as a total is what makes both doors land in the same place and makes
 * the top-up self-correcting: whatever an account already holds, verifying tops it up to here.
 */
export function verifiedGiftTotalTokens(env: NodeJS.ProcessEnv = process.env): number {
  return tokensFromEnv(env.GIFT_VERIFIED_TOTAL_TOKENS, 500);
}

export type GrantReason =
  | 'verified-signup'      // signed up with a verified phone → the full total, at once
  | 'unverified-signup'    // email/Google → the first tier
  | 'phone-claim'          // verified later → topped up to the verified total
  | 'identity-used'        // this mailbox or this number has had its gift already
  | 'already-at-total'     // nothing owed; the account is at or above the verified total
  | 'disabled';            // v2 is off

export interface SignupGrant {
  tokens: number;
  /** Write a marker for the mailbox — it has now consumed its gift. */
  markEmail: boolean;
  /** Write a marker for the number — it has now consumed its gift. */
  markPhone: boolean;
  reason: GrantReason;
}

/**
 * What a BRAND-NEW wallet is granted.
 *
 * `emailUsed` / `phoneUsed` are the caller's lookups against the durable markers — both must be
 * checked before granting, and a used identity yields ZERO rather than a reduced amount, because a
 * partial re-grant is still a re-grant.
 */
export function decideSignupGrant(input: {
  phoneVerified: boolean;
  emailUsed: boolean;
  phoneUsed: boolean;
  env?: NodeJS.ProcessEnv;
}): SignupGrant {
  const env = input.env ?? process.env;
  if (!giftPlanV2Enabled(env)) return { tokens: 0, markEmail: false, markPhone: false, reason: 'disabled' };

  if (input.phoneVerified) {
    // A used NUMBER blocks the full tier even when the mailbox is fresh — the number is the scarce
    // thing, and letting a fresh email re-open it would be the ₹750 hole.
    if (input.phoneUsed) return { tokens: 0, markEmail: false, markPhone: false, reason: 'identity-used' };
    return {
      tokens: verifiedGiftTotalTokens(env),
      // The mailbox is spent too: otherwise this person could sign out and take the ₹250 tier again
      // on the same address.
      markEmail: true,
      markPhone: true,
      reason: 'verified-signup',
    };
  }

  if (input.emailUsed) return { tokens: 0, markEmail: false, markPhone: false, reason: 'identity-used' };
  return { tokens: unverifiedGiftTokens(env), markEmail: true, markPhone: false, reason: 'unverified-signup' };
}

export interface PhoneClaim {
  tokens: number;
  reason: GrantReason;
}

/**
 * What an EXISTING wallet is granted when its owner verifies a phone.
 *
 * Deliberately a TOP-UP to the verified total, never a flat "+₹250":
 *  • an account already at or above the total (an old ladder account that reached ₹650) gets ZERO,
 *    and nothing is ever taken back from it;
 *  • an account that somehow received nothing gets the whole total;
 *  • so no arithmetic path can pay a person twice for one number.
 */
export function decidePhoneClaim(input: {
  giftedSoFar: number;
  phoneUsed: boolean;
  env?: NodeJS.ProcessEnv;
}): PhoneClaim {
  const env = input.env ?? process.env;
  if (!giftPlanV2Enabled(env)) return { tokens: 0, reason: 'disabled' };
  if (input.phoneUsed) return { tokens: 0, reason: 'identity-used' };

  const already = Number.isFinite(input.giftedSoFar) && input.giftedSoFar > 0 ? Math.floor(input.giftedSoFar) : 0;
  const owed = verifiedGiftTotalTokens(env) - already;
  if (owed <= 0) return { tokens: 0, reason: 'already-at-total' };
  return { tokens: owed, reason: 'phone-claim' };
}

/**
 * The honest line for a claim that paid nothing. A refusal reaches REAL people — one handset in a
 * family, someone locked out of an older account — so it never accuses anyone of anything, and it
 * never implies their account is in trouble. The account keeps working; only the money is once.
 */
export function claimRefusalMessage(reason: GrantReason): string {
  switch (reason) {
    case 'identity-used':
      return 'This number has already claimed its welcome bonus. Your account works normally — the bonus is just once per number.';
    case 'already-at-total':
      return 'Your account has already received its full welcome bonus.';
    case 'disabled':
      return 'Bonus claims are not open right now.';
    default:
      return 'No bonus was added.';
  }
}
