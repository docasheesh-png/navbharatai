import type { LiveModelRecord, ModelControl, ModelHealth, EligibilityStatus } from './types';

/** Decimal strings only: tiny positive values must never underflow to zero. */
export function decimal(value: unknown): string | null {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.length <= 128 ? value : null;
}
export function zero(value: unknown): boolean { const v = decimal(value); return v !== null && /^0(?:\.0+)?$/.test(v); }
export function perMillion(value: unknown): string | null {
  const v = decimal(value); if (v === null) return null;
  const [whole, frac = ''] = v.split('.');
  const shifted = (whole + frac.padEnd(6, '0').slice(0, 6)).replace(/^0+(?=\d)/, '');
  const tail = frac.slice(6).replace(/0+$/, '');
  return shifted + (tail ? `.${tail}` : '');
}
export function eligibility(model: LiveModelRecord, control: ModelControl | undefined, health: ModelHealth | undefined, now: number): { status: EligibilityStatus; reason: string } {
  if (control?.disabled) return { status: 'DISABLED', reason: 'Administrator disabled this model.' };
  if (model.metadataExpiresAt <= now || model.pricingVerifiedAt > now) return { status: 'STALE', reason: 'Pricing metadata expired or has an invalid clock.' };
  if (model.eligibilityStatus !== 'VERIFIED_FREE') return { status: model.eligibilityStatus, reason: model.eligibilityReason };
  if (!control || control.endpointTag !== model.endpointTag || control.termsReviewedUntil <= now) return { status: 'UNKNOWN', reason: 'Intended-use terms review is missing or expired.' };
  if (health && health.cooldownUntil > now) return { status: health.status ?? 'UNAVAILABLE', reason: 'Provider cooldown is active.' };
  return { status: 'VERIFIED_FREE', reason: 'Fresh zero-price metadata, account catalog membership, and intended-use review.' };
}

