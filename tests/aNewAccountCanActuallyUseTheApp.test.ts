// ₹50 FOR A NEW ACCOUNT — and the ₹250 phone bonus that must STAY retired while we add it.
//
// 🔴 WHAT THIS CLOSES. Google rejected the Android release (2026-09-22) under the Broken Functionality
// policy, with evidence screenshots of the AI Image Generator failing. The cause was not the image
// code: a brand-new account received ₹0 (`flatWelcomeGiftAllowed()` hardcoded false since 2026-09-17,
// the referral ladder deliberately unset until the app is live on Play), free images come from a
// keyless third party with no SLA, and the moment it fails the ladder reaches a PAID rung that
// `gateToolAction` refuses on an empty wallet. **A Play reviewer is a brand-new account.**
//
// Admin, 2026-09-22: *"new account me 50₹ credit do. jab tak, refral system activate na hota hai, tab
// tak. uske baad 100x4=400 denge.(after refral system activation)"*
//
// 🔒 THE TRAP THIS SUITE EXISTS FOR, and it is the reason the fix is a new predicate rather than a
// flipped one: `flatWelcomeGiftAllowed()` gates THREE things — the signup grant, the retired ₹250
// PHONE bonus, and the v2 gift summary. Re-enabling it to reach the first would silently re-open a
// ₹250 claim the admin retired on 2026-09-17. Fixing one problem while creating another is exactly
// what this repo's core rules forbid, so the last two cases below assert the old plan stays retired.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTERIM_WELCOME_TOKENS,
  interimWelcomeGiftAllowed,
  interimWelcomeTokenAmount,
  interimWelcomeTokens,
} from '../src/server/lib/interimWelcomeGift';
import { flatWelcomeGiftAllowed, weeklyTopUpAllowed, MAX_SELF_GIFT_TOKENS } from '../src/server/lib/giftPolicy';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';

const OFF: NodeJS.ProcessEnv = {};                          // referral ladder not live — today
const LADDER: NodeJS.ProcessEnv = { REFERRAL_REWARDS: 'on' }; // the ladder pays instead

const codeOf = (p: string) =>
  readFileSync(join(__dirname, '..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a brand-new account is given ₹50 — the amount the admin named', () => {
  it('is ₹50, stated in rupees and in tokens so the two cannot drift', () => {
    expect(INTERIM_WELCOME_TOKENS).toBe(50 * TOKENS_PER_RUPEE);
    expect(INTERIM_WELCOME_TOKENS).toBe(5000);
    expect(interimWelcomeTokens(0, OFF)).toBe(5000);
  });

  it('is live while the referral ladder is not', () => {
    expect(interimWelcomeGiftAllowed(OFF)).toBe(true);
  });

  it('🔒 STANDS DOWN BY ITSELF the moment the referral ladder is switched on — "jab tak … tab tak"', () => {
    // No second copy of "is the ladder paying?", and nothing for anyone to remember to turn off.
    expect(interimWelcomeGiftAllowed(LADDER)).toBe(false);
    expect(interimWelcomeTokens(0, LADDER)).toBe(0);
  });
});

describe('🔒 THE ₹400 CEILING SURVIVES — "kaise bhi jaye, maximum ₹400!!!"', () => {
  it('a later referral ladder tops the same account to ₹400, never ₹450', () => {
    // The grant is recorded in freeGiftedTokens by buildInitialWallet in the same write, so the cap
    // sees it afterwards. Here: ₹380 already given leaves ₹20 of room, not ₹50.
    expect(interimWelcomeTokens(380 * TOKENS_PER_RUPEE, OFF)).toBe(20 * TOKENS_PER_RUPEE);
    expect(interimWelcomeTokens(MAX_SELF_GIFT_TOKENS, OFF)).toBe(0);
    expect(interimWelcomeTokens(10_000_000, OFF)).toBe(0);
  });

  it('the env tunable cannot raise its own roof', () => {
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: '999999' })).toBe(MAX_SELF_GIFT_TOKENS);
  });
});

describe('🔒 AN UNREADABLE SETTING FALLS BACK TO ₹50 — never to zero, never to unlimited', () => {
  it('blank means UNSET, not a deliberate zero', () => {
    // `Number('')` is 0, not NaN: without this, a cleared field in a console would restore the exact
    // ₹0-for-new-users bug that cost the Play release.
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: '' })).toBe(5000);
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: '   ' })).toBe(5000);
    expect(interimWelcomeTokenAmount({})).toBe(5000);
  });

  it('junk and negatives fall back too', () => {
    for (const v of ['abc', '50₹', 'NaN', '-1', '-5000']) {
      expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: v }), v).toBe(5000);
    }
  });

  it('but an explicit 0 is honoured — nobody types a zero by accident', () => {
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: '0' })).toBe(0);
    expect(interimWelcomeTokens(0, { INTERIM_WELCOME_TOKENS: '0' })).toBe(0);
  });

  it('a real value is taken, floored', () => {
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: '2500' })).toBe(2500);
    expect(interimWelcomeTokenAmount({ INTERIM_WELCOME_TOKENS: ' 7500.9 ' })).toBe(7500);
  });
});

describe('🔴 THE RETIRED ₹500 PLAN STAYS RETIRED — the trap this fix had to avoid', () => {
  it('flatWelcomeGiftAllowed() is STILL false, so the ₹250 phone bonus never re-opens', () => {
    // The 2026-09-17 ruling is untouched. Only a separate, smaller, signup-only grant was added.
    expect(flatWelcomeGiftAllowed()).toBe(false);
    expect(weeklyTopUpAllowed()).toBe(false);
  });

  it('🔒 the PHONE-bonus claim route still gates on the RETIRED predicate, not the interim one', () => {
    // If a later edit swapped this for `interimWelcomeGiftAllowed`, a new account would collect ₹50
    // AND a ₹250 phone claim. Nothing else in this repo would fail.
    const wallet = codeOf('src/server/routes/wallet.ts');
    expect(wallet).toContain("if (!flatWelcomeGiftAllowed()) return { granted: 0, reason: 'disabled' as const };");
    expect(wallet).not.toMatch(/interimWelcomeGiftAllowed/);
  });

  it('the signup grant DOES use the interim credit, and still honours alreadyGranted', () => {
    const wallet = codeOf('src/server/routes/wallet.ts');
    expect(wallet).toMatch(/alreadyGranted \|\| identityAlreadySpent \? 0 : interimWelcomeTokens\(\)/);
  });

  it('🔒 one mailbox, one ₹50 — the grant is gated on the per-identity markers', () => {
    // Without this, one person with ten Gmail aliases collects ten ₹50 grants. The verdict is read
    // off `decideSignupGrant` rather than re-derived, so the two cannot disagree about whether an
    // identity is spent; `giftPlanV2Behavior.test.ts` drives the real route and proves it pays once.
    const wallet = codeOf('src/server/routes/wallet.ts');
    expect(wallet).toMatch(/const identityAlreadySpent = v2Grant\?\.reason === 'identity-used';/);
  });
});
