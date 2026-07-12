import { describe, it, expect } from 'vitest';
import { welcomeGrantTokens, buildInitialWallet } from './welcomeBonus';
import { welcomeBonusTokens } from './payments';

describe('welcomeGrantTokens — the welcome bonus is granted at most once, ever', () => {
  it('grants the configured bonus for a user who has NEVER received it', () => {
    expect(welcomeGrantTokens(false)).toBe(welcomeBonusTokens());
    expect(welcomeGrantTokens(false)).toBeGreaterThan(0);
  });

  it('grants ZERO when the durable marker already exists (the logout→login farm is dead)', () => {
    expect(welcomeGrantTokens(true)).toBe(0);
  });
});

describe('buildInitialWallet — a re-created wallet never fakes free tokens', () => {
  const now = '2026-07-12T00:00:00.000Z';

  it('first grant: full bonus, a matching ₹ mirror, and one ledger row', () => {
    const tokens = welcomeBonusTokens();
    const w = buildInitialWallet({ userId: 'u1', email: 'a@b.com', name: 'A', welcomeTokens: tokens, nowIso: now });
    expect(w.tokenBalance).toBe(tokens);
    expect(w.totalTokensPurchased).toBe(tokens);
    expect(w.remaining_balance).toBe(tokens / 100); // TOKENS_PER_RUPEE = 100
    expect(w.total_balance).toBe(tokens / 100);
    expect((w.walletLedger as unknown[]).length).toBe(1);
  });

  it('re-grant blocked (0 tokens): empty wallet, ₹0, and NO fake "Welcome Bonus" ledger row', () => {
    const w = buildInitialWallet({ userId: 'u1', email: 'a@b.com', name: 'A', welcomeTokens: 0, nowIso: now });
    expect(w.tokenBalance).toBe(0);
    expect(w.totalTokensPurchased).toBe(0);
    expect(w.remaining_balance).toBe(0);
    expect(w.total_balance).toBe(0);
    expect(w.walletLedger).toEqual([]); // no free-bonus row on a recreation
  });

  it('carries the identity fields through', () => {
    const w = buildInitialWallet({ userId: 'u9', email: 'x@y.z', name: 'X', welcomeTokens: 0, nowIso: now });
    expect(w.userId).toBe('u9');
    expect(w.userEmail).toBe('x@y.z');
    expect(w.userName).toBe('X');
    expect(w.updatedAt).toBe(now);
  });
});
