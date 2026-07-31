import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import { computeCreditedWallet, inrToWalletTokens, inrToDebitTokens, welcomeBonusTokens, TOKENS_PER_RUPEE, type WalletCreditTx } from '../src/server/lib/payments';

const T = '2026-07-05T00:00:00.000Z';
const EMPTY = { tokenBalance: 0, totalTokensPurchased: 0, totalMoneySpent: 0, remaining_balance: 0, total_balance: 0, walletLedger: [] };

describe('computeCreditedWallet — credit math', () => {
  it('standard order credits balanceAdded (₹) and balanceAdded×100 tokens onto the current wallet', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 100, balanceAdded: 100, isVishwakarmaOrder: false };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.tokenBalance).toBe(10000);
    expect(wallet.remaining_balance).toBe(100);
    expect(wallet.total_balance).toBe(100);
    expect(wallet.totalMoneySpent).toBe(100);
    expect(wallet.walletLedger).toHaveLength(1);
  });

  it('vishwakarma order with buyPass credits (paid − pass)×100 tokens and sets the pass', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 150, balanceAdded: 150, isVishwakarmaOrder: true, buyPass: true };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.tokenBalance).toBe(5000); // (150 − 100 pass) × 100
    expect(wallet.hasVishwakarmaPass).toBe(true);
    expect(wallet.remaining_balance).toBe(150);
  });

  it('applies a pending promo (1000 bonus tokens + pass) and reports promoApplied', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 100, balanceAdded: 100, isVishwakarmaOrder: false };
    const { wallet, promoApplied } = computeCreditedWallet(EMPTY, tx, { mode: 'engineer' }, T);
    expect(promoApplied).toBe(true);
    expect(wallet.tokenBalance).toBe(1000); // promo path: 1000 tokens (not the purchased fallback)
    expect(wallet.hasVishwakarmaPass).toBe(true);
    expect(wallet.unlockedModes).toContain('engineer');
  });

  it('CONCURRENCY: crediting the RESULT of a prior credit ACCUMULATES (no lost update on tx retry)', () => {
    // This is exactly what the transaction does when it retries after a concurrent commit: it re-reads
    // the already-credited wallet and applies the next delta on top. Balances must add up, not clobber.
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 100, balanceAdded: 100, isVishwakarmaOrder: false };
    const first = computeCreditedWallet(EMPTY, tx, null, T).wallet;
    const second = computeCreditedWallet(first, tx, null, T).wallet;
    expect(second.tokenBalance).toBe(20000);     // 10000 + 10000, not 10000
    expect(second.remaining_balance).toBe(200);  // 100 + 100
    expect(second.totalMoneySpent).toBe(200);
    expect(second.walletLedger).toHaveLength(2); // both purchases recorded
  });

  it('preserves unrelated existing wallet fields (full merge, not a reset)', () => {
    const existing = { ...EMPTY, tokenBalance: 500, totalTokensUsed: 42, someOtherField: 'keep-me' };
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 10, balanceAdded: 10, isVishwakarmaOrder: false };
    const { wallet } = computeCreditedWallet(existing, tx, null, T);
    expect(wallet.tokenBalance).toBe(1500);      // 500 + 1000
    expect(wallet.totalTokensUsed).toBe(42);     // untouched
    expect(wallet.someOtherField).toBe('keep-me'); // untouched
  });

  it('treats missing/NaN numeric fields as 0 (never produces NaN in a balance)', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 50, balanceAdded: 50, isVishwakarmaOrder: false };
    const { wallet } = computeCreditedWallet({}, tx, null, T);
    expect(Number.isFinite(wallet.tokenBalance)).toBe(true);
    expect(wallet.remaining_balance).toBe(50);
  });
});