const object = (v: unknown): Record<string, any> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;
const strings = (v: unknown): string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length <= 128) ? v : [];
export function exactModelId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.:-]+$/.test(v) && !v.includes('..');
}
export function endpointUrl(id: string): string {
  if (!exactModelId(id)) throw new Error('Invalid exact model identifier');
  const [author, slug] = id.split('/');
  return `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
}
export function parseCatalog(payload: unknown, allowEmpty = false): Record<string, any>[] {
  const p = object(payload);
  if (!p || !Array.isArray(p.data) || (!allowEmpty && p.data.length === 0) || p.data.length > 10000) throw new Error('Invalid or empty catalog');
  if (p.links?.next || (p.total_count !== undefined && p.total_count !== p.data.length)) throw new Error('Incomplete catalog');
  const seen = new Set<string>();
  for (const item of p.data) {
    if (!object(item) || !exactModelId(item.id) || seen.has(item.id)) throw new Error('Invalid or duplicate catalog model');
    seen.add(item.id);
  }
  return p.data;
}

/** Missing prices stay UNKNOWN. No name suffix, discount or health probe establishes zero cost. */
export function normalizeModel(raw: Record<string, any>, endpointsPayload: unknown, accountAvailable: boolean, now: number, ttl: number, version: string): LiveModelRecord {
  const pricingRaw = object(raw.pricing) ?? {};
  const pricing: Record<string, string> = {};
  for (const [k, v] of Object.entries(pricingRaw)) if (decimal(v) !== null) pricing[k] = v as string;
  const result: LiveModelRecord = {
    provider: 'openrouter', exactModelId: raw.id, ...(exactModelId(raw.canonical_slug) ? { canonicalResponseModel: raw.canonical_slug } : {}), displayName: typeof raw.name === 'string' ? raw.name.slice(0, 250) : raw.id,
    pricing, inputPricePerMillion: perMillion(pricingRaw.prompt), outputPricePerMillion: perMillion(pricingRaw.completion),
    supportedModalities: { input: strings(raw.architecture?.input_modalities), output: strings(raw.architecture?.output_modalities) },
    supportedCapabilities: strings(raw.supported_parameters),
    contextWindow: Number.isSafeInteger(raw.context_length) && raw.context_length > 0 ? raw.context_length : 0,
    maximumOutputTokens: Number.isSafeInteger(raw.top_provider?.max_completion_tokens) && raw.top_provider.max_completion_tokens > 0 ? raw.top_provider.max_completion_tokens : null,
    pricingVerificationSource: endpointUrl(raw.id), pricingVerificationMethod: 'official-catalog-and-endpoints',
    verificationBasis: 'unverified', pricingVerifiedAt: 0, catalogFetchedAt: now, metadataExpiresAt: now + ttl, eligibilityStatus: 'UNKNOWN', eligibilityReason: 'Incomplete zero-price verification.',
    accountAvailable, endpointTag: null, registryVersion: version,
  };
  const reject = (status: EligibilityStatus, reason: string) => Object.assign(result, { eligibilityStatus: status, eligibilityReason: reason });
  if (decimal(pricingRaw.prompt) === null || decimal(pricingRaw.completion) === null) return reject('UNKNOWN', 'Missing or malformed token prices.');
  if (!zero(pricingRaw.prompt) || !zero(pricingRaw.completion)) return reject('PAID', 'Nonzero token price.');
  if (!result.supportedModalities.input.includes('text') || !result.supportedModalities.output.includes('text') || !result.contextWindow) return reject('UNKNOWN', 'Text capabilities or context limit unverified.');
  if (pricingRaw.overrides && (!Array.isArray(pricingRaw.overrides) || pricingRaw.overrides.length)) return reject('UNKNOWN', 'Conditional catalog pricing requires a dedicated verifier.');
  if (!accountAvailable) return reject('UNKNOWN', 'Not verified in the configured account catalog.');
  const epData = object(object(endpointsPayload)?.data);
  if (!epData || epData.id !== raw.id || !Array.isArray(epData.endpoints)) return reject('UNKNOWN', 'Exact endpoint metadata missing or mismatched.');
  if (!epData.endpoints.length) return reject('UNAVAILABLE', 'No endpoint listed.');
  for (const ep of epData.endpoints) {
    if (!object(ep) || ep.model_id !== raw.id || typeof ep.tag !== 'string' || !/^[a-zA-Z0-9_./:-]{1,150}$/.test(ep.tag)) continue;
    const prices = object(ep.pricing);
    if (!prices || !zero(prices.prompt) || !zero(prices.completion)) continue;
    // Official free-variant contract covers omitted non-billed SKUs, not a suffix-only inference.
    // https://openrouter.ai/docs/guides/providers/integration#free-model-variants-with-is-free
    const freeContract = raw.id.endsWith(':free');
    if (!(zero(prices.request) || (freeContract && prices.request === undefined))) continue;
    if (prices.overrides && (!Array.isArray(prices.overrides) || prices.overrides.length)) continue;
    // Implicit caching is not excluded by omitting cache_control.
    if (ep.supports_implicit_caching !== false && !freeContract && (!zero(prices.input_cache_read) || !zero(prices.input_cache_write))) continue;
    if (['input_cache_read', 'input_cache_write'].some(k => prices[k] !== undefined && !zero(prices[k]))) continue;
    if (prices.internal_reasoning !== undefined && !zero(prices.internal_reasoning)) continue;
    // Text-only envelope excludes images/audio/web-search/server tools. Unknown new billing dimensions block.
    const excluded = new Set(['image', 'image_token', 'image_output', 'audio', 'audio_output', 'web_search', 'discount', 'overrides', 'prompt', 'completion', 'request', 'input_cache_read', 'input_cache_write', 'internal_reasoning']);
    if (Object.entries(prices).some(([key, value]) => !excluded.has(key) && !zero(value))) continue;
    if (!Number.isSafeInteger(ep.context_length) || ep.context_length <= 0) continue;
    result.contextWindow = Math.min(result.contextWindow, ep.context_length);
    result.supportedCapabilities = [...strings(ep.supported_parameters), ...(ep.supports_tool_choice?.auto === true ? ['tool_choice:auto'] : [])];
    result.maximumOutputTokens = Number.isSafeInteger(ep.max_completion_tokens) && ep.max_completion_tokens > 0 ? ep.max_completion_tokens : result.maximumOutputTokens;
    result.endpointTag = ep.tag;
    result.pricingVerifiedAt = now;
    result.verificationBasis = freeContract ? 'OPENROUTER_FREE_VARIANT_CONTRACT' : 'explicit-zero-fees';
    result.pricing = Object.fromEntries(Object.entries(prices).filter(([_, v]) => decimal(v) !== null)) as Record<string, string>;
    return reject('VERIFIED_FREE', 'Zero text-token and per-request fees verified for an exact account-visible endpoint; terms review still required.');
  }
  return reject('UNKNOWN', 'No exact endpoint proves all applicable fees zero (including request/cache fees).');
}
