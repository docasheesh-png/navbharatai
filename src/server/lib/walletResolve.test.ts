import { describe, it, expect } from 'vitest';
import { resolveCanonicalWalletId, resolveCanonicalWalletIdStrict, WalletOwnerResolutionError, walletMergeResolveEnabled } from './walletResolve';

describe('walletMergeResolveEnabled', () => {
  it('is OFF by default and only "on" enables it', () => {
    expect(walletMergeResolveEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(walletMergeResolveEnabled({ WALLET_MERGE_RESOLVE: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(walletMergeResolveEnabled({ WALLET_MERGE_RESOLVE: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('resolveCanonicalWalletId', () => {
  const chain = (map: Record<string, string>) => async (uid: string) => map[uid] ?? null;

  it('returns the uid unchanged when not merged', async () => {
    expect(await resolveCanonicalWalletId(chain({}), 'A')).toBe('A');
  });

  it('follows a single merge pointer', async () => {
    expect(await resolveCanonicalWalletId(chain({ B: 'A' }), 'B')).toBe('A');
  });

  it('follows a multi-hop chain to the canonical account', async () => {
    expect(await resolveCanonicalWalletId(chain({ C: 'B', B: 'A' }), 'C')).toBe('A');
  });

  it('is cycle-safe (A→B→A resolves without looping)', async () => {
    expect(await resolveCanonicalWalletId(chain({ A: 'B', B: 'A' }), 'A')).toBe('B');
  });

  it('is self-pointer-safe (A→A)', async () => {
    expect(await resolveCanonicalWalletId(chain({ A: 'A' }), 'A')).toBe('A');
  });

  it('stops at the hop bound and returns the deepest reached', async () => {
    const longChain: Record<string, string> = { A: 'B', B: 'C', C: 'D', D: 'E', E: 'F', F: 'G' };
    expect(await resolveCanonicalWalletId(chain(longChain), 'A', 3)).toBe('D'); // A→B→C→D (3 hops)
  });

  it('FAILS SAFE — a reader throw resolves to the last known id (never blocks a wallet op)', async () => {
    const reader = async () => { throw new Error('firestore down'); };
    expect(await resolveCanonicalWalletId(reader, 'B')).toBe('B');
  });

  it('ignores a non-string / empty pointer', async () => {
    expect(await resolveCanonicalWalletId(async () => '' as any, 'A')).toBe('A');
    expect(await resolveCanonicalWalletId(async () => undefined, 'A')).toBe('A');
  });
});


describe('resolveCanonicalWalletIdStrict (financial paths)', () => {
  const chain = (map: Record<string, string>) => async (uid: string) => map[uid] ?? null;

  it('resolves a valid multi-hop merge chain', async () => {
    expect(await resolveCanonicalWalletIdStrict(chain({ A: 'B', B: 'C' }), 'A')).toBe('C');
  });

  it('returns the current uid only when the pointer is terminal', async () => {
    expect(await resolveCanonicalWalletIdStrict(chain({}), 'A')).toBe('A');
    expect(await resolveCanonicalWalletIdStrict(chain({ A: 'A' }), 'A')).toBe('A');
  });

  it('fails closed when the Firestore pointer read throws', async () => {
    await expect(resolveCanonicalWalletIdStrict(async () => { throw new Error('firestore down'); }, 'A'))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });

  it('fails closed on cycles instead of returning an arbitrary member', async () => {
    await expect(resolveCanonicalWalletIdStrict(chain({ A: 'B', B: 'A' }), 'A'))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });

  it('fails closed when merge metadata is malformed', async () => {
    await expect(resolveCanonicalWalletIdStrict(async () => '' as any, 'A'))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });

  it('fails closed when the merge chain exceeds the configured hop bound', async () => {
    const longChain: Record<string, string> = { A: 'B', B: 'C', C: 'D', D: 'E' };
    await expect(resolveCanonicalWalletIdStrict(chain(longChain), 'A', 2))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
  });
});


describe('strict wallet resolution never normalizes account identity', () => {
  it.each([' A', 'A '])('rejects malformed starting uid %j before reading any wallet', async (uid) => {
    const lookedUp: string[] = [];
    await expect(resolveCanonicalWalletIdStrict(async id => { lookedUp.push(id); return null; }, uid))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
    expect(lookedUp).toEqual([]);
  });

  it.each([' B', 'B '])('rejects malformed pointer %j without looking up the normalized account', async (pointer) => {
    const lookedUp: string[] = [];
    await expect(resolveCanonicalWalletIdStrict(async id => { lookedUp.push(id); return pointer; }, 'A'))
      .rejects.toBeInstanceOf(WalletOwnerResolutionError);
    expect(lookedUp).toEqual(['A']);
    expect(lookedUp).not.toContain('B');
  });
});
