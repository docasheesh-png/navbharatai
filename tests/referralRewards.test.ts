import { describe, it, expect } from 'vitest';
import {
  decideSelfReward, decideReferrerReward, decideAttribution, attributionRefusalMessage,
  selfProgress, readSteps, ALL_STEPS, REFERRER_PAYING_STEPS,
  referralRewardsEnabled, stepRewardTokens, referrerStepTokens, referrerLifetimeCapTokens,
  friendVerificationStatus,
  type RewardStep,
} from '../src/server/lib/referralRewards';

/**
 * The referral reward ledger. These tests are written as the ATTACKS the design exists to stop,
 * because the arithmetic is the easy half — a reward system fails at its edges, not its centre.
 */

const ON = { REFERRAL_REWARDS: 'on' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

/** The ordinary, honest case: an Android user on a verified device. */
const android = (over: Partial<Parameters<typeof decideSelfReward>[0]> = {}) => decideSelfReward({
  step: 'email', alreadyPaidSteps: [], deviceVerified: true, platform: 'android', env: ON, ...over,
});

describe('the master switch', () => {
  it('is OFF by default, and OFF pays zero on every path', () => {
    expect(referralRewardsEnabled(OFF)).toBe(false);
    expect(android({ env: OFF }).tokens).toBe(0);
    expect(android({ env: OFF }).reason).toBe('disabled');
    expect(decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: OFF,
    }).tokens).toBe(0);
    expect(decideAttribution({
      codeOwnerUserId: 'A', newUserId: 'B', deviceId: 'd1', referrerDeviceIds: [],
      alreadyReferred: false, deviceAlreadyReferred: false, isNewUser: true,
      platform: 'android', env: OFF,
    }).ok).toBe(false);
  });

  it('accepts the values an admin actually types, and a typo means OFF — never ON', () => {
    for (const v of ['on', 'ON', ' on ', 'true', '1', 'yes']) {
      expect(referralRewardsEnabled({ REFERRAL_REWARDS: v } as NodeJS.ProcessEnv), v).toBe(true);
    }
    for (const v of ['off', 'false', '0', 'ture', 'no', '']) {
      expect(referralRewardsEnabled({ REFERRAL_REWARDS: v } as NodeJS.ProcessEnv), v).toBe(false);
    }
  });
});

