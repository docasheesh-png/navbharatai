// DB-2: every wallet CREDIT must land on the same canonical (merged) wallet the debits use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { creditWalletId } from '../src/server/lib/walletCreditTarget';

const chain: Record<string, string | null> = { b: 'a', a: null, c: 'd', d: 'c' };
const read = async (_db: unknown, u: string) => chain[u] ?? null;

describe('creditWalletId', () => {
  it('is a no-op while WALLET_MERGE_RESOLVE is off (old behaviour)', async () => {
    expect(await creditWalletId({}, 'b', {} as NodeJS.ProcessEnv, read)).toBe('b');
  });
  it('follows mergedInto when the switch is on', async () => {
    expect(await creditWalletId({}, 'b', { WALLET_MERGE_RESOLVE: 'on' } as any, read)).toBe('a');
  });
  it('is cycle-safe', async () => {
    const id = await creditWalletId({}, 'c', { WALLET_MERGE_RESOLVE: 'on' } as any, read);
    expect(['c', 'd']).toContain(id);
  });
  it('falls back to the raw uid when the read fails', async () => {
    const boom = async () => { throw new Error('x'); };
    expect(await creditWalletId({}, 'b', { WALLET_MERGE_RESOLVE: 'on' } as any, boom)).toBe('b');
  });
});

describe('no credit path writes to the raw uid wallet', () => {
  const files = [
    'src/server/lib/payments.ts', 'src/server/routes/payment.ts', 'src/server/lib/adminPromoStore.ts',
    'src/server/lib/giftCodeStore.ts', 'src/server/routes/referral.ts',
  ];
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(f, 'utf8');
      const raw = src.match(/doc\(db, 'user_token_wallets', (?!await creditWalletId|creditOwner)[^)]*\)/g) ?? [];
      expect(raw).toEqual([]);
    });
  }
});
