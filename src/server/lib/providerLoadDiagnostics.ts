import { LoadBatchError } from './providerLoadBatch';
export type LoadStage = 'configuration' | 'settings_read' | 'revision' | 'quote_configuration' | 'quote_transport' | 'quote_http' | 'quote_schema' | 'quote_rates' | 'configuration_write';
export class LoadDiagnosticError extends LoadBatchError {
  constructor(code: LoadBatchError['code'], readonly stage: LoadStage, readonly reason: string,
    readonly upstreamStatus?: number, readonly supplierCode?: string, readonly fields?: Record<string, string>, readonly keys?: string[]) { super(code); }
}
export async function loadStage<T>(stage: LoadStage, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof LoadDiagnosticError) throw error;
    const code = error instanceof LoadBatchError ? error.code : 'unavailable';
    throw new LoadDiagnosticError(code, stage, code === 'conflict' ? 'revision_conflict' : code === 'invalid' ? 'validation_failed' : code === 'corrupt' ? 'ledger_invalid' : 'operation_unavailable');
  }
}
const stages: LoadStage[] = ['configuration','settings_read','revision','quote_configuration','quote_transport','quote_http','quote_schema','quote_rates','configuration_write'];
const reasons = ['revision_conflict','validation_failed','ledger_invalid','operation_unavailable','key_missing','model_unsupported','timeout','network_error','http_rejected','invalid_json','schema_mismatch','invalid_rates','zero_bound'];
export const supplierCodes = ['list_price_unknown','min_discount_unavailable','invalid_min_discount','invalid_api_key','insufficient_balance','rate_limit_exceeded','model_not_found'];
export const quoteFields = ['object','model','min_discount_percent','max_input_per_million','max_output_per_million'];
export function safeLoadDiagnostic(error: unknown, correlationId: string) {
  const e = error instanceof LoadDiagnosticError ? error : null;
  const fields: Record<string,string> = {};
  for (const key of quoteFields) if (e?.fields && ['missing','null','array','object','string','number','boolean'].includes(e.fields[key])) fields[key] = e.fields[key];
  return { correlationId, stage: e && stages.includes(e.stage) ? e.stage : 'configuration',
    reason: e && reasons.includes(e.reason) ? e.reason : error instanceof LoadBatchError && error.code === 'conflict' ? 'revision_conflict' : error instanceof LoadBatchError && error.code === 'invalid' ? 'validation_failed' : 'operation_unavailable',
    ...(e?.upstreamStatus && Number.isInteger(e.upstreamStatus) && e.upstreamStatus >= 100 && e.upstreamStatus <= 599 ? { upstreamStatus: e.upstreamStatus } : {}),
    ...(e?.supplierCode && supplierCodes.includes(e.supplierCode) ? { supplierCode: e.supplierCode } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(e?.keys?.length ? { keys: e.keys.filter(k => typeof k === 'string' && /^[A-Za-z0-9_.]{1,64}$/.test(k)).slice(0, 40) } : {}) };
}
