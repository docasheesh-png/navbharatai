// DB-2: every wallet CREDIT must land on the same canonical (merged) wallet the debits use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { creditWalletId } from '../src/server/lib/walletCreditTarget';
import { WalletOwnerResolutionError } from '../src/server/lib/walletResolve';

const chain: Record<string, string | null> = { b: 'a', a: null, c: 'd', d: 'c' };
const read = async (_db: unknown, u: string) => chain[u] ?? null;

describe('creditWalletId', () => {
  it('is a no-op while WALLET_MERGE_RESOLVE is off (old behaviour)', async () => {
    expect(await creditWalletId({}, 'b', {} as NodeJS.ProcessEnv, read)).toBe('b');
  });
  it('follows mergedInto when the switch is on', async () => {
    expect(await creditWalletId({}, 'b', { WALLET_MERGE_RESOLVE: 'on' } as any, read)).toBe('a');
  });
  it('fails closed on a cyclic merge chain', async () => {
    await expect(creditWalletId({}, 'c', { WALLET_MERGE_RESOLVE: 'on' } as any, read))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });
  it('fails closed when the merge pointer read fails instead of crediting the raw uid', async () => {
    const boom = async () => { throw new Error('x'); };
    await expect(creditWalletId({}, 'b', { WALLET_MERGE_RESOLVE: 'on' } as any, boom))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });
});

describe('financial wallet paths fail closed on canonical-owner uncertainty', () => {
  const files = [
    'src/server/lib/walletCreditTarget.ts', 'src/server/lib/walletDebit.ts',
    'src/server/lib/paymentReversalStore.ts', 'src/server/lib/hostingPlan.ts',
    'src/server/lib/hostingAddonLedger.ts', 'src/server/lib/voiceAiStore.ts',
    'src/server/AgentV3/WalletBalance.ts', 'src/server/routes/wallet.ts',
  ];
  for (const file of files) {
    it(file, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('resolveCanonicalWalletIdStrict');
      expect(source).not.toMatch(/resolveCanonicalWalletId\(/);
      expect(source).not.toContain('.catch(() => uid)');
      expect(source).not.toContain('.catch(() => userId)');
      expect(source).not.toContain('.catch(() => buyerUid)');
    });
  }
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
