import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  welcomeGiftEligible, welcomeGiftRefusal, ADMIN_WELCOME_GIFT_TOKENS,
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
  const start = route.indexOf("'/api/admin/users/:userId/welcome-gift'");
  const body = route.slice(start, route.indexOf('\n  });', start));

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
