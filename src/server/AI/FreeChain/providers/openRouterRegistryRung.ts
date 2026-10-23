import { strictFreeText, registryConfig } from '../../LiveRegistry/runtime';
import type { FreeTextRequest } from '../../LiveRegistry/dispatcher';
/** Reuses existing account/price/terms verification. No second client, no hedge or unbounded inner fallback. */
export async function runRegistryRung(input: FreeTextRequest, allowedModelIds: readonly string[], preferredModelId?: string) {
  if (!registryConfig().enabled || !allowedModelIds.length) throw new Error('FREE_CHAIN_REGISTRY_UNAVAILABLE');
  return strictFreeText({ ...input, allowedModelIds, preferredModelId, maxAttempts: 1 });
}
