/**
 * 🏪 A SELLER THE MARKET CANNOT FILL IS SKIPPED, NOT THE WHOLE ENGINE (admin 2026-11-25: "surplus app builder me kam
 * nahi kar raha, vaise woh reply de raha hai").
 *
 * Measured live on 2026-11-25 against /min90 with the builder's own request shape (pin + si_route + tools, up to 211k
 * prompt tokens): the request shape is NOT the cause. The cause is the PAIR the builder pins:
 *   • glm-5.3 / deepseek-v4.1-flash pinned to `dashscope-cn` → 404 `no_sellers_for_model`, every request, any size —
 *     although the public market lists those offers at 95–99% discount with 500k trades a day;
 *   • glm-5.3 pinned to `zai` → 404 `minimum_discount_not_met` (the router's real estimate: 80%, the market said 99.5%);
 *   • qwen3-coder / `bedrock` and glm-5.3-flash / `mistral` → 200.
 * So the market's `discount_pct` does not say whether the router will fill a pair for this account. The builder chose
 * the dead pairs first (best quality), benched the whole MODEL on one 404 — even qwen3-coder, which had just served 12
 * turns (BR2525) — and the session died, so every build "had Surplus" and still fell to the Weak ladder.
 *
 * The router's two documented pre-routing refusals are free (no seller was called). They are now remembered per
 * (model, provider) for every build in this process: a pair that never served stays out for 20 min; a pair that HAS
 * served recently stays out only 2 min (a seller's momentary capacity, not a dead route). The selector skips them and
 * picks the next pair, so a dead pair costs one 0.3 s refusal per 20 minutes instead of a build.
 */
export const SURPLUS_MARKET_REFUSAL_CODES: ReadonlySet<string> = new Set(['no_sellers_for_model', 'minimum_discount_not_met']);
export const SURPLUS_PAIR_UNSERVED_REFUSAL_MS = 20 * 60_000;
export const SURPLUS_PAIR_SERVED_REFUSAL_MS = 2 * 60_000;
const SERVED_RECENTLY_MS = 30 * 60_000;
const MAX_PAIRS = 512;

const refusedUntil = new Map<string, number>();
const servedAt = new Map<string, number>();
const key = (model: string, providerId: string) => `${model}\0${providerId}`;
function bound(map: Map<string, number>): void {
  while (map.size > MAX_PAIRS) { const first = map.keys().next().value; if (first === undefined) break; map.delete(first); }
}

/** Is this a market refusal (the router found no qualifying seller), as opposed to any other 404/4xx? */
export function isSurplusMarketRefusal(engineCode: string | undefined): boolean {
  return typeof engineCode === 'string' && SURPLUS_MARKET_REFUSAL_CODES.has(engineCode);
}

/** Remember that the router could not fill this pair. Returns until when it is skipped. Never throws. */
export function recordSurplusPairRefusal(model: string, providerId: string, now: number = Date.now()): number {
  const k = key(model, providerId);
  const served = servedAt.get(k);
  const until = now + (served !== undefined && now - served <= SERVED_RECENTLY_MS ? SURPLUS_PAIR_SERVED_REFUSAL_MS : SURPLUS_PAIR_UNSERVED_REFUSAL_MS);
  refusedUntil.delete(k); refusedUntil.set(k, until); bound(refusedUntil);
  return until;
}

/** The router served this pair: it is good again at once. */
export function recordSurplusPairServed(model: string, providerId: string, now: number = Date.now()): void {
  const k = key(model, providerId);
  refusedUntil.delete(k);
  servedAt.delete(k); servedAt.set(k, now); bound(servedAt);
}

export function surplusPairRefused(model: string, providerId: string, now: number = Date.now()): boolean {
  const until = refusedUntil.get(key(model, providerId));
  return until !== undefined && now < until;
}

export function resetSurplusPairRefusalsForTests(): void { refusedUntil.clear(); servedAt.clear(); }
