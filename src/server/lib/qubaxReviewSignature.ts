import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { TestChatApprovalImport } from '../../lib/testChatBot';

type Env = Record<string, string | undefined>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
const ref = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 2048 && !v.includes('\0');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const QUBAX_REVIEW_SIGNATURE_DOMAIN = 'navbharatai:qubax-exact-payload-review:v1\0';
export function canonicalQubaxReview(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalQubaxReview).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalQubaxReview(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export interface QubaxSignedReview {
  kind: 'qubax-admin-review-v1'; approvalId: string; payloadDigest: string; requestId: string;
  model: string; modelRevision: string; evidenceBinding: string; maximumNanoUsd: number;
  reviewedAtMs: number; expiresAtMs: number;
  dataReview: { entirePayloadReviewed: true; gatewayAndAllDownstreamProcessorsReviewed: true;
    approvedDataClasses: ('public' | 'private' | 'health')[]; reviewRef: string; disclosureAuthorityRef: string; processorTermsRef: string; protectionsRef: string };
}
export type QubaxReviewEnvelope = TestChatApprovalImport['attestation'];
/** Public keys only, controlled independently of the admin import endpoint. No private keys are accepted or generated. */
export type QubaxReviewPurpose = 'qubax-exact-payload-v1' | 'qubax-catalog-review-v1';
export function qubaxReviewerKeys(actor: string, env: Env = process.env, purpose: QubaxReviewPurpose = 'qubax-exact-payload-v1'): Map<string, { key: KeyObject; reviewerId: string }> {
  const found = new Map<string, { key: KeyObject; reviewerId: string }>();
  try {
    const raw = env.QUBAX_REVIEWER_KEYS_JSON;
    if (!raw || raw.length > 32_000) return found;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 20) return found;
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (!object(entry) || !keys(entry, ['keyId', 'reviewerId', 'publicKeyPem', 'purpose', 'enabled'])
        || typeof entry.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.keyId) || seen.has(entry.keyId)
        || !ref(entry.reviewerId) || typeof entry.publicKeyPem !== 'string' || entry.publicKeyPem.length > 4096
        || !entry.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') || !['qubax-exact-payload-v1', 'qubax-catalog-review-v1'].includes(entry.purpose as string)
        || typeof entry.enabled !== 'boolean') return new Map();
      seen.add(entry.keyId);
      const key = createPublicKey(entry.publicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519') return new Map();
      // A second shared-admin session is not independent review.
      if (entry.enabled && entry.purpose === purpose && entry.reviewerId.trim().toLowerCase() !== actor.trim().toLowerCase()) {
        found.set(entry.keyId, { key, reviewerId: entry.reviewerId });
      }
    }
  } catch { return new Map(); }
  return found;
}
export function verifyQubaxReview(envelope: unknown, actor: string, now: number, env: Env = process.env): QubaxSignedReview | null {
  try {
    if (!object(envelope) || !keys(envelope, ['keyId', 'payload', 'signature'])
      || typeof envelope.keyId !== 'string' || typeof envelope.payload !== 'string' || envelope.payload.length > 16_000
      || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return null;
    const trusted = qubaxReviewerKeys(actor, env).get(envelope.keyId);
    if (!trusted) return null;
    const value: unknown = JSON.parse(envelope.payload);
    // Canonical equality rejects duplicate JSON members, unknown encodings and signature ambiguity.
    if (!object(value) || !keys(value, ['kind', 'approvalId', 'payloadDigest', 'requestId', 'model', 'modelRevision', 'evidenceBinding', 'maximumNanoUsd', 'reviewedAtMs', 'expiresAtMs', 'dataReview'])
      || canonicalQubaxReview(value) !== envelope.payload || value.kind !== 'qubax-admin-review-v1'
      || ![value.approvalId, value.payloadDigest, value.evidenceBinding].every(digest)
      || typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestId)
      || !ref(value.model) || value.model.length > 256 || !ref(value.modelRevision)
      || !integer(value.maximumNanoUsd) || value.maximumNanoUsd <= 0
      || !integer(value.reviewedAtMs) || value.reviewedAtMs > now || !integer(value.expiresAtMs)
      || value.expiresAtMs <= now || value.expiresAtMs > value.reviewedAtMs + 300_000) return null;
    const r = value.dataReview;
    if (!object(r) || !keys(r, ['entirePayloadReviewed', 'gatewayAndAllDownstreamProcessorsReviewed', 'approvedDataClasses', 'reviewRef', 'disclosureAuthorityRef', 'processorTermsRef', 'protectionsRef'])
      || r.entirePayloadReviewed !== true || r.gatewayAndAllDownstreamProcessorsReviewed !== true
      || !Array.isArray(r.approvedDataClasses) || !r.approvedDataClasses.length || r.approvedDataClasses.length > 3
      || new Set(r.approvedDataClasses).size !== r.approvedDataClasses.length
      || !r.approvedDataClasses.every(v => ['public', 'private', 'health'].includes(v as string))
      || ![r.reviewRef, r.disclosureAuthorityRef, r.processorTermsRef, r.protectionsRef].every(ref)) return null;
    if (!verify(null, Buffer.from(QUBAX_REVIEW_SIGNATURE_DOMAIN + envelope.payload, 'utf8'), trusted.key, Buffer.from(envelope.signature, 'base64url'))) return null;
    return value as unknown as QubaxSignedReview;
  } catch { return null; }
}

export const QUBAX_CATALOG_SIGNATURE_DOMAIN = 'navbharatai:qubax-catalog-review:v1\0';
/** Called on every selection, including cached reads, so removing a trust root revokes imported evidence immediately. */
export function verifyQubaxCatalogPublication(value: unknown, now: number): boolean {
  try {
    if (!object(value) || !object(value.publication)) return false;
    const publication = value.publication;
    if (!keys(publication, ['actor', 'attestation']) || typeof publication.actor !== 'string' || !object(publication.attestation)) return false;
    const envelope = publication.attestation;
    if (!keys(envelope, ['keyId', 'payload', 'signature']) || typeof envelope.keyId !== 'string'
      || typeof envelope.payload !== 'string' || envelope.payload.length > 128_000
      || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return false;
    const signed: unknown = JSON.parse(envelope.payload);
    if (!object(signed) || !keys(signed, ['catalog', 'expiresAtMs', 'kind', 'previousCatalogDigest', 'reviewedAtMs'])
      || signed.kind !== 'qubax-admin-catalog-review-v1' || canonicalQubaxReview(signed) !== envelope.payload
      || !integer(signed.reviewedAtMs) || signed.reviewedAtMs > now || !integer(signed.expiresAtMs)
      || signed.expiresAtMs <= now || signed.expiresAtMs > signed.reviewedAtMs + 300_000) return false;
    const { publication: _publication, ...catalog } = value;
    if (canonicalQubaxReview(catalog) !== canonicalQubaxReview(signed.catalog)) return false;
    const trusted = qubaxReviewerKeys(publication.actor, process.env, 'qubax-catalog-review-v1').get(envelope.keyId);
    return !!trusted && verify(null, Buffer.from(QUBAX_CATALOG_SIGNATURE_DOMAIN + envelope.payload), trusted.key, Buffer.from(envelope.signature, 'base64url'));
  } catch { return false; }
}

export function qubaxCatalogPublicationExpiry(value: unknown, now: number): number | undefined {
  if (!verifyQubaxCatalogPublication(value, now)) return undefined;
  return JSON.parse(((value as Record<string, any>).publication.attestation.payload as string)).expiresAtMs as number;
}
