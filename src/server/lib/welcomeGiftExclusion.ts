// ONE WELCOME GIFT PER PERSON — the rule three modules state and none of them enforced.
//
// 🔴 THE HOLE (found 2026-09-17, while answering "what do I write in Cloud Run?"). `referralRewards.ts`
// says it in its own words:
//
//     "The two plans must never both pay: together they would hand one person ₹500 + ₹400."
//
// That sentence is a COMMENT. Nothing in the code enforced it. The two plans are gated by two
// INDEPENDENT env keys — `WALLET_GIFT_V2` for the flat welcome gift and `REFERRAL_REWARDS` for the
// referral ladder — and neither reads the other. Setting the second while the first is on would have
// handed every new user ₹900 and every referrer ₹75 on top: **₹975 per referred user against a plan
// costed at ₹475**, with nothing failing and no number anywhere looking wrong.
//
// ⚠️ AND THERE ARE THREE GRANT SURFACES, NOT TWO — which is why this lives in its own module rather
// than as an `if` inside one of them:
//   • `welcomeBonus.ts`  — the LEGACY flat bonus (`WELCOME_BONUS_TOKENS`), live while v2 is off
//   • `giftPlan.ts`      — the v2 plan (₹250 / ₹500), live while `WALLET_GIFT_V2` is on
//   • `referralRewards.ts` — the ladder (₹100 × 4, plus ₹25 × 3 to the referrer)
// Whichever welcome plan is active, the referral ladder stacks on top of it. A fix written into one
// of them would leave the other paying.
//
// 🔑 WHICH ONE WINS, AND WHY IT IS THE REFERRAL LADDER. The ladder was designed as a REPLACEMENT, not
// an addition — its own plan says so: a referred user earns ₹400 and an organic one ₹300, both
// deliberately at or below the ₹500 flat gift they replace. So when referral rewards are on, the
// ladder IS the welcome gift and the flat grant stands down.
//
// 🔒 THE DIRECTION OF THE GUARD IS THE SAFE ONE. With `REFERRAL_REWARDS` unset — today, and until an
// admin decides otherwise — this returns `false` and every existing grant path behaves byte for byte
// as it does now. It can only ever REMOVE a double payment, never introduce one.
//
// PURE — env in, decision out.

import { referralRewardsEnabled } from './referralRewards';

/**
 * Should the FLAT welcome gift stand down because the referral ladder is paying instead?
 *
 * Asked by every flat-gift decision point. A caller that forgets to ask keeps today's behaviour, which
 * is why `tests/welcomeGiftExclusion.test.ts` asserts the call sites by name rather than trusting that
 * a future grant path will remember.
 */
export function flatWelcomeGiftSuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
  return referralRewardsEnabled(env);
}

/** What the user is told, when anything needs to say it. Never "disabled" — they are not losing money. */
export const LADDER_REPLACES_FLAT_GIFT =
  'Your welcome credit now comes from the referral steps — verify your email, mobile and GitHub to claim it.';
