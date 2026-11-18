/**
 * Pro Chain V2 supplier rates for REAL-cost billing (providerRates.realRateFor consults this first,
 * and ONLY for the two v2 labels — every other provider prices exactly as before).
 *
 *   ENGINE_QX (Qubax)   the catalogue's own per-token price for the model that ran  → source 'catalog'
 *                       unknown ⇒ undefined: realRateFor then prices the model id on the existing card
 *                       (a conservative upper bound) and the build report labels it ESTIMATED.
 *   ENGINE_MF (Mitrify) MITRIFY_BUILDER_RATE_* when the owner set them              → source 'configured'
 *                       otherwise the Surplus floor rate                            → source 'estimated'
 *
 * The markup on top is the ordinary tiered/unified markup every builder provider gets.
 */
import type { TokenRate } from '../pricing';
import { PRO_CHAIN_V2_MITRIFY_LABEL, PRO_CHAIN_V2_QUBAX_LABEL } from './policy';
import { qubaxCatalogRate } from './qubaxBuilder';
import { MITRIFY_ESTIMATED_RATE, mitrifyConfiguredRate } from './mitrifyBuilder';

export type SupplierRateSource = 'catalog' | 'configured' | 'estimated';

export function proChainV2SupplierRate(
  provider: string | null | undefined,
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { rate?: TokenRate; source: SupplierRateSource } | null {
  const p = String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  if (p === PRO_CHAIN_V2_QUBAX_LABEL) {
    const r = qubaxCatalogRate(model);
    return r ? { rate: r, source: 'catalog' } : { source: 'estimated' };
  }
  if (p === PRO_CHAIN_V2_MITRIFY_LABEL) {
    const r = mitrifyConfiguredRate(env);
    return r ? { rate: r, source: 'configured' } : { rate: { ...MITRIFY_ESTIMATED_RATE }, source: 'estimated' };
  }
  return null;
}
