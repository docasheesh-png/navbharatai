import { PublicBuildEngineError } from '../../lib/buildEngineError';

/** The public completion contract reports tokens, not a settled supplier expense.
 * Dashboard wallet charges cannot be inferred from list prices or balance deltas.
 * Keep this independent of catalog/routing imports: accounting must not initialize them.
 */
export const isRouterOneAccountingProvider = (provider: string): boolean => provider.toUpperCase() === 'ENGINE_R1';

export class RouterOneAccountingUnavailableError extends PublicBuildEngineError {
  constructor() {
    super();
    Object.defineProperty(this, 'code', { value: 'ROUTER_ONE_ACCOUNTING_UNAVAILABLE', enumerable: false });
  }
}
