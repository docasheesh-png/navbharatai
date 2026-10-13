import { describe, it, expect } from 'vitest';
import { offeredPlans, entitlementsForPlanId, proPriceInr, proPlan } from '../src/lib/planModel';
import { HOSTING_TIERS, tierForPlanId } from '../src/lib/hostingTiers';

describe('Pro plan model (PR 18)', () => {
  it('flag off (default) ⇒ offered plans are exactly today\'s', () => {
    expect(offeredPlans({})).toBe(HOSTING_TIERS);
  });
  it('flag on ⇒ Pro is the one plan offered, ₹499 by default', () => {
    const p = offeredPlans({ PLAN_MODEL_PRO: '1' });
    expect(p.map((x) => x.id)).toEqual(['pro']);
    expect(p[0].priceInr).toBe(499);
  });
  it('price is configurable, and garbage falls back to ₹499', () => {
    expect(proPriceInr({ PLAN_PRO_PRICE_INR: '399' })).toBe(399);
    for (const v of ['0', '-5', '4.5', 'abc', '100000', '']) expect(proPriceInr({ PLAN_PRO_PRICE_INR: v })).toBe(499);
  });
  it('Starter, Growth and the legacy plan keep their entitlements with the flag on or off', () => {
    for (const env of [{}, { PLAN_MODEL_PRO: '1' }]) {
      for (const id of ['starter', 'growth', 'custom_domain']) expect(entitlementsForPlanId(id, env)).toEqual(tierForPlanId(id));
    }
  });
  it('a bought Pro keeps working even if the flag is turned off later', () => {
    expect(entitlementsForPlanId('pro', {})?.id).toBe('pro');
  });
  it('Pro shows no GST wording', () => {
    expect(JSON.stringify(proPlan({}))).not.toMatch(/GST|tax/i);
  });
});
