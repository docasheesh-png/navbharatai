import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  flatWelcomeGiftAllowed, weeklyTopUpAllowed, capSelfGift, capReferrerPerFriend,
  MAX_SELF_GIFT_TOKENS, MAX_REFERRER_PER_FRIEND_TOKENS, MAX_ACQUISITION_COST_TOKENS,
  retiredGiftSummary,
} from '../src/server/lib/giftPolicy';
import { welcomeGrantTokens } from '../src/server/lib/welcomeBonus';
import { decideSignupGrant, decidePhoneClaim } from '../src/server/lib/giftPlan';
import { decideWeeklyTopUp } from '../src/server/lib/weeklyTopUp';
import { decideSelfReward, decideReferrerReward } from '../src/server/lib/referralRewards';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sh = (cmd: string): string[] => {
  const { execSync } = require('child_process') as typeof import('child_process');
  return execSync(cmd, { encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
};
const rupees = (t: number) => t / TOKENS_PER_RUPEE;

/**
 * 🔴 THE ADMIN'S RULING (2026-09-17, verbatim): *"nahi welcome bonus ₹500 band karna hai! sirf refer
 * aur verification wale ₹400 dene hai. matlab mera (admin) ek user ke liye maximum = ₹475. isse 1
 * paisa jyada nahi."* and *"weekly reward, welcome reward yeh sab hatao."*
 *
 * Before this, FOUR payout paths existed that did not know about each other, and the rule that they
 * must not stack lived only as a comment. A real account could collect ₹650 of flat-and-weekly gifts
 * plus ₹400 of referral steps — over ₹1,050 — with nothing failing anywhere.
 */
describe('the ONLY way to be given money is to earn it', () => {
  it('the policy says both flat gifts and the weekly ladder are retired', () => {
    expect(flatWelcomeGiftAllowed()).toBe(false);
    expect(weeklyTopUpAllowed()).toBe(false);
  });

  /**
   * 🔒 THE RETIREMENT IS APPLIED WHERE THE MONEY MOVES, NOT INSIDE THE DECISIONS — deliberately.
   *
   * All four grant functions have exactly ONE money-moving caller (`routes/wallet.ts`), verified
   * below. Gating there keeps 836 lines of PROVEN anti-abuse logic — the ₹750 two-door hole, the
   * per-identity markers, the wallet-recreation re-grant — intact, still tested and still TRUE, so
   * re-enabling any of this later is one line with working code behind it rather than a rewrite.
   *
   * The usual objection to gating at a caller (CLAUDE.md's overdraft-floor rule: "a limit written
   * into the callers is a limit the tenth caller never gets") is answered by the caller-count test
   * below, which fails if a second one ever appears.
   */
  it('every grant is gated at the ONE place it moves money', () => {
    const w = read('src/server/routes/wallet.ts');
    expect(w).toContain("from '../lib/giftPolicy'");
    // The new-wallet grant, the phone claim, and the weekly ladder — three applications, all gated.
    // 🔴 CHANGED 2026-09-22. The new-wallet branch is no longer a flat `? 0`: it pays the ₹50 INTERIM
    // credit (admin's ruling after the Play rejection), which stands down by itself the moment the
    // referral ladder is switched on. What this assertion protects is unchanged and is the reason it
    // exists — the retirement predicate still GUARDS that branch, so re-enabling the ₹500 plan is
    // still one decision in one place, and the two applications below are untouched by the interim
    // credit. Anchored on `interimWelcomeTokens()` so a branch that started paying the RETIRED amount
    // again would fail here.
    expect(w).toMatch(/const welcomeTokens = !flatWelcomeGiftAllowed\(\)\s*\n?\s*\? \(alreadyGranted \|\| identityAlreadySpent \? 0 : interimWelcomeTokens\(\)\)/);
    expect(w).toContain("if (!flatWelcomeGiftAllowed()) return { granted: 0, reason: 'disabled' as const };");
    expect(w).toContain('const ladderRetired = !weeklyTopUpAllowed()');
  });

  it('🔒 wallet.ts is still the ONLY money-moving caller — a second one would escape the gate', () => {
    const files = sh("grep -rln 'welcomeGrantTokens(\\|decideSignupGrant(\\|decidePhoneClaim(\\|decideWeeklyTopUp(' --include='*.ts' src/server/routes src/server/lib || true");
    const callers = files
      .filter((f) => f && !f.includes('.test.'))
      // The modules that DEFINE these functions naturally mention them.
      .filter((f) => !['src/server/lib/giftPlan.ts', 'src/server/lib/weeklyTopUp.ts', 'src/server/lib/welcomeBonus.ts'].includes(f));
    expect(callers.sort()).toEqual(['src/server/routes/wallet.ts']);
  });

  it('the pure decisions are UNTOUCHED, so their abuse tests still mean something', () => {
    // If these had been gated internally they would return 0 always, and the 836 lines proving the
    // ₹750 hole is closed would be asserting nothing at all.
    const env = { WALLET_GIFT_V2: 'on' };
    expect(decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env }).tokens).toBeGreaterThan(0);
    expect(decidePhoneClaim({ giftedSoFar: 0, phoneUsed: false, env }).tokens).toBeGreaterThan(0);
    expect(welcomeGrantTokens(false)).toBeGreaterThan(0);
    expect(decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: null, createdAt: null, now: Date.now() }).grantTokens)
      .toBeGreaterThanOrEqual(0);
  });
});