describe('the amounts are the admin-approved plan', () => {
  it('₹100 a step for the new user, ₹25 a step for the referrer, ₹1,500 lifetime cap', () => {
    expect(stepRewardTokens(OFF)).toBe(10_000);       // ₹100
    expect(referrerStepTokens(OFF)).toBe(2_500);      // ₹25
    expect(referrerLifetimeCapTokens(OFF)).toBe(150_000); // ₹1,500
  });

  it('a new user completing all four steps receives exactly ₹400', () => {
    let paid: RewardStep[] = [];
    let total = 0;
    for (const step of ALL_STEPS) {
      const r = android({ step, alreadyPaidSteps: paid });
      total += r.tokens;
      if (r.recordStep) paid = [...paid, r.recordStep];
    }
    expect(total).toBe(40_000);
    expect(paid).toHaveLength(4);
  });

  it('a referrer receives exactly ₹75 for one fully-verified friend — and ₹0 for the code itself', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON,
    });
    expect(r.tokens).toBe(7_500);
    expect(r.recordSteps).not.toContain('referral-code');
    expect(new Set(r.recordSteps)).toEqual(new Set(REFERRER_PAYING_STEPS));
  });

  it('one referred user costs ₹475 in total — below today’s flat ₹500 gift', () => {
    expect(4 * stepRewardTokens(OFF) + 3 * referrerStepTokens(OFF)).toBe(47_500);
  });

  it('🔴 A BLANK env value means UNSET, not zero — the defect this suite caught before it shipped', () => {
    // `Number('')` is 0, not NaN. The first version of tokensFromEnv therefore read a key that was
    // PRESENT BUT EMPTY in Cloud Run — a cleared field, a dropped copy-paste, a variable set from an
    // unset shell var — as a deliberate zero. On the cap that is "no referrer ever earns anything,
    // for ever", with the console showing the key as configured and nothing failing anywhere.
    for (const blank of ['', ' ', '   ', '\t']) {
      expect(referrerLifetimeCapTokens({ REFERRER_LIFETIME_CAP_TOKENS: blank } as NodeJS.ProcessEnv), JSON.stringify(blank)).toBe(150_000);
      expect(stepRewardTokens({ REFERRAL_STEP_TOKENS: blank } as NodeJS.ProcessEnv), JSON.stringify(blank)).toBe(10_000);
      expect(referrerStepTokens({ REFERRER_STEP_TOKENS: blank } as NodeJS.ProcessEnv), JSON.stringify(blank)).toBe(2_500);
    }
  });

  it('a malformed cap falls back to ₹1,500, never to "no cap"', () => {
    for (const v of ['1500%', 'lots', '-1', 'NaN', '']) {
      expect(referrerLifetimeCapTokens({ REFERRER_LIFETIME_CAP_TOKENS: v } as NodeJS.ProcessEnv), v).toBe(150_000);
    }
    // An explicit 0 is a real, deliberate value and is honoured.
    expect(referrerLifetimeCapTokens({ REFERRER_LIFETIME_CAP_TOKENS: '0' } as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('🔒 RULE 1 — the full ₹400 ladder is Android-only and device-verified', () => {
  it('pays nothing without device proof, even on Android', () => {
    const r = android({ deviceVerified: false });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('device-unverified');
  });

  it('an unverified device is refused BEFORE the already-paid check, so no step is consumed', () => {
    // Ordering matters: recording a step against a refusal would burn it for the honest retry.
    const r = android({ deviceVerified: false, step: 'email', alreadyPaidSteps: [] });
    expect(r.recordStep).toBeNull();
  });

  it('pays nothing on iOS — the device check is an Android capability, and iOS has no web sub-path', () => {
    expect(android({ platform: 'ios' }).reason).toBe('not-android');
  });
});

// The WEB path — added 2026-09-26 (admin: "website par github aur mobile verification par 100-100,
// maximum 100 only"). This REVERSES the old "no web path at all" rule for exactly two steps, under a
// ₹100 website ceiling. The full ₹400 ladder stays Android + device-verified; the web is a small,
// bounded trial so a website-only user is not stranded at ₹0 and unable to build even once.
const web = (over: Partial<Parameters<typeof decideSelfReward>[0]> = {}) => decideSelfReward({
  step: 'github', alreadyPaidSteps: [], deviceVerified: false, platform: 'web',
  alreadyGiftedTokens: 0, alreadyWebGiftedTokens: 0, env: ON, ...over,
});

describe('🔒 the website earns only mobile + github, capped at ₹100', () => {
  it('pays ₹100 for a github or mobile verification on the web, with no device check', () => {
    for (const step of ['github', 'mobile'] as RewardStep[]) {
      const r = web({ step });
      expect(r.reason, step).toBe('granted');
      expect(r.tokens, step).toBe(10_000); // ₹100
      expect(r.web, step).toBe(true);
      expect(r.recordStep, step).toBe(step);
    }
  });

  it('refuses the Android-only steps on the web — gmail-login and the referral code never pay here', () => {
    for (const step of ['email', 'referral-code'] as RewardStep[]) {
      const r = web({ step });
      expect(r.tokens, step).toBe(0);
      expect(r.reason, step).toBe('web-not-eligible');
      expect(r.recordStep, step).toBeNull();
    }
  });

  it('caps the WHOLE website at ₹100 — a second web step after ₹100 already earned pays nothing', () => {
    const r = web({ step: 'mobile', alreadyWebGiftedTokens: 10_000 });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('web-cap-reached');
  });

  it('the web still obeys the ₹400 lifetime self-cap — an account already at ₹400 earns ₹0 on the web', () => {
    const r = web({ step: 'github', alreadyGiftedTokens: 40_000, alreadyWebGiftedTokens: 0 });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('cap-reached'); // the ₹400 total, not the ₹100 web slice, is what bit
  });

  it('the ₹100 web grant is a SUB-cap: the same account can still earn the remaining ₹300 on Android', () => {
    const r = android({ step: 'mobile', alreadyGiftedTokens: 10_000 });
    expect(r.reason).toBe('granted');
    expect(r.tokens).toBe(10_000);
  });
});

describe('🔒 a step pays once, ever', () => {
  it('refuses a step already paid, and records nothing', () => {
    const r = android({ step: 'email', alreadyPaidSteps: ['email'] });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('already-paid');
    expect(r.recordStep).toBeNull();
  });

  it('a corrupted or hostile step list cannot unlock or block anything', () => {
    expect(readSteps(null)).toEqual([]);
    expect(readSteps('email')).toEqual([]);
    expect(readSteps(['email', 'email', 'nonsense', 42, null])).toEqual(['email']);
    // Junk in the store must not read as "already paid" and lock an honest user out of their money.
    expect(android({ step: 'email', alreadyPaidSteps: ['EMAIL', 'e-mail'] }).tokens).toBe(10_000);
  });
});

describe('🔒 RULE 2 — the referrer is paid for verifications, never for a redemption', () => {
  it('a friend who only typed the code earns the referrer nothing', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ['referral-code'], alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON,
    });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('nothing-owed');
  });

  it('the code step is never payable to the referrer even alongside real verifications', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: ['email', 'github'],
      referrerEarnedTokens: 0, env: ON,
    });
    expect(r.recordSteps).toEqual(['mobile']);
    expect(r.tokens).toBe(2_500);
  });
});

