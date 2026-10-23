/** Process-local reporting evidence, not a dispatch permit or an invoice receipt. */
import type { AIProviderResponse } from '../Router/ProviderTypes';
import type { DispatchClaim } from './executor';
import { evidenceBinding } from './profiles';
import { readGatewayTextUsage } from './textTransport';
import { readGatewayOpenRouterUsage } from './openRouterTransport';
import { readGatewayVisionUsage } from './visionTransport';

export interface GatewayFreePricingProof { readonly kind: 'gateway-verified-free'; }
interface Expected {
  provider?: string; model?: string; logicalRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}
const issued = new WeakMap<object, { provider: string; model: string; logicalRequestId: string;
  inputTokens: number; outputTokens: number; dispatchBinding: string }>();

/** Only the transport's authentic, claim-bound final zero-cost result can mint this object. */
export function createGatewayFreePricingProof(result: AIProviderResponse, claim: DispatchClaim): GatewayFreePricingProof | undefined {
  const usage = readGatewayTextUsage(result, claim) ?? readGatewayOpenRouterUsage(result, claim) ?? readGatewayVisionUsage(result, claim);
  if (!usage || !usage.final || usage.actualNanoUsd !== 0 || usage.outcome.kind !== 'completed'
    || result.provider !== claim.binding.providerId || result.model !== claim.binding.modelId
    || result.usage?.inputTokens !== usage.inputTokens || result.usage?.outputTokens !== usage.outputTokens
    || evidenceBinding(usage.binding) !== evidenceBinding(claim.binding)) return undefined;
  const proof: GatewayFreePricingProof = Object.freeze({ kind: 'gateway-verified-free' });
  issued.set(proof, { provider: result.provider, model: result.model,
    logicalRequestId: claim.binding.key.logicalRequestId, inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens, dispatchBinding: evidenceBinding(claim.binding) });
  return proof;
}

/** Serialized/copied/forged objects and altered response identity or token counts are rejected. */
export function isGatewayFreePricingProof(proof: unknown, expected: Expected): proof is GatewayFreePricingProof {
  if (!proof || typeof proof !== 'object') return false;
  const record = issued.get(proof);
  return !!record && !!record.dispatchBinding && record.provider === expected.provider && record.model === expected.model
    && record.logicalRequestId === expected.logicalRequestId
    && record.inputTokens === expected.usage?.inputTokens && record.outputTokens === expected.usage?.outputTokens;
}
