import { describe, expect, it } from 'vitest';
import type { InferenceGatewayContext, GatewayFundingBoundary } from './context';
import { resolveGatewayFundingAuthority } from './fundingAuthority';

function context(overrides: Partial<InferenceGatewayContext> = {}): InferenceGatewayContext {
  return {
    principalId: 'verified-user', tenantId: 'verified-user', surface: 'chat',
    policyKey: 'chat:text', qualityTier: 'standard', dataClass: 'confidential',
    funding: 'platform-free-fallback', mode: 'free-first-authorized-paid',
    deadlineAtMs: 1_800_000_000_000, ...overrides,
  };
}

describe('gateway funding boundary resolution, not spend authorization', () => {
  it.each(['chat', 'professional'] as const)('%s can only request real platform authority', surface => {
    const result = resolveGatewayFundingAuthority(context({ surface }), 'verified-user');
    expect(result).toEqual({ kind: 'platform-authority-required' });
    expect(Object.isFrozen(result)).toBe(true);
    // No budget, balance, payer, hold or reusable dispatch permit is synthesized.
    expect(Object.keys(result)).toEqual(['kind']);
  });

  it.each([null, undefined, '', '   ', 'different-user', 'x'.repeat(257)])('rejects missing/mismatched authenticated UID %j', uid => {
    expect(resolveGatewayFundingAuthority(context(), uid)).toEqual({ kind: 'unavailable', reason: 'context-unverified' });
  });

  it('does not treat a context/body UID or claimed funding balance as identity proof', () => {
    const claimed = { ...context(), authenticated: true, uid: 'verified-user', walletBalanceInr: 1_000_000,
      paid: true, hasActivePass: true, isFreeListed: true };
    expect(resolveGatewayFundingAuthority(claimed, null)).toEqual({ kind: 'unavailable', reason: 'context-unverified' });
    expect(resolveGatewayFundingAuthority(undefined, 'verified-user')).toEqual({ kind: 'unavailable', reason: 'context-unverified' });
  });

  it('cannot transfer a verified principal into another tenant or wallet owner', () => {
    expect(resolveGatewayFundingAuthority(context({ tenantId: 'other-owner' }), 'verified-user'))
      .toEqual({ kind: 'unavailable', reason: 'context-unverified' });
    expect(resolveGatewayFundingAuthority(context({ principalId: 'other-owner', tenantId: 'other-owner' }), 'verified-user'))
      .toEqual({ kind: 'unavailable', reason: 'context-unverified' });
  });

  it.each([
    ['existing-professional', 'professional-predispatch-reservation'],
    ['existing-tenant', 'tenant-predispatch-reservation'],
    ['funded-builder', 'builder-predispatch-reservation'],
    ['tenant-byok', 'byok-account-authorization'],
  ] as const)('%s stays unavailable, even with existing positive balance and exemptions', (funding, missingAuthority) => {
    const claimed = { ...context({ funding }), walletBalanceInr: 1_000_000,
      remainingDailyCapInr: 500, hasActivePass: true, isFreeListed: true, gateAllowed: true };
    expect(resolveGatewayFundingAuthority(claimed, 'verified-user')).toEqual({
      kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority,
    });
    // Strict-free mode does not establish tenant quota ownership either.
    expect(resolveGatewayFundingAuthority({ ...claimed, mode: 'strict-free' } as InferenceGatewayContext, 'verified-user'))
      .toEqual(resolveGatewayFundingAuthority(claimed, 'verified-user'));
  });

  it.each(['builder', 'developer-api', 'published-app', 'image-generation', 'image-enhancement', 'doctor', 'sda'] as const)(
    'does not divert %s to the platform fallback pool even when mislabeled', surface => {
      expect(resolveGatewayFundingAuthority(context({ surface }), 'verified-user')).toEqual({
        kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority: 'surface-funding-mismatch',
      });
    },
  );

  it('fails closed for unknown funding boundaries and future surfaces', () => {
    expect(resolveGatewayFundingAuthority(context({ funding: 'new-wallet' as GatewayFundingBoundary }), 'verified-user')).toEqual({
      kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority: 'unknown-funding-boundary',
    });
    expect(resolveGatewayFundingAuthority(context({ surface: 'new-surface' as InferenceGatewayContext['surface'] }), 'verified-user')).toEqual({
      kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority: 'surface-funding-mismatch',
    });
  });

  it('concurrent requests and retries never convert a read gate into owned capacity', async () => {
    const calls = Array.from({ length: 32 }, () => Promise.resolve().then(() =>
      resolveGatewayFundingAuthority(context({ funding: 'existing-tenant' }), 'verified-user')));
    const results = await Promise.all(calls);
    expect(results).toHaveLength(32);
    for (const result of results) expect(result).toEqual({
      kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority: 'tenant-predispatch-reservation',
    });
  });
});
