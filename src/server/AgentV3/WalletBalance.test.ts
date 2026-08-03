import { describe, it, expect } from 'vitest';
import { readWalletBalanceInr, type WalletReader } from './WalletBalance';

const reader = (data: unknown): WalletReader => async () => data as any;
const throwing: WalletReader = async () => {
  throw new Error('firestore down');
};

describe('readWalletBalanceInr — fail-open wallet balance read', () => {
  it('returns a real numeric remaining_balance (including negative within overdraft)', async () => {
    expect(await readWalletBalanceInr(reader({ remaining_balance: 55 }), 'u1')).toBe(55);
    expect(await readWalletBalanceInr(reader({ remaining_balance: 0 }), 'u1')).toBe(0);
    expect(await readWalletBalanceInr(reader({ remaining_balance: -12.5 }), 'u1')).toBe(-12.5);
  });

  it('unknown → null ONLY when neither ₹ nor token balance is present', async () => {
    expect(await readWalletBalanceInr(reader(null), 'u1')).toBeNull(); // no wallet doc yet
    expect(await readWalletBalanceInr(reader({}), 'u1')).toBeNull(); // neither field
    expect(await readWalletBalanceInr(reader({ remaining_balance: 'x' }), 'u1')).toBeNull(); // both non-numeric/absent
    expect(await readWalletBalanceInr(reader({ remaining_balance: NaN }), 'u1')).toBeNull();
    expect(await readWalletBalanceInr(reader({ remaining_balance: Infinity, tokenBalance: 'y' }), 'u1')).toBeNull();
  });

  it('FALLBACK to tokenBalance (₹ = tokens/100) when remaining_balance is absent — no fail-open free build', async () => {
    // The reported bug: a wallet with 0 tokens and no ₹ mirror must read as ₹0 (blockable), not null.
    expect(await readWalletBalanceInr(reader({ tokenBalance: 0 }), 'u1')).toBe(0);
    expect(await readWalletBalanceInr(reader({ tokenBalance: 500 }), 'u1')).toBe(5); // 500 tokens = ₹5
    // UNIFIED: when BOTH are present the higher wins (here the ₹ mirror, 12 > 999/100 = 9.99).
    expect(await readWalletBalanceInr(reader({ remaining_balance: 12, tokenBalance: 999 }), 'u1')).toBe(12);
    // remaining_balance non-numeric but tokenBalance present → derive from tokens
    expect(await readWalletBalanceInr(reader({ remaining_balance: null, tokenBalance: 250 }), 'u1')).toBe(2.5);
  });

  it('GIFT-TOKEN bug (admin 2026-08-03): ₹0 mirror + gifted tokens reads as the SPENDABLE token value, not ₹0', async () => {
    // The exact report: admin gifts 50,000 tokens, wallet shows remaining_balance 0 (₹ mirror not synced)
    // + tokenBalance 50000 → the gate used to read ₹0 and refuse the build. Now the token value counts.
    expect(await readWalletBalanceInr(reader({ remaining_balance: 0, tokenBalance: 50000 }), 'u1')).toBe(500); // 50k/100 = ₹500 → can build
    expect(await readWalletBalanceInr(reader({ remaining_balance: 0, tokenBalance: 100 }), 'u1')).toBe(1);
    // a genuinely empty wallet (both zero) still reads ₹0 → blockable (no free build)
    expect(await readWalletBalanceInr(reader({ remaining_balance: 0, tokenBalance: 0 }), 'u1')).toBe(0);
  });

  it('FAIL-OPEN: a reader that throws yields null (never propagates, never blocks a build)', async () => {
    await expect(readWalletBalanceInr(throwing, 'u1')).resolves.toBeNull();
  });

  it('empty userId → null (no read attempted)', async () => {
    let called = false;
    const spy: WalletReader = async () => {
      called = true;
      return { remaining_balance: 99 };
    };
    expect(await readWalletBalanceInr(spy, '')).toBeNull();
    expect(called).toBe(false);
  });
});
