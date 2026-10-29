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
  try { input = usdToNanoUsd(data.max_input_per_million as string | number); output = usdToNanoUsd(data.max_output_per_million as string | number); } catch { throw new LoadDiagnosticError('unavailable', 'quote_rates', 'invalid_rates', response.status, undefined, fields); }
  let maximumNanoUsd: number;
  try { maximumNanoUsd = maximumCostNanoUsd(1048576, outputTokens, input, output); }
  catch { throw new LoadDiagnosticError('unavailable', 'quote_rates', 'invalid_rates', response.status, undefined, fields); }
  if (!maximumNanoUsd) throw new LoadDiagnosticError('unavailable', 'quote_rates', 'zero_bound', response.status, undefined, fields);
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