describe('🔒 RULE 3 — nothing is released until the friend verifies a real mobile', () => {
  it('email + github without a mobile pays zero, and says it is held rather than owed', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ['referral-code', 'email', 'github'], alreadyPaidToReferrer: [],
      referrerEarnedTokens: 0, env: ON,
    });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('held-until-mobile');
    expect(r.recordSteps).toEqual([]);
  });

  it('the mobile releases the held rungs in the SAME call — no separate release path to forget', () => {
    const before = { friendPaidSteps: ['email', 'github'], alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON };
    expect(decideReferrerReward(before).tokens).toBe(0);
    const after = decideReferrerReward({ ...before, friendPaidSteps: ['email', 'github', 'mobile'] });
    expect(after.tokens).toBe(7_500);
    expect(new Set(after.recordSteps)).toEqual(new Set(['email', 'github', 'mobile']));
  });

  it('is order-independent and repeat-safe — the whole point of reconciling over state', () => {
    const orders: RewardStep[][] = [
      ['email', 'github', 'mobile'],
      ['mobile', 'email', 'github'],
      ['github', 'mobile', 'email'],
    ];
    for (const order of orders) {
      let done: RewardStep[] = [];
      let paidToReferrer: RewardStep[] = [];
      let total = 0;
      for (const step of order) {
        done = [...done, step];
        // Called twice on purpose: a retried request must pay nothing the second time.
        for (let i = 0; i < 2; i++) {
          const r = decideReferrerReward({
            friendPaidSteps: done, alreadyPaidToReferrer: paidToReferrer, referrerEarnedTokens: total, env: ON,
          });
          total += r.tokens;
          paidToReferrer = [...paidToReferrer, ...r.recordSteps];
        }
      }
      expect(total, order.join('>')).toBe(7_500);
    }
  });
});

describe('🔒 RULE 4 — the ₹1,500 lifetime cap', () => {
  it('pays nothing once the cap is reached, and still reports what was owed', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 150_000, env: ON,
    });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('cap-reached');
    expect(r.owedBeforeCap).toBe(7_500);
  });

  it('pays only the remaining room when the cap bites mid-friend', () => {
    const r = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 149_000, env: ON,
    });
    expect(r.tokens).toBe(1_000);            // ₹10 of room, not the full ₹75
    expect(r.owedBeforeCap).toBe(7_500);
    // Every step it was computed from is recorded, or the remainder is re-offered for ever.
    expect(r.recordSteps).toHaveLength(3);
  });

  it('THE FARM IS BOUNDED: twenty friends earn ₹1,500 and the twenty-first earns ₹0', () => {
    let earned = 0;
    const perFriend: number[] = [];
    for (let friend = 0; friend < 25; friend++) {
      const r = decideReferrerReward({
        friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: earned, env: ON,
      });
      earned += r.tokens;
      perFriend.push(r.tokens);
    }
    expect(earned).toBe(150_000);
    expect(perFriend[19]).toBe(7_500);
    expect(perFriend[20]).toBe(0);
    expect(perFriend[24]).toBe(0);
  });

  it('the cap counts what was EVER PAID, so spending the balance never re-opens it', () => {
    // The mistake weeklyTopUp.ts records: a cap measured against a BALANCE is refunded on every
    // spend. `referrerEarnedTokens` is a lifetime total and nothing here reads a balance.
    const atCap = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 150_000, env: ON,
    });
    expect(atCap.tokens).toBe(0);
    const stillAtCap = decideReferrerReward({
      friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 150_000, env: ON,
    });
    expect(stillAtCap.tokens).toBe(0);
  });
});

