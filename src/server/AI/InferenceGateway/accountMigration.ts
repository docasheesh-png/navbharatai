import { createHash } from 'node:crypto';
import { isIdentifier } from './capabilities';
import type { QuotaDimension } from './types';

/** Actual reviewed account scopes, never API-key hashes or invented per-model allowances. */
export function gatewayAccountScopeIds(dimensions: readonly QuotaDimension[]): string[] {
  return [...new Set(dimensions.filter(d => d.scope.kind !== 'model').map(d => d.scope.id))].sort();
}
const accountKey = (provider: string, accountScopeIds: readonly string[]) =>
  createHash('sha256').update(JSON.stringify([provider, [...new Set(accountScopeIds)].sort()])).digest('hex');
/** Account review record, NOT a provider-wide fence on preserved legacy consumers. */
export function gatewayAccountFencePath(provider: string, accountScopeIds: readonly string[]): string {
  return `free_chat_chain/gateway_account_owner_${accountKey(provider, accountScopeIds)}`;
}
export interface GatewayAccountFence {
  kind: 'gateway_account_owner'; version: 2;
  provider: string; migrationId: string; authority: 'gateway-local-capacity';
  accountScopeIds: string[];
  /** Reviewed generation associations only; two keys never imply two account quotas. */
  credentialBindings: string[];
  accountReviewRef: string;
  /** These counters bound gateway pressure, not the provider's unknown remaining allowance. */
  upstreamQuota: 'unknown';
  reviewedAtMs: number; expiresAtMs: number;
}
export interface GatewayFreeBillingSafety {
  kind: 'intrinsic-zero' | 'provider-hard-stop';
  evidenceRef: string;
  reviewedAtMs: number; expiresAtMs: number;
}
/** Shared validator used by issuer, bounded setup and reviewed local-period writer. */
export function readGatewayAccountAuthority(value: unknown, dimensions: readonly QuotaDimension[], now: number): GatewayAccountFence {
  const f = value as GatewayAccountFence | undefined; const scopes = gatewayAccountScopeIds(dimensions);
  if (!f || f.kind !== 'gateway_account_owner' || f.version !== 2 || f.authority !== 'gateway-local-capacity'
    || !isIdentifier(f.provider) || !isIdentifier(f.migrationId) || !isIdentifier(f.accountReviewRef)
    || f.upstreamQuota !== 'unknown' || !scopes.length || scopes.length > 32 || !scopes.every(isIdentifier)
    || !Array.isArray(f.accountScopeIds) || JSON.stringify([...f.accountScopeIds].sort()) !== JSON.stringify(scopes)
    || !dimensions.every(d => d.scope.providerId.toLowerCase() === f.provider)
    || !Array.isArray(f.credentialBindings) || !f.credentialBindings.length || f.credentialBindings.length > 32
    || !f.credentialBindings.every(binding => typeof binding === 'string' && /^[a-f0-9]{64}$/.test(binding))
    || !Number.isSafeInteger(f.reviewedAtMs) || !Number.isSafeInteger(f.expiresAtMs)
    || f.reviewedAtMs < 0 || f.reviewedAtMs > now || f.expiresAtMs <= now || f.expiresAtMs - f.reviewedAtMs > 86_400_000
    || 'expireAt' in f || 'expiresAt' in f) throw new Error('Gateway account review unavailable');
  return f;
}
/** Shared account cooldown never keys by rotating credentials. */
export function gatewayAccountCooldownPath(provider: string, accountScopeIds: readonly string[]): string {
  return `free_chat_chain/gateway_account_cooldown_${accountKey(provider, accountScopeIds)}`;
}
/** Health belongs to the reviewed credential generation, never a separate allowance. */
export function gatewayCredentialHealthPath(provider: string, accountScopeIds: readonly string[], credentialBinding: string): string {
  return `free_chat_chain/gateway_credential_health_${accountKey(provider, [...accountScopeIds, `credential:${credentialBinding}`])}`;
}