describe('₹475 — "isse 1 paisa jyada nahi", enforced against the TOTAL', () => {
  it('the ceiling adds up to exactly ₹475', () => {
    expect(rupees(MAX_SELF_GIFT_TOKENS)).toBe(400);
    expect(rupees(MAX_REFERRER_PER_FRIEND_TOKENS)).toBe(75);
    expect(rupees(MAX_ACQUISITION_COST_TOKENS)).toBe(475);
  });

  it('🔴 A TUNABLE CANNOT RAISE ITS OWN CEILING — the whole point of the cap', () => {
    // 4 steps × ₹100 = ₹400 holds only while REFERRAL_STEP_TOKENS is 100. Set it to 200 in a console
    // and the same four steps would pay ₹800 with nothing objecting.
    const env = { REFERRAL_REWARDS: 'on', REFERRAL_STEP_TOKENS: String(200 * TOKENS_PER_RUPEE) };
    const atCeiling = decideSelfReward({
      step: 'email', alreadyPaidSteps: [], deviceVerified: true, platform: 'android',
      alreadyGiftedTokens: 300 * TOKENS_PER_RUPEE, env,
    });
    // ₹300 already given, ₹200 wanted → only ₹100 of room remains.
    expect(rupees(atCeiling.tokens)).toBe(100);
  });

  it('the REFERRER side is capped by the same rule, and by its own tunable', () => {
    // ₹75 is what one friend may ever be worth to their referrer. Doubling the per-step value must
    // not double that — otherwise acquiring one user costs ₹550, not ₹475.
    const env = { REFERRAL_REWARDS: 'on', REFERRER_STEP_TOKENS: String(50 * TOKENS_PER_RUPEE) };
    const r = decideReferrerReward({
      friendPaidSteps: ['email', 'mobile', 'github'],
      alreadyPaidToReferrer: [],
      referrerEarnedTokens: 0,
      env,
    });
    // 3 steps × ₹50 = ₹150 owed; ₹75 is the most this friend can ever be worth.
    expect(rupees(r.tokens)).toBe(75);
    // The full ₹150 is still REPORTED as owed-before-cap, so the admin sees the tunable is wrong
    // rather than seeing a quietly smaller number and believing it was correct.
    expect(rupees(r.owedBeforeCap)).toBe(150);
  });

  it('a refusal at the ceiling says CAP-REACHED, not "already paid"', () => {
    // Two different facts about a real person. An admin reading "already paid" for a step that was
    // never paid is reading a wrong answer to the question they asked.
    const r = decideSelfReward({
      step: 'github', alreadyPaidSteps: [], deviceVerified: true, platform: 'android',
      alreadyGiftedTokens: MAX_SELF_GIFT_TOKENS, env: { REFERRAL_REWARDS: 'on' },
    });
    expect(r.reason).toBe('cap-reached');
    expect(r.recordStep, 'nothing was paid, so nothing may be recorded as paid').toBeNull();
  });

  it('an account already at ₹400 gets nothing more, whatever step it claims', () => {
    const env = { REFERRAL_REWARDS: 'on' };
    for (const step of ['referral-code', 'email', 'mobile', 'github'] as const) {
      const r = decideSelfReward({
        step, alreadyPaidSteps: [], deviceVerified: true, platform: 'android',
        alreadyGiftedTokens: MAX_SELF_GIFT_TOKENS, env,
      });
      expect(r.tokens, `${step} paid past the ceiling`).toBe(0);
    }
  });

  it('capSelfGift is total about its input — unreadable never means unlimited', () => {
    expect(capSelfGift(100, null)).toBe(100);
    expect(capSelfGift(100, 'nonsense')).toBe(100);      // treated as 0 given, not as infinite room
    expect(capSelfGift(100, -50)).toBe(100);
    expect(capSelfGift(MAX_SELF_GIFT_TOKENS * 2, 0)).toBe(MAX_SELF_GIFT_TOKENS);
    expect(capSelfGift(0, 0)).toBe(0);
    expect(capSelfGift(NaN, 0)).toBe(0);
  });

  it('capReferrerPerFriend bounds ONE friend at ₹75, separately from the ₹1,500 lifetime cap', () => {
    // The two answer different questions: this one stops a tunable making a single friend worth more,
    // the lifetime cap stops one referrer earning for ever.
    expect(capReferrerPerFriend(MAX_REFERRER_PER_FRIEND_TOKENS * 3, 0)).toBe(MAX_REFERRER_PER_FRIEND_TOKENS);
    expect(capReferrerPerFriend(25 * TOKENS_PER_RUPEE, MAX_REFERRER_PER_FRIEND_TOKENS)).toBe(0);
  });

  it('the claim route passes the REAL lifetime total, not the step list', () => {
    // A ceiling computed from what we think was paid is not a ceiling. Asserted by name, because the
    // parameter is optional and a caller that forgets it silently loses the cap.
    expect(read('src/server/routes/referral.ts')).toContain('alreadyGiftedTokens:');
  });
});

