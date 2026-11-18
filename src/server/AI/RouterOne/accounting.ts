import { PublicBuildEngineError } from '../../lib/buildEngineError';
import { readEngineSafeDiag, tagEngineSafeDiag } from '../../lib/engineSafeDiag';

/** The public completion contract reports tokens, not a settled supplier expense.
 * Dashboard wallet charges cannot be inferred from list prices or balance deltas.
 * Keep this independent of catalog/routing imports: accounting must not initialize them.
 */
export const isRouterOneAccountingProvider = (provider: string): boolean => provider.toUpperCase() === 'ENGINE_R1';

/**
 * Which gate refused (BR2388). Supplier-free, enumerated, admin-only: kept in a WeakMap via
 * engineSafeDiag.ts — never an own property, never in the message, so the public error is unchanged.
 */
export type RouterOneAccountingGate =
  | 'unspecified'
  | 'no_scope' | 'no_turn' | 'scope_stopped' | 'aborted'
  | 'no_key' | 'max_tokens'
  | 'price_page' | 'price_page_size' | 'price_index' | 'price_model' | 'price_model_unlisted' | 'price_parse'
  | 'snapshot_invalid' | 'no_store' | 'uncertain_fence' | 'duration_invalid'
  | 'reserve_deadline' | 'reserve_duplicate' | 'reserve_fenced_unresolved' | 'key_state_invalid'
  | 'build_skip_unresolved_lock'
  | 'finish_state' | 'release_state' | 'receipt_mismatch' | 'rate_unavailable';

export class RouterOneAccountingUnavailableError extends PublicBuildEngineError {
  constructor(gate: RouterOneAccountingGate = 'unspecified') {
    super();
    Object.defineProperty(this, 'code', { value: 'ROUTER_ONE_ACCOUNTING_UNAVAILABLE', enumerable: false });
    tagEngineSafeDiag(this, { gate });
  }
}

/** The refusing gate of a Router One accounting error, or undefined for any other error. */
export function routerOneAccountingGate(error: unknown): RouterOneAccountingGate | undefined {
  if (!(error instanceof RouterOneAccountingUnavailableError)) return undefined;
  return (readEngineSafeDiag(error)?.gate as RouterOneAccountingGate | undefined) ?? 'unspecified';
}
/** Did our accounting fence refuse this call before a supplier request? */
export function isRouterOneAccountingRefusal(error: unknown): boolean {
  return error instanceof RouterOneAccountingUnavailableError;
}
/** The fence name for the admin report. The public error text stays supplier-free. */
export function routerOneRefusalReason(error: unknown): string | undefined {
  return routerOneAccountingGate(error);
}

/** X-Request-ID is the documented settlement correlation key, not the completion id.
 * Preserve metadata only; never read or buffer prompts, answers, or streaming bodies.
 * This is audit evidence, not a receipt and never authorizes a wallet charge.
 */
export function routerOneAccountingFetch(transport: typeof globalThis.fetch, model: string,
  record: (trace: { requestId: string | null; model: string; status: number; expenseEvidence: 'unknown' }) => void,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    const rawId = response.headers.get('x-request-id');
    const requestId = rawId && /^[a-zA-Z0-9_.:-]{1,256}$/.test(rawId) ? rawId : null;
    try { record({ requestId, model, status: response.status, expenseEvidence: 'unknown' }); }
    catch { /* A failed audit sink must not discard a provider response. */ }
    return response;
  };
}
