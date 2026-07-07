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

  it('unknown → null: missing doc, missing/non-numeric field, NaN', async () => {
    expect(await readWalletBalanceInr(reader(null), 'u1')).toBeNull(); // no wallet doc yet
    expect(await readWalletBalanceInr(reader({}), 'u1')).toBeNull(); // field absent
    expect(await readWalletBalanceInr(reader({ remaining_balance: 'x' }), 'u1')).toBeNull();
    expect(await readWalletBalanceInr(reader({ remaining_balance: NaN }), 'u1')).toBeNull();
    expect(await readWalletBalanceInr(reader({ remaining_balance: Infinity }), 'u1')).toBeNull();
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