/**
 * THE OTHER HALF OF RETIRING A GIFT: the SCREEN has to stand down with the money.
 *
 * Stopping the grant alone would leave `FreeGiftBanner` drawing a "Claim ₹500" card whose button
 * calls a route that now refuses — a promise the product cannot keep, shown at the exact moment a
 * user is looking at their empty balance. That is worse than the old policy, not better.
 */
describe('the retired gift is invisible, not shown in zeroes', () => {
  it('reports a cap of 0, which is what makes the banner render NOTHING', () => {
    // FreeGiftBanner's first line: `if (!freeGift || !Number.isFinite(capTokens) || capTokens <= 0) return null`.
    const summary = retiredGiftSummary(0);
    expect(summary.capTokens).toBe(0);
    expect(summary.remainingTokens).toBe(0);
    expect(summary.nextCreditAt).toBeNull();
    expect(summary.plan).toBe('retired');
  });

  it('never offers a claimable phone bonus, whatever the account holds', () => {
    for (const held of [0, 25_000, 50_000, 65_000, -1, NaN, 'nonsense', undefined]) {
      expect(retiredGiftSummary(held).phoneBonusClaimable, String(held)).toBe(0);
    }
  });

  it('still reports what the account REALLY received — retiring a gift never rewrites history', () => {
    expect(retiredGiftSummary(65_000).giftedTokens).toBe(65_000);
    // Unreadable means 0 given, never a number invented to fill the field.
    expect(retiredGiftSummary('nonsense').giftedTokens).toBe(0);
    expect(retiredGiftSummary(-500).giftedTokens).toBe(0);
  });

  it('the wallet route reaches this summary through ONE door, so it cannot be bypassed', () => {
    // `v2GiftSummary` is the only thing the route calls; it defers here when the gift is off. A
    // second, ungated path is how the claim card would come back without anything failing.
    const src = read('src/server/routes/wallet.ts');
    expect(src).toMatch(/if \(!flatWelcomeGiftAllowed\(\)\) return retiredGiftSummary\(data\.freeGiftedTokens\);/);
    // And the NEW-wallet response must not print the ₹650 ladder either.
    expect(src).toMatch(/freeGift: !weeklyTopUpAllowed\(\)[\s\S]{0,120}v2GiftSummary\(createdWallet/);
  });

  it('a signup that pays nothing does not stamp a receipt saying it did', () => {
    // `phoneVerifiedGift` reads back as "this person has had their phone gift". Writing it on a
    // 0-token signup would lock them out of a gift they never received if it is ever re-enabled.
    expect(read('src/server/routes/wallet.ts'))
      .toMatch(/phoneVerifiedGift = welcomeTokens > 0 && v2Grant\.reason === 'verified-signup'/);
  });
});
