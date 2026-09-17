import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { flatWelcomeGiftSuppressed } from '../src/server/lib/welcomeGiftExclusion';
import { decideSignupGrant, decidePhoneClaim } from '../src/server/lib/giftPlan';
import { welcomeGrantTokens } from '../src/server/lib/welcomeBonus';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * 🔴 THE HOLE THIS CLOSES (2026-09-17, found while answering "what do I write in Cloud Run?").
 *
 * `referralRewards.ts` states the rule in its own words: *"The two plans must never both pay:
 * together they would hand one person ₹500 + ₹400."* That sentence was a COMMENT, enforced by
 * nothing. The plans are gated by two INDEPENDENT env keys — `WALLET_GIFT_V2` and
 * `REFERRAL_REWARDS` — and neither read the other.
 *
 * Setting the second while the first was on would have paid every new user ₹900 and every referrer
 * ₹75 on top: ₹975 per referred user against a plan costed at ₹475 — with nothing failing, and no
 * number on any screen looking wrong.
 */
const OFF: NodeJS.ProcessEnv = {};
const LADDER_ON: NodeJS.ProcessEnv = { REFERRAL_REWARDS: 'on' };
const V2_ON: NodeJS.ProcessEnv = { WALLET_GIFT_V2: 'on' };
const BOTH: NodeJS.ProcessEnv = { WALLET_GIFT_V2: 'on', REFERRAL_REWARDS: 'on' };

describe('flatWelcomeGiftSuppressed — one welcome gift per person', () => {
  it('the flat gift stands down exactly when the referral ladder is paying', () => {
    expect(flatWelcomeGiftSuppressed(LADDER_ON)).toBe(true);
    expect(flatWelcomeGiftSuppressed(OFF)).toBe(false);
  });

  it('🔒 SAFE DIRECTION: with the ladder unset, nothing changes at all', () => {
    // This is what makes the guard shippable without a decision from anyone: today's behaviour is
    // byte-for-byte preserved, and the rule can only ever REMOVE a double payment.
    expect(flatWelcomeGiftSuppressed({})).toBe(false);
    expect(flatWelcomeGiftSuppressed({ REFERRAL_REWARDS: 'off' })).toBe(false);
    expect(flatWelcomeGiftSuppressed({ REFERRAL_REWARDS: '' })).toBe(false);
  });
});

describe('🔴 THE BUG: both plans paying the same person', () => {
  it('GIFT PLAN v2 pays nothing once the ladder is on', () => {
    const before = decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: V2_ON });
    expect(before.tokens, 'v2 should pay while the ladder is off').toBeGreaterThan(0);

    const after = decideSignupGrant({ phoneVerified: true, emailUsed: false, phoneUsed: false, env: BOTH });
    expect(after.tokens, 'v2 must NOT pay on top of the ladder').toBe(0);
  });

  it('the PHONE CLAIM is the second half of the same ₹500 and stands down too', () => {
    // Gating only the signup grant would leave this route paying the remainder — the same hole,
    // reached by a different door.
    expect(decidePhoneClaim({ giftedSoFar: 0, phoneUsed: false, env: V2_ON }).tokens).toBeGreaterThan(0);
    expect(decidePhoneClaim({ giftedSoFar: 0, phoneUsed: false, env: BOTH }).tokens).toBe(0);
  });

  it('the LEGACY flat bonus stands down too — whichever plan is live, the ladder stacked on it', () => {
    // welcomeBonus is the surface that runs while WALLET_GIFT_V2 is OFF. A fix applied only to v2
    // would have left this one paying, which is why the rule lives in its own module.
    expect(welcomeGrantTokens(false, OFF), 'legacy bonus pays while the ladder is off').toBeGreaterThan(0);
    expect(welcomeGrantTokens(false, LADDER_ON), 'legacy bonus must NOT pay on top of the ladder').toBe(0);
  });

  it('an already-granted wallet still gets nothing — the old idempotence is untouched', () => {
    expect(welcomeGrantTokens(true, OFF)).toBe(0);
    expect(welcomeGrantTokens(true, LADDER_ON)).toBe(0);
  });
});

describe('🔒 every flat-gift decision point asks — a caller that forgets is the way back in', () => {
  it('all three surfaces consult the shared rule', () => {
    // Asserted by NAME rather than trusted, because the whole defect was a rule that existed only as
    // prose. A fourth grant path added later must appear here too.
    for (const f of ['src/server/lib/giftPlan.ts', 'src/server/lib/welcomeBonus.ts']) {
      expect(read(f), `${f} must consult flatWelcomeGiftSuppressed`).toContain('flatWelcomeGiftSuppressed');
    }
  });

  it('the rule reads the REFERRAL flag, so the two can never disagree about who is paying', () => {
    expect(read('src/server/lib/welcomeGiftExclusion.ts')).toContain('referralRewardsEnabled');
  });
});
