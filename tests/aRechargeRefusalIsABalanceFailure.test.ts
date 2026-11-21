// failedbr #1322 (2026-11-20): KIMI refused with "429 Your credit balance is running low … please recharge immediately".
// It was filed as "1 rate-limit", so the rung stayed first on every build; the same account was later "suspended due to
// insufficient balance". A refusal that asks for a recharge is an account-balance failure.
import { describe, expect, it } from 'vitest';
import { isAccountBalanceFailure } from '../src/server/lib/providerAccountQuota';
import { isProviderBalanceError } from '../src/server/AgentV3/providerErrorClass';

describe('a recharge refusal is a balance failure (failedbr #1322)', () => {
  it.each([
    '429 Your credit balance is running low, please recharge immediately',
    '429 Your account org-d461124b is suspended due to insufficient balance, please recharge your account',
  ])('%s', (m) => {
    expect(isAccountBalanceFailure(m)).toBe(true);
    expect(isProviderBalanceError(m)).toBe(true);
  });
  it.each(['429 Too Many Requests', 'rate limit exceeded, retry after 2s', 'upstream timed out'])('not a balance failure: %s', (m) => {
    expect(isAccountBalanceFailure(m)).toBe(false);
  });
});
