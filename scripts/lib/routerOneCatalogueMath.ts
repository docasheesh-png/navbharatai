/** Offline arithmetic for the owner-authorized catalogue pricing policy.
 * These are INTERNAL normalized fields, not an asserted Router One API schema.
 * No output authorizes billing: the production adapter still needs a verified wire
 * contract, durable snapshot/attempt binding and final usage capture.
 */
export interface CatalogueRateBand {
  /** Strictly greater input selects this band; first band begins at -1. */
  aboveInputTokens: number;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cacheReadUsdPerMillion: string;
  cacheWriteUsdPerMillion: string;
}
export interface CatalogueSnapshot {
  kind: 'posted-wallet-token-tariff';
  provider: 'ENGINE_R1';
  model: string;
  currency: 'USD';
  unit: 'USD/1000000-tokens';
  source: string;
  fetchedAt: number;
  bands: readonly CatalogueRateBand[];
}
export type CatalogueMathResult =
  | { kind: 'catalogue-calculated'; billingAuthorized: false; settledWalletDebit: false;
      costAttoUsd: string; modelSubtotalAttoUsd: string; bandAboveInputTokens: number;
      inputTokens: number; outputTokens: number; cacheReadTokens: number | null;
      cacheWriteTokens: null; snapshot: Readonly<CatalogueSnapshot> }
  | { kind: 'pending'; billingAuthorized: false; reason: string };
const pending = (reason: string): CatalogueMathResult => ({ kind: 'pending', billingAuthorized: false, reason });
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const tokens = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** Exact nanodollars per million; no magnitude-based unit inference or rounding. */
function rate(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,9})?$/.test(v)) return null;
  const [whole, fraction = ''] = v.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
}
export function catalogueSnapshotIssue(snapshot: CatalogueSnapshot, now: number, maxAgeMs: number): string | null {
  if (!rec(snapshot) || snapshot.kind !== 'posted-wallet-token-tariff' || snapshot.provider !== 'ENGINE_R1'
    || snapshot.currency !== 'USD' || snapshot.unit !== 'USD/1000000-tokens') return 'unsupported-tariff-or-unit';
  if (typeof snapshot.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(snapshot.model) || snapshot.model === 'auto') return 'unbound-model';
  let url: URL;
  try { url = new URL(snapshot.source); } catch { return 'unverified-source'; }
  if (!['https://router.one', 'https://api.router.one'].includes(url.origin)
    || url.username || url.password || url.search || url.hash
    || !(url.pathname.startsWith('/models/') || url.pathname === '/v1/models')) return 'unverified-source';
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0
    || !Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt <= 0
    || snapshot.fetchedAt > now || now - snapshot.fetchedAt > maxAgeMs) return 'stale-or-invalid-snapshot';
  if (!Array.isArray(snapshot.bands) || !snapshot.bands.length || snapshot.bands.length > 16) return 'invalid-rate-bands';
  let previous = -2;
  for (let i = 0; i < snapshot.bands.length; i++) {
    const b = snapshot.bands[i];
    if (!rec(b) || !Number.isSafeInteger(b.aboveInputTokens) || b.aboveInputTokens <= previous
      || (i === 0 && b.aboveInputTokens !== -1) || (i > 0 && b.aboveInputTokens < 0)) return 'invalid-rate-bands';
    const prices = [b.inputUsdPerMillion, b.outputUsdPerMillion, b.cacheReadUsdPerMillion, b.cacheWriteUsdPerMillion].map(rate);
    if (prices.some(p => p === null)) return 'invalid-price';
    // Chat Completions documents nested reads, not a separate write counter. A
    // distinct write price cannot safely be applied using absent write counts.
    if (prices[0] !== prices[3]) return 'unsupported-chat-cache-write-tariff';
    previous = b.aboveInputTokens;
  }
  return null;
}
/** Uses the raw documented Chat Completions shape, never the adapter's defaulted zero counters.
 * A final/cancelled stream without complete usage is pending; token estimates cannot fill it.
 */
export function calculateCatalogueChatCost(snapshot: CatalogueSnapshot, responseModel: string,
  usage: unknown, completed: boolean, now: number, maxAgeMs: number): CatalogueMathResult {
  const issue = catalogueSnapshotIssue(snapshot, now, maxAgeMs);
  if (issue) return pending(issue);
  if (responseModel !== snapshot.model) return pending('model-mismatch');
  if (!completed || !rec(usage) || !tokens(usage.prompt_tokens) || !tokens(usage.completion_tokens)) return pending('incomplete-usage');
  const input = usage.prompt_tokens, output = usage.completion_tokens;
  if (!Number.isSafeInteger(input + output)) return pending('invalid-token-total');
  if (usage.total_tokens !== undefined && usage.total_tokens !== input + output) return pending('conflicting-token-total');
  const band = [...snapshot.bands].reverse().find(b => input > b.aboveInputTokens)!;
  const ordinaryRate = rate(band.inputUsdPerMillion)!;
  const readRate = rate(band.cacheReadUsdPerMillion)!;
  const details = usage.prompt_tokens_details;
  if (details !== undefined && !rec(details)) return pending('invalid-cache-details');
  const read = rec(details) ? details.cached_tokens : undefined;
  if (read !== undefined && (!tokens(read) || read > input)) return pending('invalid-cache-read');
  if (usage.cached_tokens !== undefined && usage.cached_tokens !== read) return pending('ambiguous-cache-alias');
  if (rec(details) && details.cache_write_tokens !== undefined) return pending('unsupported-chat-cache-write-field');
  if (read === undefined && ordinaryRate !== readRate) return pending('missing-cache-read');
  // When rates coincide the unknown split cannot affect cost; retain null, not invented zero.
  const knownRead = typeof read === 'number' ? read : 0;
  const costAtto = (BigInt(input - knownRead) * ordinaryRate + BigInt(knownRead) * readRate
    + BigInt(output) * rate(band.outputUsdPerMillion)!) * 1000n;
  const copy = Object.freeze({ ...snapshot, bands: Object.freeze(snapshot.bands.map(b => Object.freeze({ ...b }))) });
  return { kind: 'catalogue-calculated', billingAuthorized: false, settledWalletDebit: false,
    costAttoUsd: costAtto.toString(), modelSubtotalAttoUsd: (costAtto * 5n / 2n).toString(),
    bandAboveInputTokens: band.aboveInputTokens, inputTokens: input, outputTokens: output,
    cacheReadTokens: typeof read === 'number' ? read : null, cacheWriteTokens: null, snapshot: copy };
}
