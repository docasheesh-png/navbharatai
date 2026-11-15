import { PublicBuildEngineError } from '../../lib/buildEngineError';

/** The public completion contract reports tokens, not a settled supplier expense.
 * Dashboard wallet charges cannot be inferred from list prices or balance deltas.
 * Keep this independent of catalog/routing imports: accounting must not initialize them.
 */
export const isRouterOneAccountingProvider = (provider: string): boolean => provider.toUpperCase() === 'ENGINE_R1';

export class RouterOneAccountingUnavailableError extends PublicBuildEngineError {
  /**
   * `reason` names WHICH of our own pre-flight fences refused the call. Non-enumerable, like `code`: the public
   * boundary stays supplier-free (message, name, stack only) and the admin report can still say why. 🔴 Autopsy
   * 57604006: ENGINE_R1 "failed" 45 of 45 and 28 of 28 calls with the public wording alone, so the report blamed the
   * provider for what may have been our own accounting refusing to dispatch.
   */
  constructor(reason: string = 'unspecified') {
    super();
    Object.defineProperty(this, 'code', { value: 'ROUTER_ONE_ACCOUNTING_UNAVAILABLE', enumerable: false });
    Object.defineProperty(this, 'reason', { value: reason, enumerable: false });
  }
}

/** Did OUR accounting fence refuse this call (no request was dispatched on its account)? PURE. */
export function isRouterOneAccountingRefusal(error: unknown): boolean {
  return error instanceof RouterOneAccountingUnavailableError;
}
/** The fence that refused, for the admin report. PURE. */
export function routerOneRefusalReason(error: unknown): string | undefined {
  return error instanceof RouterOneAccountingUnavailableError ? String((error as { reason?: unknown }).reason ?? 'unspecified') : undefined;
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
