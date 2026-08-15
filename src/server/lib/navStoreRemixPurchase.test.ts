import { describe, it, expect } from 'vitest';
import {
  validateRemixPrice, splitRemixPrice, purchaseDocId,
  MIN_REMIX_PRICE_INR, MAX_REMIX_PRICE_INR, CREATOR_SHARE,
} from './navStoreRemixPurchase';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PAID REMIX (Kadam 3, admin-locked 2026-08-15): wallet-to-wallet, non-refundable, 80/20.
 *
 * This is money code, so the tests are about the ways money code betrays people: charging twice,
 * splitting inexactly, losing the seller's share, or charging for something never delivered. The
 * Firestore paths are exercised at the seam (pure functions + source pins on the settlement order);
 * the transaction discipline itself rides debitWalletForBuild, which has its own tests.
 */

describe('what a listing may charge', () => {
  it('free is the default and always valid', () => {
    for (const v of [undefined, null, 0, '0']) expect(validateRemixPrice(v).ok, String(v)).toBe(true);
    expect(validateRemixPrice(0).priceInr).toBe(0);
  });

  it('the floor and ceiling are enforced with honest reasons', () => {
    expect(validateRemixPrice(MIN_REMIX_PRICE_INR - 1).ok).toBe(false);
    expect(validateRemixPrice(MIN_REMIX_PRICE_INR - 1).reason).toContain(`₹${MIN_REMIX_PRICE_INR}`);
    expect(validateRemixPrice(MIN_REMIX_PRICE_INR).ok).toBe(true);
    expect(validateRemixPrice(MAX_REMIX_PRICE_INR).ok).toBe(true);
    expect(validateRemixPrice(MAX_REMIX_PRICE_INR + 1).ok).toBe(false);
  });

  it('whole rupees only — fractional prices are refused, not rounded', () => {
    // Rounding someone's price is deciding their money for them; refusal lets them decide.
    expect(validateRemixPrice(49.5).ok).toBe(false);
    expect(validateRemixPrice('49.5').ok).toBe(false);
    expect(validateRemixPrice(NaN).ok).toBe(false);
    expect(validateRemixPrice('abc').ok).toBe(false);
  });
});

describe('the split is exact and always sums back', () => {
  it('80/20 to the paisa on every legal price', () => {
    for (let p = MIN_REMIX_PRICE_INR; p <= 200; p++) {
      const { creatorInr, platformInr } = splitRemixPrice(p);
      expect(Math.round((creatorInr + platformInr) * 100) / 100, `₹${p}`).toBe(p);
      expect(creatorInr, `₹${p}`).toBeCloseTo(p * CREATOR_SHARE, 2);
    }
  });

  it('the canonical example: ₹19 → creator ₹15.20, platform ₹3.80', () => {
    expect(splitRemixPrice(19)).toEqual({ creatorInr: 15.2, platformInr: 3.8 });
  });

  it('a whole-rupee price never produces a sub-paisa remainder on either side', () => {
    // The reason prices are whole rupees at all: both shares stay ≤2 decimals, so wallet token
    // conversion (×100 tokens/₹) is always an integer and the exactness carry machinery never engages.
    for (const p of [19, 49, 99, 101, 9_999]) {
      const { creatorInr } = splitRemixPrice(p);
      // Float-representation-safe "has ≤2 decimals" check: 15.2*100 is 1519.999… in IEEE754, so a
      // strict equality here fails on the FLOAT, not the money. What must be true is that the paisa
      // value is within float-epsilon of an integer — which is also exactly what makes the token
      // conversion (Math.round(inr × 100)) land on the intended integer.
      expect(Math.abs(creatorInr * 100 - Math.round(creatorInr * 100)), `₹${p}`).toBeLessThan(1e-6);
    }
  });
});

describe('one purchase per buyer per app, forever', () => {
  it('the doc id is deterministic — the id IS the idempotency', () => {
    expect(purchaseDocId('web_a1', 'uid9')).toBe('web_a1__uid9');
    expect(purchaseDocId('web_a1', 'uid9')).toBe(purchaseDocId('web_a1', 'uid9'));
  });
});

describe('the settlement order is the billing law (source pins — the order is the guarantee)', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8');
  const remixRoute = route.slice(route.indexOf('PAID REMIX (Kadam 3)'), route.indexOf("app/:id/report"));
  const module_ = readFileSync(join(process.cwd(), 'src/server/lib/navStoreRemixPurchase.ts'), 'utf8');

  it('files are DELIVERED before any money moves', () => {
    // "Working result or free": a debit failure after delivery = the buyer got it free; the reverse
    // order could take money and deliver nothing — the one thing non-refundable must never allow.
    const deliver = remixRoute.indexOf('saveWorkspaceFiles(target');
    const charge = remixRoute.indexOf('settleRemixPurchase(');
    expect(deliver).toBeGreaterThan(0);
    expect(charge).toBeGreaterThan(deliver);
  });

  it('an empty wallet is refused BEFORE anything is copied', () => {
    const afford = remixRoute.indexOf('canAffordRemix(');
    const deliver = remixRoute.indexOf('saveWorkspaceFiles(target');
    expect(afford).toBeGreaterThan(0);
    expect(afford).toBeLessThan(deliver);
  });

  it('the owner and a past buyer are never charged', () => {
    expect(remixRoute).toContain('buyerUid !== found.uid');
    expect(remixRoute).toContain('hasPurchased(');
  });

  it('a failed creator credit lands in the reconciliation trail, never silently lost', () => {
    expect(module_).toContain('nav_store_pending_credits');
    expect(module_).toContain('creator credit pending');
  });

  it('the buyer-facing refusal for a paid remix says NON-REFUNDABLE before sign-in even happens', () => {
    expect(remixRoute).toMatch(/non-refundable/i);
  });

  it('a PAID remix cannot be re-listed on the store', () => {
    const publish = route.slice(route.indexOf('web/publish'), route.indexOf('web/app/:id'));
    expect(publish).toContain('getRemixOrigin(workspaceId)');
    expect(publish).toMatch(/can\\?'t be listed on the store/);
  });

  it('the confirm sheet shows the price AND non-refundable BEFORE purchase', () => {
    const player = readFileSync(join(process.cwd(), 'src/components/ide/WebAppPlayer.tsx'), 'utf8');
    expect(player).toContain('Non-refundable.');
    expect(player).toMatch(/Buy for ₹/);
    // …and the free path never shows a price it doesn't have.
    expect(player).toContain("price > 0 ? setConfirmingBuy(true) : void remix()");
  });
});
