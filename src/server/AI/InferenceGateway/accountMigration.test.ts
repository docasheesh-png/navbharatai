import { describe, expect, it } from 'vitest';
import { gatewayAccountCooldownPath, gatewayAccountFencePath, gatewayAccountScopeIds, readGatewayAccountAuthority, type GatewayAccountFence } from './accountMigration';
import type { QuotaDimension } from './types';

const now = 1_800_000_000_000;
const dimensions: QuotaDimension[] = [
  { scope: { providerId: 'GLM', kind: 'account', id: 'canonical-account' }, meter: 'tokens/minute' },
  { scope: { providerId: 'GLM', kind: 'account', id: 'canonical-account' }, meter: 'requests/day' },
  { scope: { providerId: 'GLM', kind: 'model', id: 'reviewed-model' }, meter: 'requests/minute' },
];
const review = (): GatewayAccountFence => ({ kind: 'gateway_account_owner', version: 2, provider: 'glm', migrationId: 'review-v2',
  authority: 'gateway-local-capacity', accountScopeIds: ['canonical-account'], credentialBindings: ['a'.repeat(64)],
  accountReviewRef: 'independent-account-review', upstreamQuota: 'unknown', reviewedAtMs: now - 100, expiresAtMs: now + 1000 });

describe('reviewed shared-account local capacity', () => {
  it('permits explicitly unknown upstream allowance without claiming exclusive legacy ownership', () => {
    expect(readGatewayAccountAuthority(review(), dimensions, now)).toMatchObject({ upstreamQuota: 'unknown', authority: 'gateway-local-capacity' });
  });
  it('uses one canonical account identity across model aliases and overlapping meters', () => {
    const ids = gatewayAccountScopeIds(dimensions); expect(ids).toEqual(['canonical-account']);
    const alias = dimensions.map(d => d.scope.kind === 'model' ? { ...d, scope: { ...d.scope, id: 'another-alias' } } : d);
    expect(gatewayAccountFencePath('glm', gatewayAccountScopeIds(alias))).toBe(gatewayAccountFencePath('glm', ids));
    expect(gatewayAccountCooldownPath('glm', gatewayAccountScopeIds(alias))).toBe(gatewayAccountCooldownPath('glm', ids));
    expect(gatewayAccountFencePath('glm', ['org', 'account', 'account'])).toBe(gatewayAccountFencePath('glm', ['account', 'org']));
  });
  it('does not make rotated credential generations new quota/account identities', () => {
    const current = review(); const rotated = { ...current, credentialBindings: ['b'.repeat(64)] };
    expect(readGatewayAccountAuthority(rotated, dimensions, now).accountScopeIds).toEqual(current.accountScopeIds);
    expect(gatewayAccountFencePath(current.provider, current.accountScopeIds)).toBe(gatewayAccountFencePath(rotated.provider, rotated.accountScopeIds));
  });
  it.each([
    { version: 1 }, { authority: 'gateway-exclusive' }, { upstreamQuota: 'known-free' }, { accountScopeIds: [] },
    { accountScopeIds: ['unrelated'] }, { accountScopeIds: ['canonical-account', 'canonical-account'] },
    { credentialBindings: [] }, { credentialBindings: ['actual-secret-must-not-be-a-binding'] }, { provider: 'groq' },
    { reviewedAtMs: now + 1 }, { expiresAtMs: now }, { expiresAtMs: now + 86_400_001 }, { expireAt: now + 1 },
  ])('rejects malformed or mismatched reviewed account authority %j', change => {
    expect(() => readGatewayAccountAuthority({ ...review(), ...change }, dimensions, now)).toThrow('Gateway account review unavailable');
  });
  it('rejects model-only dimensions even under a nonempty unrelated account review', () => {
    expect(() => readGatewayAccountAuthority(review(), dimensions.filter(d => d.scope.kind === 'model'), now)).toThrow();
  });
});
