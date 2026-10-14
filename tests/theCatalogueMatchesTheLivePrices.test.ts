// Go-live PR 8: the SKU catalogue is a faithful view of today's prices — no price or quota moved.
import { describe, it, expect } from 'vitest';
import { SKUS, skuById, skuOffered, rupees, FREE_SKU } from '../src/lib/catalogue';
import { HOSTING_TIERS, FREE_PUBLISHED_APPS } from '../src/lib/hostingTiers';
import { HOSTING_ADDONS } from '../src/lib/hostingAddons';

describe('catalogue ⇔ legacy constants', () => {
  it('every tier price and allowance matches', () => {
    for (const t of HOSTING_TIERS) {
      const s = skuById(`plan.${t.id}`)!;
      expect(s.pricePaise).toBe(t.priceInr * 100);
      expect(s.quotas.backendApps).toBe(t.backendApps);
      expect(s.quotas.publishedApps).toBe(t.publishedApps);
    }
  });
  it('every add-on price and sellable switch matches (never MORE sellable than today)', () => {
    for (const a of HOSTING_ADDONS) {
      const s = skuById(`addon.${a.id}`)!;
      expect(s.pricePaise).toBe(Math.round(a.priceInr * 100));
      if (!a.sellable) expect(s.sellable).toBe(false);
    }
  });
  it('free is free and matches the free caps', () => {
    expect(FREE_SKU.pricePaise).toBe(0);
    expect(FREE_SKU.quotas.publishedApps).toBe(FREE_PUBLISHED_APPS);
  });
  it('ids are unique, prices are integer paise', () => {
    expect(new Set(SKUS.map((s) => s.id)).size).toBe(SKUS.length);
    for (const s of SKUS) expect(Number.isInteger(s.pricePaise)).toBe(true);
  });
});

describe('skuOffered', () => {
  it('a SKU that needs reseller authorisation is never offered', () => {
    expect(skuById('addon.dedicated_db')!.requiresAuthorization).toBe('supabase-reseller');
    expect(skuOffered(skuById('addon.dedicated_db'))).toBe(false);
  });
  it('bring-your-own is offered and costs nothing', () => {
    const s = skuById('byo.supabase')!;
    expect(s.pricePaise).toBe(0);
    expect(skuOffered(s)).toBe(true);
  });
  it('unknown ⇒ not offered; rupees formats', () => {
    expect(skuOffered(skuById('nope'))).toBe(false);
    expect(rupees(29900)).toBe('₹299');
  });
});
