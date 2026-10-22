import type { LiveModelRecord } from './types';
export interface VerifiedFreeProof {
  modelId: string; inputTokens?: number; outputTokens?: number;
  registryVersion: string; verifiedAt: number; basis: LiveModelRecord['verificationBasis'];
  estimatedInferenceUsd: '0'; reportedCost: string | null;
}
const issued = new WeakSet<object>();
/** Only server-side dispatch creates a proof. A client JSON lookalike never authorizes zero accounting. */
export function issueVerifiedFreeProof(value: VerifiedFreeProof): VerifiedFreeProof {
  if (!value.modelId || !value.registryVersion || !Number.isFinite(value.verifiedAt) || value.verifiedAt <= 0
    || value.basis === 'unverified' || value.estimatedInferenceUsd !== '0'
    || (value.reportedCost !== null && !/^(?:0+)(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(value.reportedCost))
    || [value.inputTokens, value.outputTokens].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) {
    throw new Error('Invalid verified-free pricing proof');
  }
  const proof = Object.freeze({ ...value }); issued.add(proof); return proof;
}
export function isVerifiedFreeProof(value: unknown, modelId?: string): value is VerifiedFreeProof {
  return !!value && typeof value === 'object' && issued.has(value) && (modelId === undefined || (value as VerifiedFreeProof).modelId === modelId);
}
