import { describe, it, expect } from 'vitest';
import {
  decideSelfReward, decideReferrerReward, stepRewardTokens, ALL_STEPS, WEB_ELIGIBLE_STEPS,
  referrerLifetimeCapTokens, type RewardStep,
} from '../src/server/lib/referralRewards';
import { MAX_SELF_GIFT_TOKENS, MAX_WEB_GIFT_TOKENS, MAX_REFERRER_PER_FRIEND_TOKENS } from '../src/server/lib/giftPolicy';
import { referralLiveNow } from '../src/server/lib/referralLive';

/** ADMIN 2026-10-30 — app-only referral. Web gift ₹0. A ₹10 per FULLY completed friend, lifetime ₹500. */
const ON = { REFERRAL_REWARDS: 'on' } as NodeJS.ProcessEnv;
const R = (t: number) => t / 100;

describe('app-only referral plan (2026-10-30)', () => {
  it('prices: download ₹5 · referral ₹10 · gmail ₹10 · github ₹15 · mobile ₹20', () => {
    expect(R(stepRewardTokens('signup'))).toBe(5);
    expect(R(stepRewardTokens('referral-code'))).toBe(10);
    expect(R(stepRewardTokens('email'))).toBe(10);
    expect(R(stepRewardTokens('github'))).toBe(15);
    expect(R(stepRewardTokens('mobile'))).toBe(20);
  });

  it('User A (no code) earns ₹50; User B (with code) earns ₹60 on a verified Android device', () => {
    const run = (steps: RewardStep[]) => {
      let paid: RewardStep[] = []; let gifted = 0;
      for (const step of steps) {
        const r = decideSelfReward({ step, alreadyPaidSteps: paid, alreadyGiftedTokens: gifted, deviceVerified: true, platform: 'android', env: ON });
        if (r.recordStep) paid = [...paid, r.recordStep];
        gifted += r.tokens;
      }
      return R(gifted);
    };
    expect(run(['signup', 'email', 'github', 'mobile'])).toBe(50);
    expect(run([...ALL_STEPS])).toBe(60);
    expect(R(MAX_SELF_GIFT_TOKENS)).toBe(60);
  });

  it('website gift = ₹0 for every step', () => {
    expect(WEB_ELIGIBLE_STEPS).toEqual([]);
    expect(MAX_WEB_GIFT_TOKENS).toBe(0);
    for (const step of ALL_STEPS) {
      expect(decideSelfReward({ step, alreadyPaidSteps: [], deviceVerified: true, platform: 'web', mobileVerified: true, env: ON }).tokens).toBe(0);
    }
  });

  it('no Play Integrity ⇒ no money', () => {
    expect(decideSelfReward({ step: 'signup', alreadyPaidSteps: [], deviceVerified: false, platform: 'android', env: ON }).tokens).toBe(0);
  });

  it('A gets ₹10 ONLY when B has completed ALL steps', () => {
    const partial: RewardStep[] = ['signup', 'referral-code', 'email', 'mobile'];
    expect(decideReferrerReward({ friendPaidSteps: partial, alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON }).tokens).toBe(0);
    const full = decideReferrerReward({ friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: 0, env: ON });
    expect(R(full.tokens)).toBe(10);
    expect(R(MAX_REFERRER_PER_FRIEND_TOKENS)).toBe(10);
    // repeat call pays nothing
    expect(decideReferrerReward({ friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: full.recordSteps, referrerEarnedTokens: full.tokens, env: ON }).tokens).toBe(0);
  });

  it('A lifetime cap ₹500 — the 51st friend pays ₹0', () => {
    expect(R(referrerLifetimeCapTokens(ON))).toBe(500);
    let earned = 0;
    for (let i = 0; i < 51; i++) {
      earned += decideReferrerReward({ friendPaidSteps: ALL_STEPS, alreadyPaidToReferrer: [], referrerEarnedTokens: earned, env: ON }).tokens;
    }
    expect(R(earned)).toBe(500);
  });

  it('referral is split from the free-program pause (follows REFERRAL_REWARDS only)', () => {
    expect(referralLiveNow({} as NodeJS.ProcessEnv)).toBe(false);
    expect(referralLiveNow(ON)).toBe(true);
  });
});

describe('gift pays chat + coding only (admin 2026-10-30)', () => {
  it('hosting traffic is a paid-only feature', async () => {
    const { isPaidOnlyFeature } = await import('../src/server/lib/walletDebit');
    expect(isPaidOnlyFeature('hosting')).toBe(true);
    expect(isPaidOnlyFeature('hosting-plan')).toBe(true);
    expect(isPaidOnlyFeature('build')).toBe(false);
    expect(isPaidOnlyFeature('app-assistant')).toBe(false);
  });
});