describe('inrToWalletTokens — the ONE ₹→token conversion every surface shares (Billing Phase 2)', () => {
  it('converts at TOKENS_PER_RUPEE with rounding', () => {
    expect(inrToWalletTokens(1)).toBe(TOKENS_PER_RUPEE);
    expect(inrToWalletTokens(25)).toBe(2500);
    expect(inrToWalletTokens(0.104)).toBe(10); // 10.4 → rounds
    expect(inrToWalletTokens(0.105)).toBe(11); // 10.5 → rounds up
  });

  it('is SIGNED — an overdraft (negative ₹) shows as negative tokens, never hidden', () => {
    expect(inrToWalletTokens(-4)).toBe(-400);
  });

  it('non-finite input converts to 0 (never NaN in a display)', () => {
    expect(inrToWalletTokens(NaN)).toBe(0);
    expect(inrToWalletTokens(Infinity)).toBe(0);
    expect(inrToWalletTokens(-Infinity)).toBe(0);
  });

  it('matches the credit path: ₹X purchase mints exactly inrToWalletTokens(X) tokens', () => {
    const tx: WalletCreditTx = { userId: 'u1', amountPaid: 77, balanceAdded: 77, isVishwakarmaOrder: false };
    const { wallet } = computeCreditedWallet(EMPTY, tx, null, T);
    expect(wallet.tokenBalance).toBe(inrToWalletTokens(77));
  });
});

describe('inrToDebitTokens — the DEBIT conversion is EXACT, not rounded up', () => {
  // It used to ceil, for margin protection. Two problems. The user was charged up to ₹0.01 more than
  // the build really cost, on every build — and the ceil went into `tokenBalance` while
  // `remaining_balance` moved by the paisa-rounded ₹, so the wallet's two views of one balance drifted
  // apart a little further each time. The remainder is now CARRIED to the next charge
  // (computeDebitedWallet), so no margin is given away — it is only deferred by at most ₹0.01.
  it('a whole-token amount is unchanged', () => {
    expect(inrToDebitTokens(25)).toBe(2500);
    expect(inrToDebitTokens(1)).toBe(TOKENS_PER_RUPEE);
  });

  it('keeps the fraction instead of inventing a whole token out of it', () => {
    expect(inrToDebitTokens(0.301)).toBe(30.1);
    expect(inrToDebitTokens(0.304)).toBe(30.4);
    expect(inrToDebitTokens(0.305)).toBe(30.5);
    // The case that mattered most: a per-message charge. Ceiling this to a whole token would have
    // billed ₹0.01 for ₹0.002 of real cost — five times over, on one wallet spent everywhere.
    expect(inrToDebitTokens(0.002)).toBe(0.2);
  });

  it('scrubs IEEE-754 float noise so a clean ₹ stays clean', () => {
    // 0.3 * 100 === 30.000000000000004 in IEEE-754.
    expect(inrToDebitTokens(0.1 + 0.2)).toBe(30);
    expect(inrToDebitTokens(0.3)).toBe(30);
  });

  it('non-finite / non-positive → 0', () => {
    expect(inrToDebitTokens(0)).toBe(0);
    expect(inrToDebitTokens(-5)).toBe(0);
    expect(inrToDebitTokens(NaN)).toBe(0);
    expect(inrToDebitTokens(Infinity)).toBe(0);
  });
});

describe('welcomeBonusTokens — new-wallet mint (admin routing plan 2026-07-11)', () => {
  const ORIG = process.env.WELCOME_BONUS_TOKENS;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.WELCOME_BONUS_TOKENS;
    else process.env.WELCOME_BONUS_TOKENS = ORIG;
  });

  it('defaults to 25,000 tokens (₹250 — the opening rung of the free gift ladder)', () => {
    // Lowered from 50,000 (₹500) on 2026-07-28. The old figure came from the era when the signup bonus
    // was the ONLY free credit and had to carry a first build on its own; it is now the first rung of
    // ₹250 → +₹200 → +₹200 → cut off (see weeklyTopUp.ts), so it no longer has to.
    delete process.env.WELCOME_BONUS_TOKENS;
    expect(welcomeBonusTokens()).toBe(25_000);
    expect(welcomeBonusTokens() / TOKENS_PER_RUPEE).toBe(250); // the ₹ mirror derives cleanly
  });

  it('is env-overridable from Cloud Run (no deploy needed to tune it)', () => {
    process.env.WELCOME_BONUS_TOKENS = '10000';
    expect(welcomeBonusTokens()).toBe(10_000);
    process.env.WELCOME_BONUS_TOKENS = '0'; // switching the bonus off entirely is a valid choice
    expect(welcomeBonusTokens()).toBe(0);
  });

  it('a bad override (non-numeric / negative) falls back to the default, never NaN', () => {
    process.env.WELCOME_BONUS_TOKENS = 'lots';
    expect(welcomeBonusTokens()).toBe(25_000);
    process.env.WELCOME_BONUS_TOKENS = '-5';
    expect(welcomeBonusTokens()).toBe(25_000);
  });
});
