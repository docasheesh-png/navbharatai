import { isSurplusPublicBuildEngineFailure } from '../SurplusRegistry/surplusPreWriteFailOpen';
import { CanarySpendBlocked } from '../../AgentV3/reliability/canarySpendGuard';
import { SurplusLegacyFallbackError, StrictFreeCapabilityError } from '../inferencePolicy';
import { publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import type { WeakSurplusAdmissionGate } from '../SurplusRegistry/surplusChatAdmission';

/** Keep the existing pin policy and its lazy branches outside the oversized chat handler. */
export function admitWithRouterOnePin(pinned: boolean, admit: () => Promise<WeakSurplusAdmissionGate>): Promise<WeakSurplusAdmissionGate> {
  return pinned ? Promise.resolve({ ok: true, session: undefined, diag: undefined }) : admit();
}

export function scopeAskWithRouterOnePin<T>(pinned: boolean, routerOne: () => T, surplus: () => T): T {
  return pinned ? routerOne() : surplus();
}

type ScopeAsk = (system: string, user: string, signal: AbortSignal) => Promise<{ text: string }>;
/** Same Weak provider order for classification, under its single bounded deadline.
 * Only an eligible Surplus engine error drops its admitted scope; policy/spend refusals stop.
 */
export function weakScopeAsk(
  surplus: ScopeAsk | undefined, router: ScopeAsk | undefined, glm: ScopeAsk,
  dropSurplus: () => void,
): ScopeAsk {
  return async (system, user, signal) => {
    if (surplus) {
      try { return await surplus(system, user, signal); }
      catch (error) {
        if (signal.aborted || !isSurplusPublicBuildEngineFailure(error)) throw error;
        dropSurplus();
      }
    }
    if (router) {
      try { return await router(system, user, signal); }
      catch (error) {
        if (signal.aborted || error instanceof CanarySpendBlocked || error instanceof SurplusLegacyFallbackError
          || error instanceof StrictFreeCapabilityError || publicBuildEngineSafeReason(error) === 'policy_refusal') throw error;
      }
    }
    return glm(system, user, signal);
  };
}
