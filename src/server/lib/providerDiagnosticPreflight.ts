import type { DiagnosticProvider } from '../../shared/providerDiagnostics';

const MAX_BYTES = 2_000_000;
const SURPLUS_MODELS = 'https://api.surplusintelligence.ai/v1/models';
const CHEAPER_MODEL = 'https://api.cheaperinference.com/public/models/';
export interface DiagnosticPriceObservation {
  status: 'observed' | 'unavailable'; model: string; observedAt: number;
  /** Metadata rates are estimates, never receipts or a guaranteed request ceiling. */
  estimatedInputUsdPerMillion: string | null; estimatedOutputUsdPerMillion: string | null;
  source: string; contextTokens?: number; maxCompletionTokens?: number; textOutput?: boolean;
  chatCompletions?: boolean;
  limitsSource?: 'catalog' | 'catalog_and_model_documentation';
  reason?: 'metadata_access_denied' | 'rate_limited' | 'network_error' | 'timeout' | 'config_missing'
    | 'malformed_json' | 'catalog_too_large' | 'catalog_shape_unexpected' | 'catalog_limits_invalid'
    | 'model_not_listed' | 'provider_error';
  httpStatus?: number;
  schemaEvidence?: { bytesReceived: number; rootType?: string; dataType?: string; idType?: string; modelMatches?: number; contextType?: string; outputType?: string; modalityType?: string };
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const fieldType = (value: unknown) => value === undefined ? 'absent' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const decimal = (v: unknown): string | null => typeof v === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,12})?$/.test(v) ? v : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9 ? String(v) : null;
/** Exact model documentation, not a default for arbitrary catalog entries.
 * DeepSeek Flash: https://api-docs.deepseek.com/api/create-chat-completion/ (max_tokens 1..393216)
 * https://www.surplusintelligence.ai/markets/deepseek-v4.1-flash (1M context, text)
 * https://www.cheaperinference.com/models/beam (1048576 context, 131072 output, chat)
 * Checked 2026-10-28. Apply ONLY after that exact ID was found in live metadata;
 * explicit values, including incompatible ones, always take precedence.
 */
function documentedLimits(provider: DiagnosticProvider, model: string) {
  if (provider === 'surplus' && ['deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017'].includes(model)) return { context: 1048576, output: 393216 };
  if (provider === 'cheaperinference' && model === 'beam') return { context: 1048576, output: 131072 };
  return null;
}
/** Fixed official metadata endpoints; no redirects, retries, credentials or inference.
 * CheaperInference PublicModel is a SINGLE object, unlike authenticated ModelList.data.
 * Contract: https://www.cheaperinference.com/api/openapi.json#/components/schemas/PublicModel
 */
