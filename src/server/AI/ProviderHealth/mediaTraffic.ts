// Phase 5: order image generation and vision (including PDFs) by the same health rule.
// A dearer engine never moves ahead of a cheaper one. A price that is not on the token card stays
// null, so those engines keep the ladder's own cost order and are never regrouped by a guessed rate.
// A suspended or down engine waits until the healthy ones are tried. The admin drain/disable switch
// is a separate check and is not changed. `AGENTV3_MEDIA_TRAFFIC=off` restores the existing order.

import { parseEnvFlag } from '../../lib/envFlag';
import { mediaProviderName } from './mediaCatalogue';
import { orderChatByHealth } from './chatTrafficOrder';
import { professionalPriceIn } from './professionalTraffic';

/** Providers whose token card is a real rate. Anything else stays unpriced so it cannot jump a cheaper engine. */
const TOKEN_PRICED = new Set(['GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE', 'OPENAI', 'KIMI', 'DEEPSEEK', 'GROQ']);

export function mediaTrafficEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_MEDIA_TRAFFIC) !== false;
}

export function mediaPriceIn(provider: string): number | null {
  const name = provider.trim().toUpperCase();
  if (!TOKEN_PRICED.has(name)) return null;
  return professionalPriceIn(name);
}

/** Health name for one image-ladder step. Shared with the token card when it is the same account. */
export function imageEngineProvider(step: string): string {
  return mediaProviderName(step);
}

export function orderMediaProviders<T extends string>(ids: readonly T[], providerOf: (id: T) => string, now = Date.now()): T[] {
  const facts = ids.map((id) => {
    const provider = providerOf(id);
    return { id, provider, priceIn: mediaPriceIn(provider) };
  });
  return orderChatByHealth(facts, now).map((fact) => fact.id);
}
