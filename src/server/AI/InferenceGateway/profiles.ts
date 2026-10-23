import { isCount, isIdentifier } from './capabilities';
import type { EvidenceAuthority, EvidenceKind, Payer, ProviderProfile, QuotaDimension, RejectionReason, RoutingRequest } from './types';

/** No guessed production model profiles or pricing. Enrollment needs independent review. */
export const PRODUCTION_PROFILES: readonly ProviderProfile[] = Object.freeze([]);

/** Stable evidence binding, NOT a signature or authentication mechanism. No secret/prompt payloads belong here. */
export function evidenceBinding(subject: unknown): string {
  const seen = new Set<object>();
  function normalize(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Invalid evidence subject');
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(normalize);
    else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Non-data evidence subject');
      result = Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize((value as Record<string, unknown>)[key])]));
    }
    seen.delete(value);
    return result;
  }
  return JSON.stringify(normalize(subject));
}
export function withoutEvidence<T extends { readonly evidenceRef: string }>(subject: T): Omit<T, 'evidenceRef'> {
  const { evidenceRef: _reference, ...fields } = subject;
  return fields;
}
export function hasCurrentEvidence(authority: EvidenceAuthority, ref: string, kind: EvidenceKind, subject: unknown, nowMs: number): boolean {
  try {
    if (!isIdentifier(ref) || !isCount(nowMs)) return false;
    const record = authority.lookup(ref);
    return !!record && record.revoked === false && record.kind === kind && isCount(record.issuedAtMs)
      && isCount(record.expiresAtMs) && record.issuedAtMs <= nowMs && record.expiresAtMs > nowMs
      && record.binding === evidenceBinding(subject);
  } catch { return false; }
}
export function validPayer(p: Payer): boolean {
  return !!p && isIdentifier(p.ownerId) && (p.kind === 'platform' || (p.kind === 'tenant' && isIdentifier(p.tenantId)));
}
export function samePayer(a: Payer, b: Payer): boolean {
  return validPayer(a) && validPayer(b) && a.kind === b.kind && a.ownerId === b.ownerId
    && (a.kind !== 'tenant' || (b.kind === 'tenant' && a.tenantId === b.tenantId));
}
/** Credential rotation does not change this key; overlapping quotas remain shared across replicas/callers. */
export function quotaLedgerKey(d: QuotaDimension): string {
  return evidenceBinding([d.scope.providerId, d.scope.kind, d.scope.id, d.meter]);
}
export function validQuotaDimension(d: QuotaDimension, providerId: string): boolean {
  return !!d && !!d.scope && d.scope.providerId === providerId && isIdentifier(d.scope.id) && isIdentifier(d.meter)
    && ['account', 'organization', 'project', 'model'].includes(d.scope.kind);
}
export function profileRejection(p: ProviderProfile, r: RoutingRequest): RejectionReason | undefined {
  if (![p.id, p.version, p.providerId, p.modelId, p.modelRevision, p.adapterId].every(isIdentifier)) return 'malformed';
  if (p.reviewedPriority !== undefined && (!isCount(p.reviewedPriority) || p.reviewedPriority > 1000)) return 'malformed';
  if (p.status !== 'approved' || p.serviceClass !== 'production' || p.product !== 'inference-api'
    || !['verified-free-no-overage', 'metered'].includes(p.charging)) return 'profile-ineligible';
  if (!Array.isArray(p.termsApprovals) || !p.termsApprovals.includes(r.termsPolicyId)) return 'profile-ineligible';
  if (!Array.isArray(p.surfaces) || !p.surfaces.includes(r.surface)) return 'surface';
  if (!Array.isArray(p.qualityApprovals) || !p.qualityApprovals.some(q => q.tier === r.quality.tier
    && q.gateId === r.quality.gateId && q.gateVersion === r.quality.gateVersion)) return 'quality';
  if (!samePayer(p.credentialOwner, r.payer)) return 'payer';
  const privacy = p.privacy;
  if (!privacy || !Array.isArray(privacy.dataClasses) || !privacy.dataClasses.includes(r.privacy.dataClass)
    || !['none', 'permitted'].includes(privacy.training) || !['none', 'permitted'].includes(privacy.humanReview)
    || privacy.retentionHours === null || !isCount(privacy.retentionHours) || privacy.retentionHours > r.privacy.maxRetentionHours
    || !Array.isArray(privacy.processingRegions) || !privacy.processingRegions.length
    || privacy.processingRegions.some(region => !isIdentifier(region) || !r.privacy.allowedProcessingRegions.includes(region))) return 'privacy';
  // Training/review tiers (including Gemini unpaid) never receive private/health scopes,
  // even if an incorrectly permissive request was labeled allowTraining=true.
  if ((privacy.training !== 'none' && (!r.privacy.allowTraining || r.privacy.dataClass !== 'public'))
    || (privacy.humanReview !== 'none' && (!r.privacy.allowHumanReview || r.privacy.dataClass !== 'public'))) return 'privacy';
  if (!Array.isArray(p.quotaDimensions) || !p.quotaDimensions.length
    || p.quotaDimensions.some(d => !validQuotaDimension(d, p.providerId))
    || !p.quotaDimensions.some(d => d.scope.kind !== 'model')
    || new Set(p.quotaDimensions.map(quotaLedgerKey)).size !== p.quotaDimensions.length) return 'quota';
  return undefined;
}