export async function readDiagnosticCatalog(provider: DiagnosticProvider, model: string, _env = process.env, fetcher = fetch): Promise<DiagnosticPriceObservation> {
  const source = provider === 'surplus' ? SURPLUS_MODELS : `${CHEAPER_MODEL}${encodeURIComponent(model)}`;
  const result: DiagnosticPriceObservation = { status: 'unavailable', model, observedAt: Date.now(), estimatedInputUsdPerMillion: null, estimatedOutputUsdPerMillion: null, source };
  result.schemaEvidence = { bytesReceived: 0 };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
  let stage: 'network' | 'parse' = 'network';
  try {
    const response = await fetcher(source, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
    result.httpStatus = response.status;
    if (!response.ok) { result.reason = response.status === 401 || response.status === 403 ? 'metadata_access_denied' : response.status === 429 ? 'rate_limited' : response.status === 404 ? 'model_not_listed' : 'provider_error'; return result; }
    if (!response.body) { result.reason = 'catalog_shape_unexpected'; return result; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; result.schemaEvidence.bytesReceived = size;
      if (size > MAX_BYTES) { result.reason = 'catalog_too_large'; return result; } chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); }
    stage = 'parse';
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    result.schemaEvidence.rootType = fieldType(parsed);
    const body = record(parsed);
    result.schemaEvidence.dataType = fieldType(body.data);
    result.schemaEvidence.idType = fieldType(body.id);
    if (provider === 'surplus' && !Array.isArray(body.data) || provider === 'cheaperinference' && typeof body.id !== 'string') {
      result.reason = 'catalog_shape_unexpected'; return result;
    }
    const rows = provider === 'surplus' ? (body.data as unknown[]).map(record) : [body];
    const matches = rows.filter(row => row.id === model);
    result.schemaEvidence.modelMatches = matches.length;
    if (matches.length !== 1) { result.reason = 'model_not_listed'; return result; }
    const row = matches[0], docs = documentedLimits(provider, model);
    result.schemaEvidence.contextType = fieldType(row.context_length);
    result.schemaEvidence.outputType = fieldType(provider === 'surplus' ? row.max_completion_tokens ?? record(row.top_provider).max_completion_tokens : row.max_output_tokens);
    result.schemaEvidence.modalityType = fieldType(provider === 'surplus' ? record(row.architecture).output_modalities : row.model_type);
    if (provider === 'surplus' && [row.architecture, row.top_provider].some(value => value != null && (typeof value !== 'object' || Array.isArray(value)))) { result.reason = 'catalog_shape_unexpected'; return result; }
    if (provider === 'cheaperinference' && (['id', 'model_type', 'endpoint', 'input_per_million', 'output_per_million', 'discount_percent'].some(key => typeof row[key] !== 'string') || !Array.isArray(row.supported_endpoints))) { result.reason = 'catalog_shape_unexpected'; return result; }
    result.limitsSource = 'catalog';
    const limit = (value: unknown, fallback: number | undefined): number | undefined => {
      if (value == null) { if (fallback !== undefined) result.limitsSource = 'catalog_and_model_documentation'; return fallback; }
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2097152) throw new Error('limit');
      return value;
    };
    try {
      result.contextTokens = limit(row.context_length, docs?.context);
      // Surplus documents BOTH positions. A present root value must not be overridden.
      if (provider === 'surplus') {
        const root = limit(row.max_completion_tokens, undefined), nested = limit(record(row.top_provider).max_completion_tokens, undefined);
        result.maxCompletionTokens = root !== undefined && nested !== undefined ? Math.min(root, nested) : root ?? nested ?? limit(undefined, docs?.output);
      } else result.maxCompletionTokens = limit(row.max_output_tokens, docs?.output);
    } catch { result.reason = 'catalog_limits_invalid'; return result; }
    const modalities = provider === 'surplus' ? record(row.architecture).output_modalities : undefined;
    if (modalities != null) {
      if (!Array.isArray(modalities) || modalities.some(v => typeof v !== 'string')) { result.reason = 'catalog_shape_unexpected'; return result; }
      result.textOutput = modalities.includes('text');
    } else if (provider === 'cheaperinference' && row.model_type != null) {
      if (typeof row.model_type !== 'string') { result.reason = 'catalog_shape_unexpected'; return result; }
      result.textOutput = row.model_type === 'text';
    } else if (docs) { result.textOutput = true; result.limitsSource = 'catalog_and_model_documentation'; }
    if (provider === 'cheaperinference') {
      if (row.supported_endpoints != null) {
        if (!Array.isArray(row.supported_endpoints) || row.supported_endpoints.some(v => typeof v !== 'string')) { result.reason = 'catalog_shape_unexpected'; return result; }
        result.chatCompletions = row.supported_endpoints.includes('/v1/chat/completions');
      } else if (row.endpoint != null) result.chatCompletions = row.endpoint === '/v1/chat/completions';
      else if (docs) { result.chatCompletions = true; result.limitsSource = 'catalog_and_model_documentation'; }
      // PublicModel exposes these rates at the top level in USD/million tokens.
      result.estimatedInputUsdPerMillion = decimal(row.input_per_million);
      result.estimatedOutputUsdPerMillion = decimal(row.output_per_million);
    }
    result.status = 'observed'; return result;
  } catch { result.reason = controller.signal.aborted ? 'timeout' : stage === 'network' ? 'network_error' : 'malformed_json'; return result; }
  finally { clearTimeout(timeout); }
}
