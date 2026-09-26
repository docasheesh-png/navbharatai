import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  giftRemaining, paidSpendableTokens, giftAfterSpend, giftAfterGrant,
  checkPlanPayable, walletMayBuyWithItsBalance,
} from '../src/server/lib/giftSpend';
import { computePlanPurchase } from '../src/server/lib/hostingPlan';
import { computeDebitedWallet } from '../src/server/lib/walletDebit';
import { mirroredCreditPatch } from '../src/server/lib/walletMirror';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const STARTER = HOSTING_TIERS[0];
const PRICE_TOKENS = STARTER.priceInr * TOKENS_PER_RUPEE;
const AGREED = { agreedToTerms: true };

/** A wallet holding `tokens`, of which `gift` came from us. */
function w(tokens: number, gift: number, extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1', tokenBalance: tokens, totalTokensUsed: 0,
    remaining_balance: tokens / TOKENS_PER_RUPEE, walletLedger: [],
    giftTokensRemaining: gift, ...extra,
  };
}

describe('giftRemaining — how much of the balance is ours', () => {
  it('reads the tracked figure when it is there', () => {
    expect(giftRemaining(w(1000, 400))).toBe(400);
    expect(paidSpendableTokens(w(1000, 400))).toBe(600);
  });

  // A document can be stale or half-written; the gift can never exceed the money that exists.
  it('never claims more gift than there is balance', () => {
    expect(giftRemaining(w(300, 900))).toBe(300);
    expect(paidSpendableTokens(w(300, 900))).toBe(0);
  });

  it('treats a negative or unreadable figure as no gift rather than as a credit', () => {
    expect(giftRemaining(w(500, -200))).toBe(0);
    expect(giftRemaining({ tokenBalance: 500, giftTokensRemaining: 'x' as never, total_money_spent: 10 })).toBe(0);
  });

  it('a negative balance yields no gift and no paid money, never a negative one', () => {
    expect(giftRemaining(w(-800, 100))).toBe(0);
    expect(paidSpendableTokens(w(-800, 100))).toBe(0);
  });
});

describe('the migration — wallets that existed before this rule', () => {
  // The case the admin named, and the only one we can be certain about: they never paid us, so every
  // token they hold came from us.
  it('a never-paid wallet with no tracked figure is ALL gift', () => {
    const legacy = { tokenBalance: 50_000 };
    expect(walletMayBuyWithItsBalance(legacy)).toBe(false);
    expect(giftRemaining(legacy)).toBe(50_000);
    expect(paidSpendableTokens(legacy)).toBe(0);
  });

  // The opposite error — telling somebody who really paid that their money is not real — is worse
  // for them and for us, and unlike the case above it cannot be settled by arithmetic.
  it('a wallet that HAS paid before is trusted when the figure is missing', () => {
    expect(giftRemaining({ tokenBalance: 50_000, total_money_spent: 500 })).toBe(0);
    expect(giftRemaining({ tokenBalance: 50_000, lastRechargeAt: '2026-09-01T00:00:00.000Z' })).toBe(0);
  });

  it('an empty or blank recharge stamp is not a payment', () => {
    // ⚠️ RENAMED 2026-09-21 — same predicate, a name that says which question it answers.
    // `AgentV3/FreeTierBuildRouting` exports its own `hasEverPaid` with a deliberately different
    // rule, and two exports of one name on the money path is a wrong import waiting to happen.
    expect(walletMayBuyWithItsBalance({ tokenBalance: 10, lastRechargeAt: '' })).toBe(false);
    expect(walletMayBuyWithItsBalance({ tokenBalance: 10, lastRechargeAt: '   ' })).toBe(false);
    expect(walletMayBuyWithItsBalance({ tokenBalance: 10, total_money_spent: 0 })).toBe(false);
  });
});

describe('gift is spent FIRST — which is for the user, not against them', () => {
  it('ordinary spending eats the gift before the money the user paid for', () => {
    expect(giftAfterSpend(w(1000, 400), 250)).toBe(150);
  });

  it('once the gift is gone it stays at zero rather than going negative', () => {
    expect(giftAfterSpend(w(1000, 400), 900)).toBe(0);
  });

  it('a charge under one whole token changes nothing', () => {
    expect(giftAfterSpend(w(1000, 400), 0)).toBe(400);
  });

  // Without this, a user who topped up on top of a gift would burn their own money first and could
  // then be refused a plan they could genuinely afford.
  it('a build leaves the PAID part intact while gift remains', () => {
    const after = computeDebitedWallet(w(10_000, 4_000), { billedInr: 10, buildRef: 'b1', description: 'Build' }, 'now');
    expect(after.wallet.giftTokensRemaining).toBe(4_000 - 10 * TOKENS_PER_RUPEE);
    expect(paidSpendableTokens(after.wallet)).toBe(6_000);
  });
});

