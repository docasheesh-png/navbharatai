// Phase 2: order one AI Chat turn across the ladder that already exists.
//
// Priority stays reply, then language, then cheapest. Language is already the reply instruction on
// the turn; there is no measured language score, so this does not invent one. Cheapest stays the
// ladder's own price order: a dearer rung never moves in front of a cheaper one. Inside one price,
// a rung that has been answering faster, then the one with fewer calls in flight, goes first.
// A suspended or down rung moves to the end and the old order is still there as the fallback.
// `AGENTV3_CHAT_TRAFFIC=off` leaves the ladder untouched.

import { parseEnvFlag } from '../../lib/envFlag';
import { providerIsUnhealthy, providerPace } from './trafficHealth';

export function chatTrafficEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_CHAT_TRAFFIC) !== false;
}

export interface ChatTrafficRung {
  id: string;
  provider: string;
  /** USD per million input tokens. Null means this rung's price is not on the ladder row, so it stays put. */
  priceIn: number | null;
}

export function orderChatByHealth<T extends ChatTrafficRung>(rungs: readonly T[], now = Date.now()): T[] {
  const decorated = rungs.map((rung, index) => {
    const pace = providerPace(rung.provider);
    return { rung, index, unhealthy: providerIsUnhealthy(rung.provider, now), latency: pace.latencyMs, load: pace.load };
  });
  const healthy = decorated.filter((row) => !row.unhealthy);
  const unhealthy = decorated.filter((row) => row.unhealthy).sort((a, b) => a.index - b.index);
  const ordered: T[] = [];
  let cursor = 0;
  while (cursor < healthy.length) {
    const price = healthy[cursor].rung.priceIn;
    let end = cursor + 1;
    while (end < healthy.length && healthy[end].rung.priceIn === price && price !== null) end += 1;
    const run = healthy.slice(cursor, end).sort((a, b) => {
      const latencyA = a.latency ?? Number.POSITIVE_INFINITY;
      const latencyB = b.latency ?? Number.POSITIVE_INFINITY;
      if (latencyA !== latencyB) return latencyA - latencyB;
      if (a.load !== b.load) return a.load - b.load;
      return a.index - b.index;
    });
    ordered.push(...run.map((row) => row.rung));
    cursor = end;
  }
  ordered.push(...unhealthy.map((row) => row.rung));
  return ordered;
}
