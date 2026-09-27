import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  welcomeGiftEligible, welcomeGiftRefusal, ADMIN_WELCOME_GIFT_TOKENS,
  bulkWelcomeGiftCandidates, bulkWelcomeGiftRefusal, BULK_WELCOME_GIFT_MAX,
} from '../src/server/lib/adminWelcomeGift';

/**
 * THE ADMIN'S ONE-CLICK ₹50 (2026-09-26): *"new user jinko kabhi koi token gift nahi mila hai, usko
 * admin 50 ke token gift kar sake 1 click par"*. It moves real money, so the locks are about who may
 * receive it and how many times.
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('who may receive it', () => {
  it('a fresh ₹0 account that never received anything is eligible', () => {
    expect(welcomeGiftEligible({ tokenBalance: 0, freeGiftedTokens: 0, totalTokensPurchased: 0 })).toBe(true);
    expect(welcomeGiftEligible({})).toBe(true);
  });

  it('🔒 a second press pays nothing', () => {
    const w = { adminWelcomeGiftAt: '2026-09-26T16:00:00Z' };
    expect(welcomeGiftEligible(w)).toBe(false);
    expect(welcomeGiftRefusal(w)).toMatch(/already received the ₹50/);
  });

  it('anyone already gifted, credited, paying or merged away is not eligible', () => {
    expect(welcomeGiftEligible({ freeGiftedTokens: 10000 })).toBe(false);
    expect(welcomeGiftEligible({ totalTokensPurchased: 50000 })).toBe(false);
    expect(welcomeGiftEligible({ totalMoneySpent: 99 })).toBe(false);
    expect(welcomeGiftEligible({ mergedInto: 'uid-2' })).toBe(false);
    expect(welcomeGiftEligible(null)).toBe(false);
  });

  it('it is exactly ₹50', () => {
    expect(ADMIN_WELCOME_GIFT_TOKENS).toBe(5000);
  });
});

describe('the route and the button', () => {
  const route = read('src/server/routes/admin.ts');
  const start = route.indexOf('const grantWelcomeGift = async');
  const body = route.slice(start, route.indexOf('\n  };', start));

  it('re-checks eligibility INSIDE the transaction, so two presses pay once', () => {
    expect(start).toBeGreaterThan(0);
    const tx = body.indexOf('runTransaction(');
    const check = body.indexOf('welcomeGiftEligible(w)');
    expect(tx).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(tx);
  });

  it('🔒 counts as gift money, so the ₹400 lifetime gift ceiling still holds', () => {
    expect(body).toMatch(/freeGiftedTokens: Number\(w\.freeGiftedTokens \|\| 0\) \+ ADMIN_WELCOME_GIFT_TOKENS/);
    expect(body).toMatch(/mirroredCreditPatch\(w, ADMIN_WELCOME_GIFT_TOKENS, 'gift'\)/);
    expect(body).toMatch(/adminWelcomeGiftAt: nowIso/);
  });

  it('is admin-only', () => {
    expect(route).toMatch(/app\.post\('\/api\/admin\/users\/:userId\/welcome-gift', verifyAdminToken,/);
  });

  it('the panel shows the button only where the server says the account is eligible', () => {
    expect(route).toMatch(/welcomeGiftEligible: welcomeGiftEligible\(u\)/);
    expect(read('src/components/AdminDashboard.tsx')).toMatch(/u\.welcomeGiftEligible === true && \(/);
  });
});

describe('the bulk press (admin 2026-09-27: "ek ek kar ke du? 1000 user hai?")', () => {
  it('picks every eligible account and nobody else', () => {
    const ids = bulkWelcomeGiftCandidates([
      { id: 'new-1' },
      { id: 'new-2', tokenBalance: 0 },
      { id: 'gifted', freeGiftedTokens: 10000 },
      { id: 'paid', totalMoneySpent: 99 },
      { id: 'had-50', adminWelcomeGiftAt: '2026-09-26T16:00:00Z' },
      { id: 'merged', mergedInto: 'x' },
      { id: '' },
    ]);
    expect(ids).toEqual(['new-1', 'new-2']);
  });

  it('🔒 a banned account is never gifted', () => {
    expect(bulkWelcomeGiftCandidates([{ id: 'b', banned: true }])).toEqual([]);
  });

  it('🔒 it never pays more users than the admin confirmed', () => {
    expect(bulkWelcomeGiftRefusal(1000, 1000)).toBeNull();
    expect(bulkWelcomeGiftRefusal(1000, 990)).toBeNull();
    expect(bulkWelcomeGiftRefusal(1000, 1003)).toMatch(/3 more user/);
  });

  it('a missing or malformed count is a refusal, never "no limit"', () => {
    for (const bad of [undefined, null, '', 'all', -1, 2.5, NaN]) {
      expect(bulkWelcomeGiftRefusal(bad, 5)).toMatch(/Check the eligible count/);
    }
  });

  it('is bounded per press', () => {
    expect(BULK_WELCOME_GIFT_MAX).toBeGreaterThan(0);
    expect(BULK_WELCOME_GIFT_MAX).toBeLessThanOrEqual(5000);
  });

  const route = read('src/server/routes/admin.ts');
  const bulk = route.slice(route.indexOf("'/api/admin/welcome-gift/bulk'"));
  const bulkBody = bulk.slice(0, bulk.indexOf('\n  });'));

  it('is admin-only', () => {
    expect(route).toMatch(/app\.post\('\/api\/admin\/welcome-gift\/bulk', verifyAdminToken,/);
  });

  it('🔒 pays through the same transaction as the single button — never its own write', () => {
    expect(bulkBody).toMatch(/grantWelcomeGift\(db, uid, nowIso\)/);
    expect(bulkBody).not.toMatch(/tx\.update|updateDoc|setDoc|mirroredCreditPatch/);
    expect(route).toMatch(/app\.post\('\/api\/admin\/users\/:userId\/welcome-gift'[\s\S]{0,300}grantWelcomeGift\(db, userId,/);
  });

  it('checks the confirmed count before paying anyone, and a dry run pays nobody', () => {
    const refuse = bulkBody.indexOf('bulkWelcomeGiftRefusal(req.body?.expectedCount');
    const pay = bulkBody.indexOf('grantWelcomeGift(');
    const dry = bulkBody.indexOf('dryRun === true');
    expect(refuse).toBeGreaterThan(0);
    expect(pay).toBeGreaterThan(refuse);
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(pay);
  });

  it('the panel shows the total and sends the count it showed', () => {
    const panel = read('src/components/AdminDashboard.tsx');
    expect(panel).toMatch(/adminPost\('\/api\/admin\/welcome-gift\/bulk', \{ dryRun: true \}\)/);
    expect(panel).toMatch(/adminPost\('\/api\/admin\/welcome-gift\/bulk', \{ expectedCount: check\.eligible \}\)/);
    expect(panel).toMatch(/Total credit: ₹/);
  });
});