describe('a plan is bought with paid money only', () => {
  it('refuses a wallet whose balance is entirely the welcome gift', () => {
    const r = computePlanPurchase(w(PRICE_TOKENS * 2, PRICE_TOKENS * 2), '2026-09-13T00:00:00.000Z', 'starter', AGREED);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('gift_only');
    expect(r.giftTokens).toBe(PRICE_TOKENS * 2);
    expect(r.paidTokens).toBe(0);
    expect(r.shortfallTokens).toBe(PRICE_TOKENS);
  });

  it('allows it the moment enough of the balance is the user’s own money', () => {
    const r = computePlanPurchase(w(PRICE_TOKENS * 2, PRICE_TOKENS), '2026-09-13T00:00:00.000Z', 'starter', AGREED);
    expect(r.ok).toBe(true);
  });

  // The whole point: the plan takes paid money, so the gift is still there afterwards to build with.
  it('the purchase does NOT consume the gift', () => {
    const r = computePlanPurchase(w(PRICE_TOKENS * 3, PRICE_TOKENS), '2026-09-13T00:00:00.000Z', 'starter', AGREED);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.wallet.giftTokensRemaining).toBe(PRICE_TOKENS);
    expect(r.wallet.tokenBalance).toBe(PRICE_TOKENS * 2);
  });

  // "Too little of anything" and "enough, but none of it yours" are different problems and deserve
  // different sentences — so the plain shortfall is answered first.
  it('a genuinely empty wallet is still told it is empty, not lectured about gifts', () => {
    const r = computePlanPurchase(w(10, 10), '2026-09-13T00:00:00.000Z', 'starter', AGREED);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('insufficient');
  });

  it('a brand-new wallet starts with no gift, and no balance to buy a plan with', async () => {
    const { buildEmptyWallet } = await import('../src/server/lib/newWallet');
    const fresh = buildEmptyWallet({ userId: 'u1', email: 'a@b.c', name: 'A', nowIso: '2026-09-26T00:00:00.000Z' });
    expect(fresh.giftTokensRemaining).toBe(0);
    expect(fresh.freeGiftedTokens).toBe(0);
    const r = computePlanPurchase(fresh as Record<string, unknown>, '2026-09-26T00:00:00.000Z', 'starter', AGREED);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('insufficient');
  });
});

describe('every credit says whose money it is', () => {
  it('a gift credit raises the gift figure', () => {
    expect(mirroredCreditPatch(w(1000, 200), 500, 'gift').giftTokensRemaining).toBe(700);
    expect(giftAfterGrant(w(1000, 200), 500)).toBe(700);
  });

  it('a paid credit leaves it alone, so the new money is spendable on a plan', () => {
    const p = mirroredCreditPatch(w(1000, 200), 500, 'paid');
    expect(p.giftTokensRemaining).toBe(200);
    expect(p.tokenBalance - p.giftTokensRemaining).toBe(1300);
  });

  // An admin deduction must take the gift down with the balance, or the wallet ends up claiming more
  // gift than it holds money — the same two-views-disagreeing class walletMirror exists to prevent.
  it('a deduction clamps the gift to whatever balance survives', () => {
    expect(mirroredCreditPatch(w(1000, 800), -600, 'gift').giftTokensRemaining).toBe(400);
  });
});

describe('the rule is enforced where money moves, not only where it is read', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the plan purchase and its renewal both spend paid money only', () => {
    const plan = src('src/server/lib/hostingPlan.ts');
    expect(plan.match(/spends: 'paid-only'/g)?.length).toBe(2);
    // The renewal is gated too — otherwise the gift is barred at the door and let in a month later.
    expect(plan).toContain('checkPlanPayable(w, inrToDebitTokens(price))');
  });

  it('the refusal names the gift and what to add, and never blames the user', () => {
    const plan = src('src/server/lib/hostingPlan.ts');
    expect(plan).toContain('Your welcome gift is for building apps, not for buying a plan');
    expect(plan).toContain('your gift stays exactly where it is');
  });
});
