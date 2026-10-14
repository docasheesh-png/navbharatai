/**
 * Go-live PR 13 — turns the analyzer's answer into the chat's `service_recommendation` event.
 * Returns null unless AGENTV3_SERVICE_RECO is on (default OFF), and null when nothing is needed,
 * so a caller can emit whatever this returns without its own gate. Not wired into the build
 * loop yet; the owner turns the flag on only after the card has been seen on staging.
 */
import { envFlag } from '../lib/envFlag';
import { rupees, skuById } from '../../lib/catalogue';
import type { ServiceRecommendationItem } from '../AgentV3/types';
import { analyzeRequirements, recommendServices, type ProjectSnapshot } from './requirements';

export function serviceRecommendationEvent(
  snap: ProjectSnapshot,
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): { type: 'service_recommendation'; recommendations: ServiceRecommendationItem[]; ts: number } | null {
  const on = env === process.env ? envFlag('AGENTV3_SERVICE_RECO') : /^(1|true|on|yes)$/i.test(String(env.AGENTV3_SERVICE_RECO ?? ''));
  if (!on) return null;
  const recs = recommendServices(analyzeRequirements(snap), env);
  if (recs.length === 0) return null;
  const recommendations = recs.map((r): ServiceRecommendationItem => {
    const sku = skuById(r.skuId)!;
    return {
      skuId: r.skuId, kind: r.kind, name: sku.name, reason: r.reason,
      priceLabel: sku.pricePaise === 0 ? 'No charge from us' : `${rupees(sku.pricePaise)}${sku.period === '30d' ? ' / 30 days' : ''}`,
    };
  });
  return { type: 'service_recommendation', recommendations, ts: now() };
}
