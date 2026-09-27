import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  welcomeGiftEligible, walletRefusal, planWelcomeGift, parseNewUserDays, joinedWithin,
  bulkWelcomeGiftRefusal, ADMIN_WELCOME_GIFT_TOKENS, BULK_WELCOME_GIFT_MAX,
} from '../src/server/lib/adminWelcomeGift';

/**
 * THE ADMIN'S THREE RULES FOR THE ₹150 (2026-09-27), and the bug that made them necessary.
 *
 * The first version called an account "new" if it had never received any credit. Every account opened
 * after the flat welcome gift was retired (2026-09-17) fits that, however old it is — so the button
 * offered ₹150 to all of them. The admin's rules, verbatim:
 *   1. "user new hona chahiye"
 *   2. "balance gift 00 hona chahiye (₹ se purchase kiye huye alag)"
 *   3. "ek bar 150₹ mil gaye, wapas na mile, chahe admin on click 150₹ kitni bhi baar kare"
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('rule 1 — the user must be new (joined within the chosen days)', () => {
  it('🔴 the reported bug: a ten-day-old ₹0 account is NOT new at 7 days', () => {
    const plan = planWelcomeGift([{ id: 'old-zero', tokenBalance: 0 }], () => NOW - 10 * DAY, NOW, 7);
    expect(plan.payIds).toEqual([]);
    expect(plan.skipped.notNew).toBe(1);
  });

  it('an account that joined yesterday is new', () => {
    const plan = planWelcomeGift([{ id: 'fresh', tokenBalance: 0 }], () => NOW - 1 * DAY, NOW, 7);
    expect(plan.payIds).toEqual(['fresh']);
  });

  it('🔒 an account whose join date cannot be read is never paid', () => {
    expect(joinedWithin(null, NOW, 30)).toBe(false);
    expect(joinedWithin(undefined, NOW, 30)).toBe(false);
    expect(joinedWithin(NaN, NOW, 30)).toBe(false);
    expect(planWelcomeGift([{ id: 'x' }], () => null, NOW, 30).payIds).toEqual([]);
  });

  it('the window is a whole number of days from 1 to 30 — anything else is refused, never "all time"', () => {
    expect(parseNewUserDays(7)).toBe(7);
    expect(parseNewUserDays('15')).toBe(15);
    for (const bad of [undefined, null, '', 0, -3, 31, 365, 2.5, 'all', NaN]) {
      expect(parseNewUserDays(bad)).toBeNull();
    }
  });
});

describe('rule 2 — the GIFT balance must be ₹0; paid money is separate', () => {
  it('a new user still holding gift credit is skipped', () => {
    const w = { tokenBalance: 10000, giftTokensRemaining: 10000, freeGiftedTokens: 10000 };
    expect(walletRefusal(w)).toBe('has-gift-balance');
  });

  it('🔑 a user who PAID ₹299 but has ₹0 gift balance IS eligible — purchased money does not count', () => {
    const w = { tokenBalance: 29900, giftTokensRemaining: 0, totalMoneySpent: 299, totalTokensPurchased: 29900 };
    expect(walletRefusal(w)).toBeNull();
    expect(welcomeGiftEligible(w)).toBe(true);
  });

  it('a user who spent all their earlier gift is at ₹0 gift and eligible', () => {
    const w = { tokenBalance: 0, giftTokensRemaining: 0, freeGiftedTokens: 10000 };
    expect(welcomeGiftEligible(w)).toBe(true);
  });

  it('🔒 the ₹400 lifetime gift ceiling still holds — no room for ₹150, no payment', () => {
    expect(walletRefusal({ tokenBalance: 0, giftTokensRemaining: 0, freeGiftedTokens: 30000 })).toBe('gift-ceiling');
  });
});

describe('rule 3 — once given, never again, however many presses', () => {
  it('🔒 a wallet already stamped is skipped, and counted as such', () => {
    const w = { id: 'got-it', tokenBalance: 0, adminWelcomeGiftAt: '2026-09-27T03:10:00Z' };
    expect(welcomeGiftEligible(w)).toBe(false);
    const plan = planWelcomeGift([w], () => NOW - DAY, NOW, 7);
    expect(plan.payIds).toEqual([]);
    expect(plan.skipped.alreadyGiven).toBe(1);
  });

  it('the stamp is written and re-read INSIDE the one transaction', () => {
    const route = read('src/server/routes/admin.ts');
    const start = route.indexOf('const grantWelcomeGift = async');
    const body = route.slice(start, route.indexOf('\n  };', start));
    const tx = body.indexOf('runTransaction(');
    expect(tx).toBeGreaterThan(0);
    expect(body.indexOf('welcomeGiftEligible(w)')).toBeGreaterThan(tx);
    expect(body).toMatch(/adminWelcomeGiftAt: nowIso/);
    expect(body).toMatch(/mirroredCreditPatch\(w, ADMIN_WELCOME_GIFT_TOKENS, 'gift'\)/);
    expect(body).toMatch(/freeGiftedTokens: Number\(w\.freeGiftedTokens \|\| 0\) \+ ADMIN_WELCOME_GIFT_TOKENS/);
  });
});

describe('guards and amounts', () => {
  it('it is exactly ₹150', () => {
    expect(ADMIN_WELCOME_GIFT_TOKENS).toBe(15000);
  });

  it('banned and merged accounts are never paid', () => {
    expect(walletRefusal({ banned: true })).toBe('banned');
    expect(walletRefusal({ mergedInto: 'uid-2' })).toBe('merged');
    expect(walletRefusal(null)).toBe('no-wallet');
  });

  it('the plan counts every account it checked, in exactly one bucket', () => {
    const wallets = [
      { id: 'pay', tokenBalance: 0 },
      { id: 'old', tokenBalance: 0 },
      { id: 'gift', tokenBalance: 5000, giftTokensRemaining: 5000 },
      { id: 'given', adminWelcomeGiftAt: 'x' },
      { id: 'banned', banned: true },
    ];
    const joined = (id: string) => (id === 'old' ? NOW - 20 * DAY : NOW - DAY);
    const plan = planWelcomeGift(wallets, joined, NOW, 7);
    expect(plan.payIds).toEqual(['pay']);
    expect(plan.checked).toBe(5);
    expect(plan.skipped).toEqual({ notNew: 1, hasGiftBalance: 1, alreadyGiven: 1, other: 1 });
  });

  it('🔒 it never pays more users than the admin confirmed; a bad count is refused', () => {
    expect(bulkWelcomeGiftRefusal(100, 100)).toBeNull();
    expect(bulkWelcomeGiftRefusal(100, 90)).toBeNull();
    expect(bulkWelcomeGiftRefusal(100, 103)).toMatch(/3 more user/);
    for (const bad of [undefined, null, '', 'all', -1, 2.5, NaN]) {
      expect(bulkWelcomeGiftRefusal(bad, 5)).toMatch(/Check the count first/);
    }
  });

  it('is bounded per press', () => {
    expect(BULK_WELCOME_GIFT_MAX).toBeGreaterThan(0);
    expect(BULK_WELCOME_GIFT_MAX).toBeLessThanOrEqual(5000);
  });
});

describe('the route and the panel', () => {
  const route = read('src/server/routes/admin.ts');
  const bulk = route.slice(route.indexOf("'/api/admin/welcome-gift/bulk'"));
  const bulkBody = bulk.slice(0, bulk.indexOf('\n  });'));

  it('is admin-only', () => {
    expect(route).toMatch(/app\.post\('\/api\/admin\/welcome-gift\/bulk', verifyAdminToken,/);
  });

  it('🔴 judges "new" by the users list\'s own join date, not by "never credited"', () => {
    expect(bulkBody).toMatch(/resolveJoinedAt\(authMeta\.get\(id\) \?\? null, w\.createdAt\)\.atMs/);
    expect(bulkBody).toMatch(/planWelcomeGift\(/);
    expect(bulkBody).toMatch(/parseNewUserDays\(req\.body\?\.days\)/);
  });

  it('🔒 pays each account through the one transaction that re-checks it — never its own write', () => {
    expect(bulkBody).toMatch(/grantWelcomeGift\(db, uid, nowIso\)/);
    expect(bulkBody).not.toMatch(/tx\.update|updateDoc|setDoc|mirroredCreditPatch/);
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

  it('the retired ₹50 per-user route and button stay gone', () => {
    expect(route).not.toMatch(/\/api\/admin\/users\/:userId\/welcome-gift/);
    const panel = read('src/components/AdminDashboard.tsx');
    expect(panel).not.toMatch(/Gift ₹50/);
  });

  it('the panel sends the chosen days, shows why people are skipped, and sends back the count it showed', () => {
    const panel = read('src/components/AdminDashboard.tsx');
    expect(panel).toMatch(/adminPost\('\/api\/admin\/welcome-gift\/bulk', \{ dryRun: true, days: giftDays \}\)/);
    expect(panel).toMatch(/expectedCount: check\.eligible/);
    expect(panel).toMatch(/still have gift balance/);
    expect(panel).toMatch(/joined more than \$\{check\.days\} day/);
    expect(panel).toMatch(/Gift ₹150 to new users/);
  });
});
