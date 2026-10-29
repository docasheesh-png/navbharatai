import { LoadDiagnosticError, quoteFields, supplierCodes } from './providerLoadDiagnostics';
import { cheaperInferenceAdminStatus, CHEAPERINFERENCE_BASE_URL } from './cheaperInferencePolicy';
import { maximumCostNanoUsd, usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { LoadBatchError } from './providerLoadBatch';

export interface LoadQuote { model: string; maximumNanoUsd: number; checkedAt: number; source: string }
/** Official protocol: /docs#price-ceiling, model.supply max_*_per_million.
 * No raw bodies/headers escape. This is batch admission only, never a manual-bot gate.
 * Beam's published 1M input context is rounded upward to 1,048,576. Output uses
 * the exact submitted native limit, including reasoning under the documented model
 * contract (developers.reflection.ai/reasoning). Marketplace parameter enforcement
 * remains a provider obligation, not a guaranteed monetary account cap. */
export async function readLoadQuote(outputTokens: number, env = process.env, transport: typeof fetch = fetch): Promise<LoadQuote> {
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 131072) throw new LoadBatchError('invalid');
  const status = cheaperInferenceAdminStatus(env);
  if (!status.apiKeyConfigured) throw new LoadDiagnosticError('unavailable', 'quote_configuration', 'key_missing');
  if (!['beam', 'beam-1.0-501b-a23b'].includes(status.defaultModel)) throw new LoadDiagnosticError('unavailable', 'quote_configuration', 'model_unsupported');
  let response: Response;
  try { response = await transport(`${CHEAPERINFERENCE_BASE_URL}/models/supply?model=${encodeURIComponent(status.defaultModel)}&min_discount_percent=0`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${env.CHEAPERINFERENCE_API_KEY!.trim()}`, Accept: 'application/json' },
  }); } catch (error) { throw new LoadDiagnosticError('unavailable', 'quote_transport', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error'); }
  if (!response.ok) {
    let supplierCode: string | undefined;
    try { const body = await response.json(); if (supplierCodes.includes(body?.error?.code)) supplierCode = body.error.code; } catch { /* Raw body is never exposed. */ }
    throw new LoadDiagnosticError('unavailable', 'quote_http', 'http_rejected', response.status, supplierCode);
  }
  let raw: unknown;
  try { raw = await response.json(); } catch (error) {
    if (error instanceof SyntaxError) throw new LoadDiagnosticError('unavailable', 'quote_schema', 'invalid_json', response.status);
    throw new LoadDiagnosticError('unavailable', 'quote_transport', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error', response.status);
  }
  const data = unwrapSupply(raw);
  const fields = Object.fromEntries(quoteFields.map(key => { const value = data?.[key]; return [key, value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]; }));
  const discount = data?.min_discount_percent === undefined || data?.min_discount_percent === null ? 0 : Number(data.min_discount_percent);
  const objectOk = data?.object === undefined || data?.object === null || data.object === 'model.supply';
  const modelOk = data?.model === undefined || data?.model === null || sameBeamModel(String(data.model), status.defaultModel);
  if (!data || !objectOk || !modelOk || discount !== 0) throw new LoadDiagnosticError('unavailable', 'quote_schema', 'schema_mismatch', response.status, undefined, fields);
  let input: number, output: number;
  const keys = supplyKeys(data);
  // DNA fix (live 2026-10-29, prod 05000): supply 200 carries max_* null + list_* / primary_market_offers / candidates.
  // Order: list_* (== ceiling at min_discount 0) -> offers/candidates (highest) -> /v1/models catalog. Values may be
  // string numbers, "$"-prefixed, exponent or >9-decimal floats; normalizeUsd rounds UP to nano so the ceiling never shrinks.
  const resolved = resolveRatesWithPath(data);
  let rates = resolved.rates;
  let path: string = resolved.path;
  if (!num(rates.input) || !num(rates.output)) {
    const catalog = await readCatalogRates(status.defaultModel, env.CHEAPERINFERENCE_API_KEY!.trim(), transport);
    if (catalog) { rates = { input: num(rates.input) ? rates.input : catalog.input, output: num(rates.output) ? rates.output : catalog.output }; path = path === 'none' ? 'catalog' : `${path}_catalog`; }
    else path = `${path}_catalog_miss`;
  }
  const diagKeys = [`rate_path.${path}`, ...keys];
  try { input = usdToNanoUsd(normalizeUsd(rates.input)); output = usdToNanoUsd(normalizeUsd(rates.output)); } catch { throw new LoadDiagnosticError('unavailable', 'quote_rates', 'invalid_rates', response.status, undefined, fields, diagKeys); }
  let maximumNanoUsd: number;
  try { maximumNanoUsd = maximumCostNanoUsd(1048576, outputTokens, input, output); }
  catch { throw new LoadDiagnosticError('unavailable', 'quote_rates', 'invalid_rates', response.status, undefined, fields, diagKeys); }
  if (!maximumNanoUsd) throw new LoadDiagnosticError('unavailable', 'quote_rates', 'zero_bound', response.status, undefined, fields, diagKeys);
  return { model: status.defaultModel, maximumNanoUsd, checkedAt: Date.now(), source: 'https://api.cheaperinference.com/docs#price-ceiling' };
}

const BEAM_ALIASES = new Set(['beam', 'beam-1.0-501b-a23b']);
function sameBeamModel(got: string, want: string): boolean {
  const g = got.trim().toLowerCase().replace(/^[a-z0-9_-]+\//, '');
  return g === want || (BEAM_ALIASES.has(g) && BEAM_ALIASES.has(want));
}
/** Supplier 200 bodies may arrive enveloped ({data:{...}}, {supply:{...}}, [{...}]). Accept the first object carrying rate fields. */
function unwrapSupply(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || depth > 2) return null;
  if (Array.isArray(raw)) { for (const item of raw) { const hit = unwrapSupply(item, depth + 1); if (hit) return hit; } return null; }
  const obj = raw as Record<string, unknown>;
  if (obj.max_input_per_million != null || obj.max_output_per_million != null || obj.object === 'model.supply') return obj;
  for (const key of ['data', 'supply', 'result', 'model_supply']) { const hit = unwrapSupply(obj[key], depth + 1); if (hit) return hit; }
  return obj;
}

const clean = (v: unknown) => typeof v === 'string' ? v.trim().replace(/^\$/, '').replace(/,/g, '') : v;
const num = (v: unknown) => { const c = clean(v); return c !== null && c !== undefined && c !== '' && typeof c !== 'boolean' && Number.isFinite(Number(c)) && Number(c) > 0; };
/** Decimal USD string with <=9 fractional digits, rounded UP (ceiling-safe). Throws on non-positive / non-numeric. */
export function normalizeUsd(v: unknown): string {
  if (!num(v)) throw new Error('Invalid USD amount');
  const c = clean(v); const text = typeof c === 'string' && /^\d+(\.\d+)?$/.test(c) ? c : Number(c).toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  const [whole, frac = ''] = text.split('.');
  if (frac.length <= 9) return frac ? `${whole}.${frac}` : whole;
  let nano = BigInt(whole) * 1_000_000_000n + BigInt(frac.slice(0, 9));
  if (/[1-9]/.test(frac.slice(9))) nano += 1n;
  return `${nano / 1_000_000_000n}.${(nano % 1_000_000_000n).toString().padStart(9, '0')}`;
}
const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const pick = (o: Record<string, unknown> | null, names: string[]) => { if (o) for (const n of names) if (num(o[n])) return o[n]; return undefined; };
const IN = ['max_input_per_million', 'max_input_usd_per_million', 'input_per_million', 'list_input_per_million', 'input_price_per_million', 'input', 'prompt'];
const OUT = ['max_output_per_million', 'max_output_usd_per_million', 'output_per_million', 'list_output_per_million', 'output_price_per_million', 'output', 'completion'];
/** Price ceiling per million tokens. Prefers max_*; at min_discount_percent=0 the list price is the same ceiling, so list_* and
 * nested pricing/rates/price_ceiling/max objects are accepted; finally the highest primary-market offer rate (still an upper bound). */
export function resolveRates(data: Record<string, unknown>): { input: unknown; output: unknown } {
  const scopes = [data, ...['price_ceiling', 'ceiling', 'max', 'rates', 'pricing', 'price', 'list', 'list_price'].map(k => rec(data[k]))];
  let input: unknown, output: unknown;
  // A present-but-malformed ceiling is corrupt evidence: never paper over it with a fallback.
  if (data.max_input_per_million != null && !num(data.max_input_per_million)) input = data.max_input_per_million;
  if (data.max_output_per_million != null && !num(data.max_output_per_million)) output = data.max_output_per_million;
  for (const s of scopes) { input ??= pick(s, IN); output ??= pick(s, OUT); }
  const offers = ['primary_market_offers', 'offers', 'candidates'].flatMap(k => Array.isArray(data[k]) ? data[k] as unknown[] : []);
  if (input === undefined || output === undefined) {
    let mi = 0, mo = 0;
    for (const o of offers) { const r = rec(o); const i = Number(pick(r, IN) ?? pick(rec(r?.pricing), IN) ?? 0), x = Number(pick(r, OUT) ?? pick(rec(r?.pricing), OUT) ?? 0); if (i > mi) mi = i; if (x > mo) mo = x; }
    if (input === undefined && mi > 0) input = mi; if (output === undefined && mo > 0) output = mo;
  }
  return { input, output };
}
export type RatePath = 'max' | 'list' | 'nested' | 'offers' | 'none';
/** Same as resolveRates but reports which evidence produced the ceiling (for admin diagnostics). */
export function resolveRatesWithPath(data: Record<string, unknown>): { rates: { input: unknown; output: unknown }; path: RatePath } {
  const rates = resolveRates(data);
  if (!num(rates.input) || !num(rates.output)) return { rates, path: 'none' };
  const has = (names: string[]) => names.some(n => num(data[n]) && clean(data[n]) === clean(rates.input) || num(data[n]) && clean(data[n]) === clean(rates.output));
  const path: RatePath = has(['max_input_per_million', 'max_output_per_million']) ? 'max'
    : has(['list_input_per_million', 'list_output_per_million']) ? 'list'
    : IN.concat(OUT).some(n => num(data[n])) ? 'list' : ['primary_market_offers', 'offers', 'candidates'].some(k => Array.isArray(data[k]) && (data[k] as unknown[]).length) ? 'offers' : 'nested';
  return { rates, path };
}
/** Key names only (never values), one level of nesting, for honest diagnostics. */
function supplyKeys(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) { out.push(k); const r = rec(v); if (r) for (const c of Object.keys(r)) out.push(`${k}.${c}`); }
  return out.filter(k => /^[A-Za-z0-9_.]{1,64}$/.test(k)).slice(0, 40);
}

/** Catalog fallback: GET /v1/models returns each model with current pricing (input_per_million/output_per_million,
 * possibly under pricing.*; tiered models expose pricing.above_threshold — take the higher tier as the ceiling). */
export async function readCatalogRates(model: string, key: string, transport: typeof fetch = fetch): Promise<{ input: unknown; output: unknown } | null> {
  try {
    const r = await transport(`${CHEAPERINFERENCE_BASE_URL}/models`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!r.ok) return null;
    const body = await r.json() as unknown;
    const list = Array.isArray(body) ? body : Array.isArray(rec(body)?.data) ? rec(body)!.data as unknown[] : Array.isArray(rec(body)?.models) ? rec(body)!.models as unknown[] : [];
    const hit = list.map(rec).find(m => m && sameBeamModel(String(m.id ?? m.model ?? ''), model));
    if (!hit) return null;
    const base = resolveRates(hit), above = rec(rec(hit.pricing)?.above_threshold);
    const tier = above ? resolveRates(above) : { input: undefined, output: undefined };
    const max = (a: unknown, b: unknown) => num(a) && num(b) ? (Number(a) >= Number(b) ? a : b) : num(a) ? a : b;
    const out = { input: max(base.input, tier.input), output: max(base.output, tier.output) };
    return num(out.input) && num(out.output) ? out : null;
  } catch { return null; }
}
