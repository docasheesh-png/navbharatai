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
    if (!rec(b) || typeof b.aboveInputTokens !== 'number' || !Number.isSafeInteger(b.aboveInputTokens) || b.aboveInputTokens <= previous
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

/**
 * Owner decision 2026-11-15 (BR2388): a call that ends without a complete receipt is settled by an
 * ESTIMATE from the same published tariff, instead of holding the key's spend lock forever.
 *
 * Accuracy order, best evidence first — every result is labelled "Estimated":
 *   1. the response's reported usage tokens, with its documented cache split;
 *   2. usage tokens with the provider's own cache counter (`prompt_cache_hit_tokens` / `cached_tokens`);
 *   3. usage tokens with ALL input at the full input rate (cache split not reported — conservative);
 *   4. no usage: input from the request size (TokenEstimator heuristic), output from the streamed
 *      length, all input at the full input rate (conservative);
 *   5. the provider answered with an HTTP error status: no billable response, settled at zero;
 *   6. no HTTP response at all because the connection was never set up (DNS, refused, unreachable, TLS,
 *      connect timeout, or the transport threw without a timeout/abort), or the request was never
 *      dispatched: no billable response, settled at zero. A timeout or abort AFTER dispatch keeps (4),
 *      because the supplier may already have done the work.
 * The markup applied later is the verified path's own (`modelSubtotalAttoUsd = cost × 5/2`).
 */
export type CatalogueEstimateBasis =
  | 'usage-reported' | 'usage-provider-cache-detail' | 'usage-full-input-rate'
  | 'request-heuristic' | 'no-billable-response' | 'no-response-network' | 'not-dispatched'
  | 'self-heal-request-heuristic' | 'self-heal-unrecorded';
export const CATALOGUE_ESTIMATE_LABELS: Readonly<Record<CatalogueEstimateBasis, string>> = Object.freeze({
  'usage-reported': 'Estimated from the published tariff using the reported usage tokens (the response did not yield a complete receipt).',
  'usage-provider-cache-detail': 'Estimated from the published tariff using the reported usage tokens; the cached share comes from the provider\'s own cache counter.',
  'usage-full-input-rate': 'Estimated from the published tariff using the reported usage tokens; the cached share was not reported, so all input is priced at the full input rate (conservative).',
  'request-heuristic': 'Estimated from the published tariff: no usage was reported, so input is estimated from the request size and output from the streamed length, with all input at the full input rate (conservative).',
  'no-billable-response': 'Estimated at zero: the engine returned an HTTP error, so no billable response was produced.',
  'no-response-network': 'Estimated at zero: the engine could not be reached (connection, DNS or TLS failure before any response), so no billable response was produced.',
  'not-dispatched': 'Estimated at zero: the request was stopped before it was sent to the engine, so no billable response was produced.',
  'self-heal-request-heuristic': 'Estimated from the published tariff when an earlier unresolved call was settled: input from the recorded request size at the full input rate, output unknown (counted as zero); absorbed, not charged to any user.',
  'self-heal-unrecorded': 'Estimated at zero when an earlier unresolved call was settled: no request size or usage was recorded for it; absorbed, not charged to any user.',
});
export interface CatalogueEstimate {
  kind: 'catalogue-estimated'; billingAuthorized: false; settledWalletDebit: false;
  basis: CatalogueEstimateBasis; label: string;
  costAttoUsd: string; modelSubtotalAttoUsd: string; bandAboveInputTokens: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number | null;
}
export interface CatalogueEstimateEvidence {
  /** Heuristic input tokens of the request that was dispatched (TokenEstimator). */
  requestInputTokens: number;
  /** Characters of model output actually received (content + tool-call arguments). */
  outputChars: number;
  /** Last HTTP status the transport saw for this call, when known. */
  httpStatus?: number | null;
  /** No response ever existed: `network` = connection never set up; `not-dispatched` = never sent. */
  noResponse?: 'network' | 'not-dispatched';
  /** Self-heal of a stale lock: the build is over, so the basis names that. */
  selfHeal?: boolean;
}
/** Never re-checks age: the snapshot was verified fresh at dispatch and is bound to this call. */
export function estimateCatalogueChatCost(snapshot: CatalogueSnapshot, usage: unknown,
  evidence: CatalogueEstimateEvidence): CatalogueEstimate | null {
  if (!rec(snapshot) || catalogueSnapshotIssue(snapshot, snapshot.fetchedAt, Number.MAX_SAFE_INTEGER)) return null;
  const price = (basis: CatalogueEstimateBasis, input: number, output: number, read: number | null): CatalogueEstimate | null => {
    if (!tokens(input) || !tokens(output) || !Number.isSafeInteger(input + output) || (read !== null && (!tokens(read) || read > input))) return null;
    const band = [...snapshot.bands].reverse().find(b => input > b.aboveInputTokens)!;
    const knownRead = read ?? 0;
    const costAtto = (BigInt(input - knownRead) * rate(band.inputUsdPerMillion)! + BigInt(knownRead) * rate(band.cacheReadUsdPerMillion)!
      + BigInt(output) * rate(band.outputUsdPerMillion)!) * 1000n;
    return { kind: 'catalogue-estimated', billingAuthorized: false, settledWalletDebit: false, basis, label: CATALOGUE_ESTIMATE_LABELS[basis],
      costAttoUsd: costAtto.toString(), modelSubtotalAttoUsd: (costAtto * 5n / 2n).toString(), bandAboveInputTokens: band.aboveInputTokens,
      inputTokens: input, outputTokens: output, cacheReadTokens: read };
  };
  if (rec(usage) && tokens(usage.prompt_tokens) && tokens(usage.completion_tokens)) {
    const input = usage.prompt_tokens, output = usage.completion_tokens;
    const details = rec(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
    if (details && tokens(details.cached_tokens) && details.cached_tokens <= input) return price('usage-reported', input, output, details.cached_tokens);
    const alias = tokens(usage.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : tokens(usage.cached_tokens) ? usage.cached_tokens : undefined;
    if (alias !== undefined && alias <= input) return price('usage-provider-cache-detail', input, output, alias);
    return price('usage-full-input-rate', input, output, null);
  }
  const status = evidence.httpStatus;
  if (!evidence.selfHeal && (status === undefined || status === null) && !(evidence.outputChars > 0)) {
    if (evidence.noResponse === 'not-dispatched') return price('not-dispatched', 0, 0, null);
    if (evidence.noResponse === 'network') return price('no-response-network', 0, 0, null);
  }
  if (typeof status === 'number' && Number.isSafeInteger(status) && (status < 200 || status >= 300)) return price('no-billable-response', 0, 0, null);
  const input = Number.isSafeInteger(evidence.requestInputTokens) && evidence.requestInputTokens > 0 ? evidence.requestInputTokens : 0;
  const output = Number.isSafeInteger(evidence.outputChars) && evidence.outputChars > 0 ? Math.ceil(evidence.outputChars / 4) : 0;
  if (evidence.selfHeal) return input > 0 ? price('self-heal-request-heuristic', input, output, null) : price('self-heal-unrecorded', 0, 0, null);
  return price('request-heuristic', input, output, null);
}
