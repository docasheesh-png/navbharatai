// Phase 4: order one build tier's ladder rungs by live health, without leaving the tier
// or moving a dearer rung ahead of a cheaper one. The owner prefix (Surplus, Router One, and the
// rest) is assembled around this list and is not reordered here.
// `AGENTV3_BUILDER_TRAFFIC=off` leaves the tier ladder untouched.

import { parseEnvFlag } from '../../lib/envFlag';
import { orderChatByHealth } from './chatTrafficOrder';
import { professionalPriceIn } from './professionalTraffic';

export function builderTrafficEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_BUILDER_TRAFFIC) !== false;
}

export function orderBuilderRungs<T extends { provider: string; model: string }>(rungs: readonly T[], now = Date.now()): T[] {
  const facts = rungs.map((rung) => ({
    item: rung,
    id: `${rung.provider}:${rung.model}`,
    provider: rung.provider,
    priceIn: professionalPriceIn(rung.provider, rung.model),
  }));
  return orderChatByHealth(facts, now).map((fact) => fact.item);
}
