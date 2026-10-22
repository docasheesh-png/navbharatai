import { describe, it, expect, afterEach } from 'vitest';
import { giftAfterSpend } from '../src/server/lib/giftSpend';
import { computeDebitedWallet, computeRolledUpDebit } from '../src/server/lib/walletDebit';
import { readWalletBalanceInr } from '../src/server/AgentV3/WalletBalance';
import { maskWalletForView } from '../src/server/lib/freeProgram';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';

/**
 * PAY AND USE ONLY (admin 2026-10-22): "free token wapas nahi aane chahiye — mere paas paise hi nahi hain."
 *
 * The first cut hid the gift from an account that had NEVER paid — so a ₹10 top-up unmasked the lot, and (because the debit
 * eats gift first) every ₹10 account could then spend up to ₹400 of NavBharatAI's money. While the free program is paused
 * the gift is now untouchable for EVERYONE: the gates read the user's own money, the debit takes the user's own money
 * first, a hold needs their own money, and a paying account is shown only its own balance. Resuming restores it all.
 */
afterEach(() => setFreeProgramPausedHint(null));

// ₹10 paid (1,000 tokens) on top of a 40,000-token gift. 100 tokens = ₹1.
const PAID_ON_GIFT = {
  userId: 'u1', tokenBalance: 41_000, remaining_balance: 410, totalMoneySpent: 10, lastRechargeAt: '2026-10-22T00:00:00Z',
  giftTokensRemaining: 40_000, freeGiftedTokens: 40_000, walletLedger: [],
};
const GIFT_ONLY = { userId: 'u2', tokenBalance: 40_000, remaining_balance: 400, totalMoneySpent: 0, giftTokensRemaining: 40_000, freeGiftedTokens: 40_000, walletLedger: [] };
const NOW = '2026-10-22T10:00:00.000Z';

describe('the debit takes the user\'s own money first', () => {
  it('live: the gift is eaten first (the old behaviour, unchanged)', () => {
    setFreeProgramPausedHint(false);
    const r = computeDebitedWallet({ ...PAID_ON_GIFT }, { billedInr: 5, buildRef: 'b1', description: 'Build' } as never, NOW);
    expect(r.applied).toBe(true);
    expect(r.wallet.giftTokensRemaining).toBe(39_500);
  });
  it('paused: ₹5 comes out of the ₹10 the user paid; the gift is untouched', () => {
    setFreeProgramPausedHint(true);
    const r = computeDebitedWallet({ ...PAID_ON_GIFT }, { billedInr: 5, buildRef: 'b1', description: 'Build' } as never, NOW);
    expect(r.wallet.tokenBalance).toBe(40_500);
    expect(r.wallet.giftTokensRemaining).toBe(40_000);
  });
  it('paused: a chat-turn rollup does the same', () => {
    setFreeProgramPausedHint(true);
    const r = computeRolledUpDebit({ ...PAID_ON_GIFT }, { billedInr: 2, rollupRef: 'ai_2026-10-22', description: 'AI' } as never, NOW);
    expect(r.wallet.tokenBalance).toBe(40_800);
    expect(r.wallet.giftTokensRemaining).toBe(40_000);
  });
  it('the gift only shrinks when the balance itself falls below it (the overshoot of a build already under way)', () => {
    expect(giftAfterSpend({ tokenBalance: 40_100, giftTokensRemaining: 40_000 }, 500, true)).toBe(39_600);
    expect(giftAfterSpend({ tokenBalance: 41_000, giftTokensRemaining: 40_000 }, 500, true)).toBe(40_000);
  });
});

describe('a price taken before the work needs the user\'s own money', () => {
  const hold = { billedInr: 1, rollupRef: 'img_2026-10-22', description: 'Image', allOrNothing: true, floorInr: 0, holdId: 'h1' };
  it('paused: a wallet holding only gift is refused like an empty one', () => {
    setFreeProgramPausedHint(true);
    const r = computeRolledUpDebit({ ...GIFT_ONLY }, hold as never, NOW);
    expect(r.refused).toBe(true);
    expect(r.applied).toBe(false);
  });
  it('paused: ₹10 of their own money is enough for a ₹1 hold, and the gift stays', () => {
    setFreeProgramPausedHint(true);
    const r = computeRolledUpDebit({ ...PAID_ON_GIFT }, hold as never, NOW);
    expect(r.applied).toBe(true);
    expect(r.wallet.giftTokensRemaining).toBe(40_000);
  });
  it('live: the gift-only wallet can still pay (nothing changes until the pause is on)', () => {
    setFreeProgramPausedHint(false);
    expect(computeRolledUpDebit({ ...GIFT_ONLY }, hold as never, NOW).applied).toBe(true);
  });
});

describe('the gates read the user\'s own money', () => {
  it('paused: ₹410 on the document is ₹10 to every gate', async () => {
    setFreeProgramPausedHint(true);
    expect(await readWalletBalanceInr(async () => ({ ...PAID_ON_GIFT }), 'u1')).toBeCloseTo(10, 5);
    expect(await readWalletBalanceInr(async () => ({ ...GIFT_ONLY }), 'u2')).toBeCloseTo(0, 5);
  });
  it('live: the whole balance counts, as before', async () => {
    setFreeProgramPausedHint(false);
    expect(await readWalletBalanceInr(async () => ({ ...PAID_ON_GIFT }), 'u1')).toBeCloseTo(410, 5);
  });
  it('an unknown balance is still unknown (fail-open is not made worse)', async () => {
    setFreeProgramPausedHint(true);
    expect(await readWalletBalanceInr(async () => null, 'u1')).toBeNull();
  });
});

describe('what a paying account is shown', () => {
  it('paused: its own ₹10, no gift, no "free trial" wording — and the stored document is untouched', () => {
    const before = JSON.stringify(PAID_ON_GIFT);
    const v = maskWalletForView({ ...PAID_ON_GIFT }, true) as Record<string, unknown>;
    expect(v.tokenBalance).toBe(1_000);
    expect(v.remaining_balance).toBe(10);
    expect(v.giftTokensRemaining).toBe(0);
    expect(v.freeTrialEnded).toBeUndefined();
    expect(JSON.stringify(PAID_ON_GIFT)).toBe(before);
  });
  it('a paying account with no gift, and any account when live, is shown as it is', () => {
    const plain = { tokenBalance: 500, remaining_balance: 5, totalMoneySpent: 5, giftTokensRemaining: 0 };
    expect(maskWalletForView({ ...plain }, true)).toEqual(plain);
    expect(maskWalletForView({ ...PAID_ON_GIFT }, false)).toEqual(PAID_ON_GIFT);
  });
});
