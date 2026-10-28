import type { DiagnosticProvider } from '../../shared/providerDiagnostics';

const MAX_BYTES = 2_000_000;
const ENDPOINTS = { surplus: 'https://api.surplusintelligence.ai/v1/models', cheaperinference: 'https://api.cheaperinference.com/v1/models' } as const;
export interface DiagnosticPriceObservation {
  status: 'observed' | 'unavailable';
  model: string;
  observedAt: number;
  /** Catalog prices are estimates, never receipts or a guaranteed request ceiling. */
  estimatedInputUsdPerMillion: string | null;
  estimatedOutputUsdPerMillion: string | null;
  source: string;
  contextTokens?: number;
  maxCompletionTokens?: number;
  textOutput?: boolean;
  reason?: 'authentication_rejected' | 'rate_limited' | 'network_error' | 'timeout' | 'config_missing' | 'malformed_catalog' | 'model_not_listed' | 'provider_error';
  httpStatus?: number;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const decimal = (v: unknown): string | null => typeof v === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,12})?$/.test(v) ? v : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9 ? String(v) : null;
/** Fixed existing provider endpoint, no retries/redirects, bounded read, no inference. */
export async function readDiagnosticCatalog(provider: DiagnosticProvider, model: string, env = process.env, fetcher = fetch): Promise<DiagnosticPriceObservation> {
  const result: DiagnosticPriceObservation = { status: 'unavailable', model, observedAt: Date.now(), estimatedInputUsdPerMillion: null, estimatedOutputUsdPerMillion: null, source: ENDPOINTS[provider] };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
  let stage: 'network' | 'parse' = 'network';
  try {
    // Surplus models is public. CheaperInference's catalog is filtered by the existing key.
    const key = provider === 'cheaperinference' ? env.CHEAPERINFERENCE_API_KEY?.trim() : undefined;
    if (provider === 'cheaperinference' && !key) { result.reason = 'config_missing'; return result; }
    const response = await fetcher(ENDPOINTS[provider], { method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
    result.httpStatus = response.status;
    if (!response.ok) { result.reason = response.status === 401 || response.status === 403 ? 'authentication_rejected' : response.status === 429 ? 'rate_limited' : 'provider_error'; return result; }
    if (!response.body) { result.reason = 'malformed_catalog'; return result; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_BYTES) { result.reason = 'malformed_catalog'; return result; } chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); }
    stage = 'parse';
    const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!Array.isArray(body.data)) { result.reason = 'malformed_catalog'; return result; }
    const matches = body.data.map(record).filter(row => row.id === model);
    if (matches.length !== 1) { result.reason = 'model_not_listed'; return result; }
    const pricing = record(matches[0].pricing);
    const maxOutput = matches[0].max_completion_tokens;
    if (Number.isSafeInteger(maxOutput) && Number(maxOutput) > 0) result.maxCompletionTokens = Number(maxOutput);
    const modalities = record(matches[0].architecture).output_modalities;
    if (Array.isArray(modalities)) result.textOutput = modalities.includes('text');
    const context = matches[0].context_length;
    if (Number.isSafeInteger(context) && Number(context) > 0 && Number(context) <= 2097152) result.contextTokens = Number(context);
    // Only CheaperInference documents these USD/million fields here. Do not guess Surplus units.
    if (provider === 'cheaperinference' && pricing.currency === 'USD') {
      result.estimatedInputUsdPerMillion = decimal(pricing.input_per_million);
      result.estimatedOutputUsdPerMillion = decimal(pricing.output_per_million);
    }
    result.status = 'observed'; return result;
  } catch { result.reason = controller.signal.aborted ? 'timeout' : stage === 'network' ? 'network_error' : 'malformed_catalog'; return result; }
  finally { clearTimeout(timeout); }
}
