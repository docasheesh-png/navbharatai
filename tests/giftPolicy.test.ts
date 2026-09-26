import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  capSelfGift, capReferrerPerFriend,
  MAX_SELF_GIFT_TOKENS, MAX_REFERRER_PER_FRIEND_TOKENS, MAX_ACQUISITION_COST_TOKENS,
} from '../src/server/lib/giftPolicy';
import { decideSelfReward, decideReferrerReward } from '../src/server/lib/referralRewards';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const rupees = (t: number) => t / TOKENS_PER_RUPEE;

/**
 * 🔴 THE ADMIN'S RULING (2026-09-17, verbatim): *"nahi welcome bonus ₹500 band karna hai! sirf refer
 * aur verification wale ₹400 dene hai. matlab mera (admin) ek user ke liye maximum = ₹475. isse 1
 * paisa jyada nahi."* On 2026-09-26 every other grant was deleted from the code
 * (`theReferralLadderIsTheOnlyGift.test.ts`); what is left here is the ceiling on the one that remains.
 */
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
