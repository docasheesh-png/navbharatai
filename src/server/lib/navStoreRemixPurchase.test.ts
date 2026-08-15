import { describe, it, expect } from 'vitest';
import {
  validateRemixPrice, splitRemixPrice, purchaseDocId, resalePriceCheck, resalePriceFloor,
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

  it('a PAID remix re-lists only ABOVE the original price — the undercut rule', () => {
    /**
     * ADMIN 2026-08-15, superseding the same day's flat ban: "user B ka selling price hamesha user A
     * se jyada hoga, chahe woh kitna bhi edit kar le." A publish of a paid remix auto-lists at the
     * floor (one rupee above the original) and every later price change re-checks against the
     * parent's CURRENT price. Free would be the ultimate undercut, so it is refused too.
     */
    const publish = route.slice(route.indexOf('web/publish'), route.indexOf('web/app/:id'));
    expect(publish).toContain('getRemixOrigin(workspaceId)');
    expect(publish).toContain('resalePriceFloor(');
    const settings = route.slice(route.indexOf('app/:id/settings'), route.indexOf('app/:id/remix'));
    expect(settings).toContain('resalePriceCheck(');
  });

  it('re-publishing never wipes the price or the data-quota counter', () => {
    // Found while wiring the undercut rule: the publish record replaces the doc wholesale, so a
    // field not carried forward silently resets — a free-on-every-update price would undercut the
    // creator THEMSELVES, and a reset row counter would let an app evade its storage quota.
    const publish = route.slice(route.indexOf('web/publish'), route.indexOf('web/app/:id'));
    expect(publish).toContain('existing?.priceInr');
    expect(publish).toContain('dataRows');
  });

  it('the confirm sheet shows the price AND non-refundable BEFORE purchase', () => {
    const player = readFileSync(join(process.cwd(), 'src/components/ide/WebAppPlayer.tsx'), 'utf8');
    expect(player).toContain('Non-refundable.');
    expect(player).toMatch(/Buy for ₹/);
    // …and the free path never shows a price it doesn't have.
    expect(player).toContain("price > 0 ? setConfirmingBuy(true) : void remix()");
  });
});

describe('resalePriceCheck — the pure heart of the undercut rule', () => {
  it('a remix of a FREE app may price freely (that loop is the growth engine)', () => {
    expect(resalePriceCheck(0, 0).ok).toBe(true);
    expect(resalePriceCheck(499, 0).ok).toBe(true);
  });

  it('equal, lower and FREE are all undercuts against a paid original', () => {
    for (const candidate of [0, 50, 98, 99]) {
      const r = resalePriceCheck(candidate, 99);
      expect(r.ok, `₹${candidate} vs ₹99`).toBe(false);
      expect(r.reason).toContain('₹99');
    }
  });

  it('strictly above the original passes', () => {
    expect(resalePriceCheck(100, 99).ok).toBe(true);
  });

  it('the floor is one rupee above — the minimal lawful listing', () => {
    expect(resalePriceFloor(99)).toBe(100);
    expect(resalePriceCheck(resalePriceFloor(99), 99).ok).toBe(true);
  });
});

describe('the key rule — "api sell nahi hogi, api user B ko deni hogi" (admin 2026-08-15)', () => {
  const routes = readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8');

  it('the remix delivery writes an .env.example naming the keys B must bring', () => {
    /**
     * The creator's keys were never in the snapshot (the scan gate + .env drop make that physical).
     * This is the OTHER half: without it, B's copy fails its first build mysteriously. The example
     * file is the platform's own convention — v5's secret preflight reads it and asks B for THEIR
     * OWN keys at the right moment.
     */
    const remix = routes.slice(routes.indexOf('app/:id/remix'), routes.indexOf('app/:id/report'));
    expect(remix).toContain('keyShapedEnvVars(');
    expect(remix).toContain('generateEnvExample(');
    expect(remix).toContain('apiKeysNeeded');
  });

  it('the listing records the key-shaped vars at publish — disclosure BEFORE money', () => {
    const publish = routes.slice(routes.indexOf('web/publish'), routes.indexOf('web/app/:id'));
    expect(publish).toContain('apiVarsUsed: keyShapedEnvVars(');
    const player = readFileSync(join(process.cwd(), 'src/components/ide/WebAppPlayer.tsx'), 'utf8');
    expect(player).toContain('not included');
  });
});
