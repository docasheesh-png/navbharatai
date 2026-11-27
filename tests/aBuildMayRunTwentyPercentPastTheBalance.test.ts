// A BUILD MAY RUN UP TO 20% PAST THE BALANCE (admin 2026-11-27, after failedbr #2555: "user ke pas balance nahi hai, to build
// mat chalao. agar build me anuman kharcha > user balance — 10-20% tak negative ham rah lenge … user ka pas jitna paisa hai,
// usse thoda jyada bill bane to bhi chalegi").
//
// #2555 was stopped at a running bill of ₹126.14 on a ₹93.63 balance; its estimate (₹80.35) had to fit the balance exactly.
// Now ONE limit — walletSpendLimitInr, 120% of a positive balance — is read by the admission gate (shouldRefuseBuildForBalance),
// the shared affordability decision (decideAffordability) and the mid-build wallet stop. No positive balance: no build.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walletSpendLimitInr, shouldRefuseBuildForBalance, WALLET_OVERDRAFT_SHARE } from '../src/server/AgentV3/balanceRechargeNotice';
import { decideAffordability } from '../src/server/AgentV3/Affordability';

describe('💳 one limit', () => {
  it('120% of a positive balance; nothing for an empty or negative one', () => {
    expect(WALLET_OVERDRAFT_SHARE).toBe(0.2);
    expect(walletSpendLimitInr(100)).toBeCloseTo(120, 9);
    expect(walletSpendLimitInr(0)).toBe(0);
    expect(walletSpendLimitInr(-5)).toBe(0);
    expect(walletSpendLimitInr(Number.NaN)).toBe(0);
  });
});

describe('🚪 at the start of a build', () => {
  it('no balance → no build, whatever the estimate', () => {
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 0, estimateInr: 10 })).toBe(true);
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: -3, estimateInr: 0 })).toBe(true);
    expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 1, overdraft: 20 }).action).toBe('block');
  });
  it('an estimate up to 20% over the balance starts; beyond it does not', () => {
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 100, estimateInr: 100 })).toBe(false);
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 100, estimateInr: 119 })).toBe(false);
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 100, estimateInr: 121 })).toBe(true);
    expect(decideAffordability({ isFreeUser: false, balance: 100, estimate: 119, overdraft: 20 }).action).toBe('proceed');
    expect(decideAffordability({ isFreeUser: false, balance: 100, estimate: 121, overdraft: 20 }).action).toBe('block');
  });
  it('🔴 the #2555 numbers: an estimate of ₹80.35 on ₹93.63 starts (as before), and so would ₹110', () => {
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 93.63, estimateInr: 80.35 })).toBe(false);
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: 93.63, estimateInr: 110 })).toBe(false);
  });
  it('exempt accounts and an unreadable balance are unchanged', () => {
    expect(shouldRefuseBuildForBalance({ exempt: true, balanceInr: 0, estimateInr: 500 })).toBe(false);
    expect(shouldRefuseBuildForBalance({ exempt: false, balanceInr: null, estimateInr: 500 })).toBe(false);
  });
});

describe('⏱️ during a build', () => {
  it('🔒 the wallet stop fires only past 120% of the balance', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('if (inr !== null && inr > walletSpendLimitInr(spendableBalanceInr)) {');
    expect(route).not.toContain('if (inr !== null && inr > spendableBalanceInr) {');
    // #2555's running bill of ₹126.14 on ₹93.63 is past even 120% (₹112.36), so that build would still stop — honestly.
    expect(126.14 > walletSpendLimitInr(93.63)).toBe(true);
  });
});
