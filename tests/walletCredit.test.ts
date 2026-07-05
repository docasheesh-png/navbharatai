import { describe, it, expect } from 'vitest';
import { computeCreditedWallet, type WalletCreditTx } from '../src/server/lib/payments';

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
