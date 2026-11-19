import { isSurplusPublicBuildEngineFailure } from '../SurplusRegistry/surplusPreWriteFailOpen';
import { CanarySpendBlocked } from '../../AgentV3/reliability/canarySpendGuard';
import { SurplusLegacyFallbackError, StrictFreeCapabilityError } from '../inferencePolicy';
import { publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import type { WeakSurplusAdmissionGate } from '../SurplusRegistry/surplusChatAdmission';
import { tagScopeFailure } from '../../AgentV3/scopeFailureDiagnostic';

/** Keep the existing pin policy and its lazy branches outside the oversized chat handler. */
export function admitWithRouterOnePin(pinned: boolean, admit: () => Promise<WeakSurplusAdmissionGate>): Promise<WeakSurplusAdmissionGate> {
  return pinned ? Promise.resolve({ ok: true, session: undefined, diag: undefined }) : admit();
}

export function scopeAskWithRouterOnePin<T>(pinned: boolean, routerOne: () => T, surplus: () => T): T {
  return pinned ? routerOne() : surplus();
}

type ScopeAsk = (system: string, user: string, signal: AbortSignal) => Promise<{ text: string }>;

/**
 * How long Surplus answers the one-word scope question alone before the next classifier is asked IN PARALLEL.
 *
 * 🔴 FAILEDBR #2470 (99771bc7, 2026-11-18). The Surplus scope ask has a reasoning-sized 30 s deadline (05016), and it
 * owned all of it: the call ran the full 30 s, failed, and the user watched an empty screen for half a minute before
 * "Build accepted" — while the faster classifiers behind it never got a turn (the shared deadline had expired). The
 * same engine then built the app without trouble, so the cure is not to drop Surplus but to stop one slow answer from
 * holding the door: after this head start the fallback order is asked too, and the first real answer wins. A healthy
 * Surplus answer still arrives first in the common case, so classification stays Surplus-first.
 */
export const SURPLUS_SCOPE_HEAD_START_MS = 8_000;

/** Same Weak provider order for classification, under its single bounded deadline.
 * Only an eligible Surplus engine error drops its admitted scope; policy/spend refusals stop.
 * A Surplus answer still pending after `headStartMs` is raced against the fallback order (first answer wins).
 */
export function weakScopeAsk(
  surplus: ScopeAsk | undefined, router: ScopeAsk | undefined, glm: ScopeAsk,
  dropSurplus: () => void,
  headStartMs: number = SURPLUS_SCOPE_HEAD_START_MS,
): ScopeAsk {
  const fallback: ScopeAsk = async (system, user, signal) => {
    if (router) {
      try { return await router(system, user, signal); }
      catch (error) {
        if (signal.aborted || error instanceof CanarySpendBlocked || error instanceof SurplusLegacyFallbackError
          || error instanceof StrictFreeCapabilityError || publicBuildEngineSafeReason(error) === 'policy_refusal') throw error;
      }
    }
    return glm(system, user, signal);
  };
  return async (system, user, signal) => {
    if (!surplus) return fallback(system, user, signal);
    // Surplus gets its own signal, linked to the deadline, so a won race can cancel it under its own name.
    const surplusAbort = new AbortController();
    const relay = () => surplusAbort.abort(signal.reason);
    if (signal.aborted) relay(); else signal.addEventListener('abort', relay, { once: true });
    const surplusCall = surplus(system, user, surplusAbort.signal);
    surplusCall.catch(() => { /* observed below; a loser's late rejection must not surface as unhandled */ });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      surplusCall.then((value) => ({ kind: 'surplus' as const, value }), (error: unknown) => ({ kind: 'surplusFailed' as const, error })),
      new Promise<{ kind: 'headStart' }>((resolve) => { timer = setTimeout(() => resolve({ kind: 'headStart' }), Math.max(0, headStartMs)); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (first.kind === 'surplus') return first.value;
    if (first.kind === 'surplusFailed') {
      if (signal.aborted || !isSurplusPublicBuildEngineFailure(first.error)) throw first.error;
      dropSurplus();
      return fallback(system, user, signal);
    }
    // Head start spent with no answer: ask the fallback order too; the first real answer wins.
    const hedge = fallback(system, user, signal);
    hedge.catch(() => { /* observed below */ });
    const settled = await new Promise<{ ok: true; value: { text: string } } | { ok: false; surplusError: unknown; hedgeError: unknown }>((resolve) => {
      let surplusError: unknown, hedgeError: unknown, failed = 0;
      const fail = () => { if (++failed === 2) resolve({ ok: false, surplusError, hedgeError }); };
      surplusCall.then((value) => resolve({ ok: true, value }), (e: unknown) => {
        surplusError = e;
        // A Surplus policy/spend refusal stops classification at once, exactly as before the hedge existed.
        if (!signal.aborted && !isSurplusPublicBuildEngineFailure(e)) { resolve({ ok: false, surplusError: e, hedgeError: undefined }); return; }
        fail();
      });
      hedge.then((value) => resolve({ ok: true, value }), (e: unknown) => { hedgeError = e; fail(); });
    });
    if (settled.ok) {
      // The loser is cancelled as "answered elsewhere" — the report reads it as info, never as a failed call.
      if (!surplusAbort.signal.aborted) surplusAbort.abort(tagScopeFailure(new Error('scope-answered-elsewhere'), { stage: 'hedge', reason: 'answered_elsewhere' }));
      return settled.value;
    }
    // Both failed: a Surplus policy/spend refusal keeps its meaning; otherwise the fallback's own error is the answer.
    if (!signal.aborted && !isSurplusPublicBuildEngineFailure(settled.surplusError)) throw settled.surplusError;
    if (!signal.aborted) dropSurplus();
    throw settled.hedgeError;
  };
}
