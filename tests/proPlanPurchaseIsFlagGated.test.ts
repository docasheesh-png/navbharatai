import { describe, it, expect, afterEach } from 'vitest';
import { computePlanPurchase, planPriceInr } from '../src/server/lib/hostingPlan';
import { HOSTING_TIERS, tierForPlanId, tierRank, purchasableTier } from '../src/lib/hostingTiers';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

const NOW = '2026-10-13T10:00:00.000Z';
const AGREED = { agreedToTerms: true };
const wallet = (inr: number, extra: Record<string, unknown> = {}) => ({
  userId: 'u1', tokenBalance: inr * TOKENS_PER_RUPEE, totalTokensUsed: 0, remaining_balance: inr,
  walletLedger: [], giftTokensRemaining: 0, total_money_spent: inr, ...extra,
});

afterEach(() => { delete process.env.PLAN_MODEL_PRO; delete process.env.PLAN_PRO_PRICE_INR; });

describe('PLAN_MODEL_PRO purchase wiring', () => {
  it('flag off ⇒ Pro cannot be bought', () => {
    expect(computePlanPurchase(wallet(5000), NOW, 'pro', AGREED)).toMatchObject({ ok: false, reason: 'unknown_tier' });
    expect(purchasableTier('pro')).toBeNull();
  });
  it('flag on ⇒ Pro is bought at the configured price', () => {
    process.env.PLAN_MODEL_PRO = '1';
    process.env.PLAN_PRO_PRICE_INR = '399';
    const r = computePlanPurchase(wallet(5000), NOW, 'pro', AGREED) as any;
    expect(r.ok).toBe(true);
    expect(r.wallet.hostingPlan.id).toBe('pro');
    expect(r.wallet.tokenBalance).toBe((5000 - 399) * TOKENS_PER_RUPEE);
    expect(planPriceInr('pro')).toBe(399);
  });
  it('Starter and Growth are still purchasable (renewals) with the flag on, unchanged', () => {
    process.env.PLAN_MODEL_PRO = '1';
    for (const t of HOSTING_TIERS) {
      const r = computePlanPurchase(wallet(5000), NOW, t.id, AGREED) as any;
      expect(r.ok).toBe(true);
      expect(r.wallet.hostingPlan.id).toBe(t.id);
      expect(planPriceInr(t.id)).toBe(t.priceInr);
    }
  });
  it('a live Growth plan is not replaced by the cheaper Pro mid-period; Starter → Pro is an upgrade', () => {
    process.env.PLAN_MODEL_PRO = '1';
    const growth = computePlanPurchase(wallet(5000), NOW, 'growth', AGREED) as any;
    expect(computePlanPurchase(growth.wallet, NOW, 'pro', AGREED)).toMatchObject({ ok: false });
    expect(tierRank('starter')).toBeLessThan(tierRank('pro'));
    expect(tierRank('pro')).toBeLessThan(tierRank('growth'));
  });
  it('a bought Pro keeps its entitlements with the flag off', () => {
    expect(tierForPlanId('pro')?.publishedApps).toBe(15);
  });
});
