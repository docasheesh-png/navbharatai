import { describe, it, expect } from 'vitest';
import { isZTestAccount } from '../src/server/lib/zTestAccount';
import { surplusFallbackDisabledFor } from '../src/server/AI/SurplusRegistry/surplusNoFallback';
import { computePlanPurchase, computeLazyRenewal, decidePlanSweepStep, probeHostingPlan } from '../src/server/lib/hostingPlan';
import { computeAddonPurchase } from '../src/server/lib/hostingAddonLedger';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

/** 🧪 TEMPORARY z@gmail.com waiver (owner 2026-10-31). Delete with lib/zTestAccount.ts. */
const Z_UID = 'GiYNmFcDMVYSWW48Nrurm7j41gv1';
const NOW = '2026-10-31T12:00:00.000Z';
const STARTER = HOSTING_TIERS[0];
const empty = (userId: string) => ({ userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [], giftTokensRemaining: 0 });

describe('isZTestAccount', () => {
  it('matches only z@gmail.com / its uid', () => {
    expect(isZTestAccount(' Z@gmail.com ')).toBe(true);
    expect(isZTestAccount(null, Z_UID)).toBe(true);
    expect(isZTestAccount('a@gmail.com', 'someone')).toBe(false);
    expect(isZTestAccount(null, null)).toBe(false);
    expect(surplusFallbackDisabledFor('z@gmail.com')).toBe(true);
    expect(surplusFallbackDisabledFor('x@gmail.com', 'u1')).toBe(false);
  });
});

describe('free hosting plan / add-on for z only', () => {
  it('z gets a plan with an empty wallet and nothing debited', () => {
    const r = computePlanPurchase(empty(Z_UID), NOW, STARTER.id, { agreedToTerms: true, waiveCharge: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.charged).toBe(false); expect(r.wallet.tokenBalance).toBe(0); expect(r.plan.id).toBe(STARTER.id); }
  });
  it('another user with an empty wallet is still refused', () => {
    const r = computePlanPurchase(empty('u1'), NOW, STARTER.id, { agreedToTerms: true });
    expect(r.ok).toBe(false);
  });
  it('z renews free; others with no balance do not', () => {
    const plan = { id: STARTER.id, purchasedAt: NOW, expiresAt: '2026-10-01T00:00:00.000Z', autoRenew: true };
    const z = computeLazyRenewal({ ...empty(Z_UID), hostingPlan: plan }, NOW, true);
    expect(z.renewed).toBe(true);
    expect(z.wallet.tokenBalance).toBe(0);
    expect(decidePlanSweepStep({ ...empty(Z_UID), hostingPlan: plan }, NOW).action).toEqual({ kind: 'renewed' });
    expect(computeLazyRenewal({ ...empty('u1'), hostingPlan: plan }, NOW).renewed).toBe(false);
  });
  it('z add-on slot is free; others still need balance', () => {
    const z = computeAddonPurchase(empty(Z_UID), NOW, 'extra_domain', { agreedToTerms: true, clientRef: 'addonref01', waiveCharge: true });
    expect(z.ok).toBe(true);
    const o = computeAddonPurchase(empty('u1'), NOW, 'extra_domain', { agreedToTerms: true, clientRef: 'addonref01' });
    expect(o.ok).toBe(false);
  });
  it('plan probe (domain-connect gate) is active for z only', async () => {
    expect(await probeHostingPlan(Z_UID)).toEqual({ active: true, known: true });
  });
});

describe('Z_TEST_ACCOUNT_FREE kill switch', () => {
  it('on/unset ⇒ free; off ⇒ z billed like anyone; Surplus debug unaffected', async () => {
    const { zTestFreeBilling } = await import('../src/server/lib/zTestAccount');
    const { _clearPlanCacheForTests } = await import('../src/server/lib/hostingPlan');
    delete process.env.Z_TEST_ACCOUNT_FREE;
    expect(zTestFreeBilling(null, Z_UID)).toBe(true);
    process.env.Z_TEST_ACCOUNT_FREE = 'off';
    try {
      expect(zTestFreeBilling('z@gmail.com', Z_UID)).toBe(false);
      _clearPlanCacheForTests();
      expect((await probeHostingPlan(Z_UID)).active).toBe(false);
      const plan = { id: STARTER.id, purchasedAt: NOW, expiresAt: '2026-10-01T00:00:00.000Z', autoRenew: true };
      expect(decidePlanSweepStep({ ...empty(Z_UID), hostingPlan: plan }, NOW).action).not.toEqual({ kind: 'renewed' });
      expect(surplusFallbackDisabledFor('z@gmail.com')).toBe(true);
      expect(isZTestAccount(null, Z_UID)).toBe(true);
    } finally { delete process.env.Z_TEST_ACCOUNT_FREE; }
  });
});
