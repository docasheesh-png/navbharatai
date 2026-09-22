// ₹50 FOR A NEW ACCOUNT — the INTERIM welcome credit, live only until the referral ladder pays.
//
// 🔴 WHY IT EXISTS, AND IT COST A PLAY RELEASE (2026-09-22). Google rejected the Android release under
// the **Broken Functionality** policy. Their label reads *"Loading problems: Your app doesn't open or
// load"*, but their own evidence screenshots show the app OPEN, on the AI Image Generator, carrying
// *"Image generation failed — please try again"* three times. The chain behind that, verified in code
// rather than reasoned about:
//
//   1. a brand-new account receives ₹0      — `flatWelcomeGiftAllowed()` is a hardcoded `false`
//                                             (2026-09-17) and `weeklyTopUpAllowed()` likewise, while
//                                             `REFERRAL_REWARDS` — the ladder meant to pay instead —
//                                             is deliberately unset until the app is live on Play;
//   2. free images come from Pollinations   — a keyless third-party service with no SLA;
//   3. when it fails the ladder falls to a PAID rung;
//   4. `gateToolAction` refuses a paid rung on an empty wallet (402).
//
// So a new user's image generation worked ONLY while a free third party happened to be up, and had no
// path at all when it was not. **A Play reviewer is exactly that user.** Worse, it was a deadlock: the
// referral ladder was gated on being live on Play, and Play would not pass because a new account
// could not use the product.
//
// 🔑 THE ADMIN'S RULING (2026-09-22, verbatim): *"new account me 50₹ credit do. jab tak, refral system
// activate na hota hai, tab tak. uske baad 100x4=400 denge.(after refral system activation)"*
//
// ⚠️ THIS IS A SCOPED REVERSAL OF THE 2026-09-17 RULING, NOT ITS CANCELLATION — and the distinction is
// the whole design. That ruling retired a ₹500 plan paid in TWO stages (₹250 at signup, ₹250 more on
// phone verification) plus a weekly ladder. **None of that comes back.** `flatWelcomeGiftAllowed()`
// stays a hardcoded `false`, so the phone-bonus claim route and the v2 summary stand down exactly as
// they do today. What this module adds is a SEPARATE, smaller, signup-only grant.
//
// 🔒 RE-ENABLING THE OLD PREDICATE WOULD HAVE BEEN THE BUG. `flatWelcomeGiftAllowed()` gates three
// things, not one: the signup grant, the ₹250 PHONE bonus (`routes/wallet.ts`, the claim route) and
// the v2 gift summary. Flipping it to reach the first would silently re-open a ₹250 claim the admin
// retired — fixing one problem by creating another, which this repo's core rules forbid outright.
//
// 🔒 IT STANDS DOWN BY ITSELF. The moment `REFERRAL_REWARDS` is on, `flatWelcomeGiftSuppressed()` —
// the module that already owns the question *"is the ladder paying instead?"* — returns true and this
// grant returns 0, with no second copy of that rule and nothing for anyone to remember to switch off.
// That is precisely the admin's "jab tak … tab tak".
//
// 🔒 AND IT COUNTS AGAINST THE ₹400 CEILING. The grant goes through `capSelfGift`, and
// `buildInitialWallet` records it in `freeGiftedTokens` in the same write — so a user who takes ₹50
// today and later earns referral steps tops out at ₹400 in total, never ₹450. The admin's standing
// "kaise bhi jaye, maximum ₹400!!!" survives this change untouched.
//
// ⚠️ NO IMPORT CYCLE, and that is why this is its own file rather than three lines in `giftPolicy.ts`:
// `referralRewards.ts` already imports `giftPolicy.ts`, so a `giftPolicy → welcomeGiftExclusion →
// referralRewards → giftPolicy` edge would close a real cycle. This module imports both and is
// imported only by the route.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { capSelfGift, MAX_SELF_GIFT_TOKENS } from './giftPolicy';
import { flatWelcomeGiftSuppressed } from './welcomeGiftExclusion';

/** ₹50, the admin's number, in tokens. */
export const INTERIM_WELCOME_INR = 50;
export const INTERIM_WELCOME_TOKENS = INTERIM_WELCOME_INR * TOKENS_PER_RUPEE;

/**
 * The grant size, env-tunable without a deploy (`INTERIM_WELCOME_TOKENS`, in TOKENS).
 *
 * ⚠️ AN UNREADABLE VALUE FALLS BACK TO ₹50 — never to zero and never to unlimited. `Number('')` is
 * **0**, not NaN, so a key present-but-empty in a console (a cleared field, a dropped paste) would
 * otherwise read as a deliberate "give nobody anything" and silently restore the very bug this module
 * exists to close. An explicit `0` IS honoured: nobody types a zero by accident.
 *
 * Clamped to the ₹400 lifetime ceiling, so this tunable can never raise its own roof — the same
 * failure mode `MAX_SELF_GIFT_TOKENS` was written to prevent.
 */
export function interimWelcomeTokenAmount(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INTERIM_WELCOME_TOKENS;
  if (raw === undefined || String(raw).trim() === '') return INTERIM_WELCOME_TOKENS;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return INTERIM_WELCOME_TOKENS;
  return Math.min(Math.floor(n), MAX_SELF_GIFT_TOKENS);
}

/**
 * Is the interim grant live? Only while the referral ladder is NOT paying.
 *
 * Asks `flatWelcomeGiftSuppressed` rather than reading `REFERRAL_REWARDS` again: one definition of
 * "the ladder is paying instead", so the two can never disagree about which plan is in force.
 */
export function interimWelcomeGiftAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !flatWelcomeGiftSuppressed(env);
}

/**
 * What a BRAND-NEW wallet receives. `alreadyGifted` is what this account has been given before —
 * zero for a genuinely new wallet, and passed rather than assumed so a re-created wallet document
 * cannot collect a second time.
 */
export function interimWelcomeTokens(
  alreadyGifted: unknown = 0,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!interimWelcomeGiftAllowed(env)) return 0;
  return capSelfGift(interimWelcomeTokenAmount(env), alreadyGifted);
}