describe('🔒 attribution — the chain machine, blocked at the door', () => {
  const base = {
    codeOwnerUserId: 'A', newUserId: 'B', deviceId: 'device-2', referrerDeviceIds: ['device-1'],
    alreadyReferred: false, deviceAlreadyReferred: false, isNewUser: true,
    platform: 'android' as const, env: ON,
  };

  it('accepts a genuine referral', () => {
    expect(decideAttribution(base)).toEqual({ ok: true, reason: 'attributed' });
  });

  it('refuses the same account on both sides', () => {
    expect(decideAttribution({ ...base, newUserId: 'A' }).reason).toBe('self-referral');
  });

  it('refuses a SECOND ACCOUNT ON THE SAME PHONE — the account check alone would miss it', () => {
    // Accounts are free; the handset is the thing there is only one of. Without this, "my own
    // second account on my own phone" defeats the whole system in thirty seconds.
    expect(decideAttribution({ ...base, deviceId: 'device-1' }).reason).toBe('self-referral');
  });

  it('refuses a device that has already been somebody’s referred friend', () => {
    expect(decideAttribution({ ...base, deviceAlreadyReferred: true }).reason).toBe('device-used');
  });

  it('refuses a second code on an account that already has one', () => {
    expect(decideAttribution({ ...base, alreadyReferred: true }).reason).toBe('already-referred');
  });

  it('refuses an existing user — "agar b new user hai to, old ko never"', () => {
    expect(decideAttribution({ ...base, isNewUser: false }).reason).toBe('not-new-user');
  });

  it('refuses an unknown code, and a blank owner is never treated as a match', () => {
    for (const owner of [null, undefined, '', '   ']) {
      expect(decideAttribution({ ...base, codeOwnerUserId: owner }).reason).toBe('unknown-code');
    }
  });

  it('refuses the website outright', () => {
    expect(decideAttribution({ ...base, platform: 'web' }).reason).toBe('not-android');
  });

  it('a missing device id cannot accidentally match the referrer’s blank entries', () => {
    const r = decideAttribution({ ...base, deviceId: null, referrerDeviceIds: ['', '  ', null] });
    expect(r.ok).toBe(true);
  });
});

describe('the refusal messages reach real people', () => {
  it('never accuses anyone and never says the account is in trouble', () => {
    const reasons = ['unknown-code', 'already-referred', 'self-referral', 'device-used',
      'not-new-user', 'not-android', 'disabled'] as const;
    for (const reason of reasons) {
      const msg = attributionRefusalMessage(reason);
      expect(msg.length, reason).toBeGreaterThan(10);
      expect(msg, reason).not.toMatch(/fraud|abuse|cheat|suspicious|blocked|banned|violation/i);
    }
  });

  it('does not tell a prober WHICH marker caught them', () => {
    // The one piece of information an abuser needs and an honest user never does.
    expect(attributionRefusalMessage('self-referral')).toBe(attributionRefusalMessage('device-used'));
  });

  it('never names a vendor or a model (the White-Label Law)', () => {
    for (const reason of ['unknown-code', 'self-referral', 'disabled'] as const) {
      expect(attributionRefusalMessage(reason)).not.toMatch(/glm|kimi|claude|gemini|grok|anthropic|openai/i);
    }
  });
});

describe('the progress view', () => {
  it('lists all four steps with what is claimed and what is pending', () => {
    const p = selfProgress(['email', 'mobile'], ON);
    expect(p).toHaveLength(4);
    expect(p.filter((s) => s.claimed).map((s) => s.step).sort()).toEqual(['email', 'mobile']);
    expect(p.every((s) => s.tokens === 10_000)).toBe(true);
  });

  it('is a view, not a payment — it never reports anything as claimed that was not', () => {
    expect(selfProgress([], ON).some((s) => s.claimed)).toBe(false);
    expect(selfProgress(['garbage'], ON).some((s) => s.claimed)).toBe(false);
  });
});

describe('the Earning screen — a referred friend’s three-step status', () => {
  it('all three undone reads as 0 of 3, never a false positive', () => {
    expect(friendVerificationStatus(undefined)).toEqual({
      mobile: false, email: false, github: false, completedCount: 0,
    });
    expect(friendVerificationStatus([])).toEqual({
      mobile: false, email: false, github: false, completedCount: 0,
    });
  });

  it('counts exactly the three steps that pay the referrer — referral-code is not one of them', () => {
    const s = friendVerificationStatus(['referral-code', 'email', 'mobile']);
    expect(s).toEqual({ mobile: true, email: true, github: false, completedCount: 2 });
  });

  it('reaches 3 of 3 once every verification is in', () => {
    expect(friendVerificationStatus(['email', 'mobile', 'github']).completedCount).toBe(3);
  });

  it('never trusts a garbage or duplicated entry — same discipline as readSteps', () => {
    expect(friendVerificationStatus(['mobile', 'mobile', 'not-a-real-step']))
      .toEqual({ mobile: true, email: false, github: false, completedCount: 1 });
    expect(friendVerificationStatus('not-an-array' as unknown))
      .toEqual({ mobile: false, email: false, github: false, completedCount: 0 });
  });

  it('agrees with the money: decideReferrerReward pays exactly for what this reports as done', () => {
    const friendPaidSteps = ['referral-code', 'email', 'mobile'];
    const status = friendVerificationStatus(friendPaidSteps);
    const reward = decideReferrerReward({
      friendPaidSteps, alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON,
    });
    expect(status.completedCount).toBe(2); // email + mobile; referral-code does not pay the referrer
    expect(reward.recordSteps.sort()).toEqual(['email', 'mobile']);
  });
});
