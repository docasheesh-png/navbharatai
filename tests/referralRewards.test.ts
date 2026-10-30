import { describe, it, expect } from 'vitest';
import {
  decideSelfReward, decideReferrerReward, decideAttribution, attributionRefusalMessage,
  selfProgress, readSteps, ALL_STEPS, REFERRER_PAYING_STEPS,
  referralRewardsEnabled, stepRewardTokens, referrerStepTokens, referrerLifetimeCapTokens,
  friendVerificationStatus, canStillRedeem,
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

describe('the amounts are the admin-approved plan (2026-09-27, "ab yeh final hai")', () => {
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

// The WEB path (admin 2026-09-27): signup ₹50, login ₹50 and mobile ₹100 are paid on BOTH surfaces,
// under the ₹200 website ceiling; the referral code and GitHub are app-only. The OTP hold of 2026-09-26
// is now a lever (`REFERRAL_WEB_HOLD_UNTIL_MOBILE`), off by default.
const web = (over: Partial<Parameters<typeof decideSelfReward>[0]> = {}) => decideSelfReward({
  step: 'signup', alreadyPaidSteps: [], deviceVerified: false, platform: 'web',
  alreadyGiftedTokens: 0, alreadyWebGiftedTokens: 0, mobileVerified: false, env: ON, ...over,
});

describe('🔒 the website earns signup, login and mobile — capped at ₹200', () => {
  it('refuses the app-only steps on the web — the referral code and GitHub never pay here', () => {
    for (const step of ['github', 'referral-code'] as RewardStep[]) {
      const r = web({ step, mobileVerified: true });
      expect(r.tokens, step).toBe(0);
      expect(r.reason, step).toBe('web-not-eligible');
      expect(r.recordStep, step).toBeNull();
    }
  });

});

describe('🔒 a step pays once, ever', () => {
  it('refuses a step already paid, and records nothing', () => {
    const r = android({ step: 'email', alreadyPaidSteps: ['email'] });
    expect(r.tokens).toBe(0);
    expect(r.reason).toBe('already-paid');
    expect(r.recordStep).toBeNull();
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

});

describe('🔒 RULE 4 — the ₹1,500 lifetime cap', () => {
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
  it('is a view, not a payment — it never reports anything as claimed that was not', () => {
    expect(selfProgress([]).some((s) => s.claimed)).toBe(false);
    expect(selfProgress(['garbage']).some((s) => s.claimed)).toBe(false);
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

});

describe('🔒 canStillRedeem — "refer only for new user", without locking out the Gmail-login grant', () => {
  it('a brand-new account may redeem', () => {
    expect(canStillRedeem([])).toBe(true);
    expect(canStillRedeem(undefined)).toBe(true);
  });
  it('the automatic Gmail-login (email) grant alone does NOT make an account old', () => {
    expect(canStillRedeem(['email'])).toBe(true);
  });
  it('nor does the ₹50 signup — every account earns it on day one (2026-09-27)', () => {
    expect(canStillRedeem(['signup'])).toBe(true);
    expect(canStillRedeem(['signup', 'email'])).toBe(true);
    expect(canStillRedeem(['signup', 'email', 'mobile'])).toBe(false);
  });
  it('any real verification (mobile / github) before the code makes it old — "old ko never"', () => {
    expect(canStillRedeem(['mobile'])).toBe(false);
    expect(canStillRedeem(['github'])).toBe(false);
    expect(canStillRedeem(['email', 'mobile'])).toBe(false);
  });
});
