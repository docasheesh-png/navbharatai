// Phase 3: order one Professional AI turn across the ladder that is already registered.
//
// Last-resort rungs stay last. Among the others, a dearer rung never moves ahead of a cheaper one,
// and a suspended or down rung waits until the healthy ones have been tried. The same prompt,
// including the conversation so far, is what every rung already receives.
// `AGENTV3_PROFESSIONAL_TRAFFIC=off` leaves the registered order untouched.

import { realRateFor } from '../../AgentV3/providerRates';
import { parseEnvFlag } from '../../lib/envFlag';
import { orderChatByHealth, type ChatTrafficRung } from './chatTrafficOrder';

export function professionalTrafficEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_PROFESSIONAL_TRAFFIC) !== false;
}

/** The rate card's input price, or null when this rung is not on that card. Null never jumps a priced rung. */
export function professionalPriceIn(provider: string, model?: string): number | null {
  try {
    const rate = realRateFor(provider, model);
    return Number.isFinite(rate.inputPerMTok) ? rate.inputPerMTok : null;
  } catch {
    return null;
  }
}

export interface ProfessionalTrafficRung extends ChatTrafficRung {
  lastResort?: boolean;
}

export function orderProfessionalProviders<T extends ProfessionalTrafficRung>(rows: readonly T[], now = Date.now()): T[] {
  const primary = rows.filter((row) => !row.lastResort);
  const last = rows.filter((row) => row.lastResort);
  return [...orderChatByHealth(primary, now), ...last];
}
