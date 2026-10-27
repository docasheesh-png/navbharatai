import { PublicBuildEngineError, publicBuildEngineError } from '../../lib/buildEngineError';
import { randomUUID } from 'node:crypto';
import { parseEnvFlag } from '../../lib/envFlag';
import { SURPLUS_MIN90_BASE_URL } from '../../lib/surplusClient';
import { raceStop, throwIfStopped } from '../../AgentV3/stopSignal';
import type { RunTurnParams, TurnResult, TurnUsage } from '../../AgentV3/ClaudeClient';
import { makeSurplusTurnRunner, type SurplusTurnPermit, type SurplusTurnFailure } from '../../AgentV3/providers/SurplusTurnRunner';
import type { OpenAiCompletionLike } from '../../AgentV3/providers/OpenAiToolAdapter';
import { planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { isSurplusReceiptDecision } from './receiptPolicy';
import { createProductionSurplusAdapter } from './productionAdapter';
import type { Reviews, Snapshot, Workload } from './types';

export const SURPLUS_BUILD_POLICY = 'surplus-build-10x-official-cap-v1';
export function surplusBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) === true;
}
const SAFE_ADMISSION_REASONS = new Set([
  'reviewed_capability_or_exact_route_contract_missing', 'invalid_build_scope', 'weak_model_not_authorized',
  'previous_call_accounting_unavailable', 'price_objective_not_enforced', 'returned_route_identity_mismatch',
  'expired_or_replayed_dispatch', 'response_accounting_unavailable', 'invalid_workload',
  'stale_or_missing_snapshot', 'pricing_units_not_independently_verified', 'account_or_privacy_not_reviewed',
  'no_reviewed_coding_models', 'incomparable_quality_cohorts', 'no_eligible_90_percent_offer',
  'invalid_metadata_or_review', 'request_time_floor_contract_not_reviewed',
]);
export class SurplusBuildUnavailableError extends PublicBuildEngineError {
  declare readonly code: 'DISCOUNT_BUILD_UNAVAILABLE';
  declare readonly reason: string;
  readonly status = 503;
  constructor(reason: string) {
    super();
    Object.defineProperties(this, {
      code: { value: 'DISCOUNT_BUILD_UNAVAILABLE', enumerable: false },
      reason: { value: SAFE_ADMISSION_REASONS.has(reason) ? reason : 'review_unavailable', enumerable: false },
    });
  }
}
/** Approval is independent of polling. No environment variable can create this evidence. */
export interface SurplusCapabilityReview {
  reviewId: string; model: string; modelVersion: string; providerId: string;
  reviewedAt: number; expiresAt: number;
  contextTokens: number; maxOutputTokens: number;
  tools: true; parallelTools: true; transcriptRoundTrip: true;
  providerPinVerified: true; returnedIdentityVerified: true; reportedChargeContractVerified: true;
  endpoint: typeof SURPLUS_MIN90_BASE_URL;
}
export interface SurplusReviewedState {
  snapshot: Snapshot | null; reviews: Reviews; capabilities: SurplusCapabilityReview[]; floorContract: SurplusRequestFloorContract;
}
/** A reviewed wire contract, not guessed provider-pin JSON. Production has no approved contract yet. */
export interface SurplusReviewedAdapter {
  readState(): Promise<SurplusReviewedState>;
  routing(review: SurplusCapabilityReview): Readonly<Record<string, unknown>>;
  bind?(permit: SurplusTurnPermit, state: SurplusReviewedState, review: SurplusCapabilityReview): void;
  dispatch(request: Record<string, unknown>, signal: AbortSignal, permit: SurplusTurnPermit): Promise<unknown>;
  identify(raw: unknown): { model: string; providerId: string; completion: OpenAiCompletionLike };
  receipt(raw: unknown, permit: SurplusTurnPermit, result: TurnResult): Promise<TurnUsage['surplusReceipt']>;
  failure?(raw: unknown, permit: SurplusTurnPermit, result: TurnResult, failure: SurplusTurnFailure): Promise<{ receipt?: TurnUsage['surplusReceipt']; canRetry: boolean }>;
}
export interface SurplusBuildSession {
  readonly buildId: string;
  readonly model: string;
  readonly estimatedMicroUsd: string;
  runner(callbacks?: { onTurnComplete?: (result: TurnResult, used: 'SURPLUS') => void; onProviderUsed?: (permit: SurplusTurnPermit) => void }): ReturnType<typeof makeSurplusTurnRunner>;
}
const fail = (reason: string): never => { throw new SurplusBuildUnavailableError(reason); };
function estimate(params: RunTurnParams): Workload {
  // Deliberately conservative token bound; this is an ESTIMATE, never invoice evidence.
  const input = Buffer.byteLength(JSON.stringify([params.system, params.messages, params.tools]), 'utf8');
  return { input, output: params.maxTokens ?? 8192, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}
function capability(state: SurplusReviewedState, selection: { model: string; providerId: string; offerId: string }, now: number, workload: Workload): SurplusCapabilityReview {
  const r = state.capabilities.find(c => c.model === selection.model && c.providerId === selection.providerId);
  if (!r || !r.reviewId || !r.modelVersion || r.endpoint !== SURPLUS_MIN90_BASE_URL || r.tools !== true || r.parallelTools !== true
      || r.transcriptRoundTrip !== true || r.providerPinVerified !== true || r.returnedIdentityVerified !== true || r.reportedChargeContractVerified !== true
      || !Number.isFinite(r.reviewedAt) || r.reviewedAt > now || !Number.isFinite(r.expiresAt) || r.expiresAt <= now
      || !Number.isSafeInteger(r.contextTokens) || !Number.isSafeInteger(r.maxOutputTokens)
      || workload.input + workload.output > r.contextTokens || workload.output > r.maxOutputTokens) return fail('reviewed_capability_or_exact_route_contract_missing');
  return r;
}
/** Default OFF is a strict no-I/O path. ON with SURPLUS_API_KEY uses live key+flag admission (no Firestore review seed). */
export async function createSurplusBuildSession(options: {
  buildId: string; tier: string; initialWorkload?: Workload; enabled?: boolean; adapter?: SurplusReviewedAdapter; now?: () => number;
}): Promise<SurplusBuildSession | undefined> {
  if (!(options.enabled ?? surplusBuilderEnabled())) return undefined;
  const adapter = options.adapter ?? createProductionSurplusAdapter();
  if (!options.buildId || options.tier !== 'weak') return fail('invalid_build_scope'); // Owner 2026-10-25: Surplus = Weak only; Normal/Strong stay direct.
  const now = options.now ?? Date.now;
  const initialWorkload: Workload = options.initialWorkload ?? { input: 8192, output: 8192, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const initialState = await adapter.readState();
  function eligibleSnapshot(state: SurplusReviewedState, workload: Workload, at: number, selectedModel?: string, excluded = new Set<string>()) {
    return state.snapshot ? { ...state.snapshot, offers: state.snapshot.offers.filter(offer => {
      if ((selectedModel && offer.model !== selectedModel) || excluded.has(offer.model)
          || (options.tier === 'weak' && /claude|sonnet|opus/i.test(offer.model))) return false;
      try { capability(state, offer, at, workload); return true; } catch { return false; }
    }) } : null;
  }
  const initial = planSurplusDispatchCandidate(eligibleSnapshot(initialState, initialWorkload, now()), initialState.reviews, initialWorkload, now(), initialState.floorContract);
  if (initial.status !== 'estimated_candidate' || !initial.selection) return fail(initial.reason);
  let model = initial.selection.model;
  let poisoned = false;
  let terminalPolicyFailure: PublicBuildEngineError | undefined;
  // Serialize inference across ALL runners of this build. Parallel tool execution is unchanged.
  // A queued call may be cancelled before spending; only durably resolved safe failures can get a new attempt.
  let queue: Promise<void> = Promise.resolve();
  let turnQueue: Promise<void> = Promise.resolve();
  const activePermits = new Map<string, SurplusTurnPermit>();
  const releases = new WeakMap<object, () => void>();
  async function acquire(permit: SurplusTurnPermit, signal: AbortSignal) {
    const previous = queue; let release!: () => void;
    const slot = new Promise<void>(resolve => { release = resolve; });
    queue = previous.then(() => slot);
    try { await raceStop(previous, signal); throwIfStopped(signal); }
    catch (error) { release(); throw error; }
    releases.set(permit, release); activePermits.set(permit.callId, permit);
  }
  function release(permit: SurplusTurnPermit) { releases.get(permit)?.(); releases.delete(permit); activePermits.delete(permit.callId); }
  const issued = new WeakMap<object, { review: SurplusCapabilityReview; used: boolean; state: SurplusReviewedState; workload: Workload }>();
  return Object.freeze({ buildId: options.buildId, get model() { return model; }, estimatedMicroUsd: initial.selection.estimatedMicroUsd,
    runner(callbacks: Parameters<SurplusBuildSession['runner']>[0] = {}) {
      const failedModels = new WeakMap<object, Set<string>>();
      const authorizedFallbacks = new WeakSet<object>();
      async function authorize(params: RunTurnParams, previous?: SurplusTurnPermit) {
          if (terminalPolicyFailure) throw terminalPolicyFailure;
          if (poisoned) return fail('previous_call_accounting_unavailable');
          const workload = estimate(params), state = await adapter.readState(), at = now();
          // A winning model stays sticky. Only a durably resolved safe failed turn may change it.
          const excluded = previous ? new Set([...(failedModels.get(previous) ?? []), previous.model]) : new Set<string>();
          const snapshot = eligibleSnapshot(state, workload, at, previous ? undefined : model, excluded);
          const plan = planSurplusDispatchCandidate(snapshot, state.reviews, workload, at, state.floorContract);
          if (plan.status !== 'estimated_candidate' || !plan.selection) return fail(plan.reason);
          const selectedModel = plan.selection.model;
          const review = capability(state, plan.selection, at, workload);
          const requestRouting = adapter.routing(review);
          if (!requestRouting || requestRouting.provider !== review.providerId || (requestRouting.si_route as { objective?: unknown })?.objective !== 'price') return fail('price_objective_not_enforced');
          const frozenState = structuredClone({ ...state, snapshot });
          const permit: SurplusTurnPermit = Object.freeze({ buildId: options.buildId, callId: randomUUID(), model: selectedModel,
            providerId: plan.selection.providerId, offerId: plan.selection.offerId, endpoint: SURPLUS_MIN90_BASE_URL,
            priceGeneration: plan.snapshotVersion!, estimatedMicroUsd: plan.selection.estimatedMicroUsd, policyVersion: SURPLUS_BUILD_POLICY, maxTokens: params.maxTokens ?? 8192,
            requestRouting: Object.freeze({ ...requestRouting }),
            assertCurrent() {
              if (terminalPolicyFailure) throw terminalPolicyFailure;
              if (poisoned) return fail('previous_call_accounting_unavailable');
              const checked = planSurplusDispatchCandidate(frozenState.snapshot, frozenState.reviews, workload, now(), frozenState.floorContract);
              if (checked.status !== 'estimated_candidate' || !checked.selection) return fail(checked.reason);
              capability(frozenState, { model: selectedModel, providerId: review.providerId, offerId: plan.selection!.offerId }, now(), workload);
            },
            validateResponse(raw: unknown) {
              const identity = adapter.identify(raw);
              if (identity.model !== selectedModel || identity.providerId !== review.providerId) return fail('returned_route_identity_mismatch');
              return identity.completion;
            },
          });
          adapter.bind?.(permit, state, review);
          issued.set(permit, { review, used: false, state: frozenState, workload });
          failedModels.set(permit, excluded);
          return permit;
      }
      const native = makeSurplusTurnRunner({
        authorize,
        async authorizeFallback(params, previous) {
          if (!authorizedFallbacks.delete(previous) || poisoned) return undefined;
          return authorize(params, previous);
        },
        async dispatch(request, signal, permit) {
          await acquire(permit, signal);
          const grant = issued.get(permit);
          if (poisoned || !grant || grant.used || grant.review.expiresAt <= now()) { release(permit); return fail('expired_or_replayed_dispatch'); }
          const rechecked = planSurplusDispatchCandidate(grant.state.snapshot, grant.state.reviews, grant.workload, now(), grant.state.floorContract);
          if (rechecked.status !== 'estimated_candidate' || !rechecked.selection) { release(permit); return fail(rechecked.reason); }
          try {
            capability(grant.state, { model: permit.model, providerId: permit.providerId, offerId: permit.offerId }, now(), grant.workload);
            grant.used = true; // An uncertain request is never automatically replayed.
            return await adapter.dispatch(request as unknown as Record<string, unknown>, signal, permit);
          }
          catch (error) { release(permit); throw error; }
        },
        async onResponse(raw, permit, result) {
          let receipt: TurnUsage['surplusReceipt'];
          try { receipt = await adapter.receipt(raw, permit, result); }
          catch (error) { poisoned = true; release(permit); throw error; }
          if (!isSurplusReceiptDecision(receipt) || !['chargeable', 'absorbed'].includes(receipt.status)) {
            poisoned = true;
            result.usage.surplusReceipt = receipt;
            callbacks.onTurnComplete?.(result, 'SURPLUS');
            release(permit);
            return fail('response_accounting_unavailable');
          }
          return receipt;
        },
        async onFailure(raw, permit, _error, failure) {
          // Refusal cannot be downgraded into generic poisoned-session availability on a later turn.
          if (failure?.reason === 'content_filter') terminalPolicyFailure = publicBuildEngineError('policy_refusal');
          const result: TurnResult = { text: '', toolUses: [], rawContent: [], stopReason: null, model: permit.model,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, measured: false } };
          try {
            if (failure && adapter.failure) {
              const resolution = await adapter.failure(raw, permit, result, failure);
              if (resolution.receipt) {
                result.usage.surplusReceipt = resolution.receipt;
                callbacks.onTurnComplete?.(result, 'SURPLUS');
              }
              if (resolution.canRetry === true && failure.attempt < 3) {
                authorizedFallbacks.add(permit);
                return { retry: true as const, receiptDurablyRecorded: true as const };
              }
            } else {
              result.usage.surplusReceipt = await adapter.receipt(raw, permit, result);
              callbacks.onTurnComplete?.(result, 'SURPLUS');
            }
            poisoned = true;
          } catch (error) { poisoned = true; throw error; }
          finally { release(permit); }
        },
        onProviderUsed: permit => { model = permit.model; try { callbacks.onProviderUsed?.(permit); } catch { /* observation cannot hold the inference queue */ } },
        onTurnComplete(result, used) {
          try { callbacks.onTurnComplete?.(result, used); }
          finally { if (result.usage.surplusReceipt?.callId) {
            const permit = activePermits.get(result.usage.surplusReceipt.callId); if (permit) release(permit);
          } }
        },
      });
      return { async runTurn(params: RunTurnParams) {
        // Queue the complete failed-turn boundary, not individual HTTP attempts. A normal
        // concurrent turn must authorize AFTER the prior fallback winner becomes sticky.
        const previous = turnQueue;
        let releaseTurn!: () => void;
        const slot = new Promise<void>(resolve => { releaseTurn = resolve; });
        turnQueue = previous.then(() => slot);
        const deadlineAt = Math.min(params.deadlineAt ?? Infinity, Date.now() + 120_000);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await raceStop(Promise.race([previous, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new SurplusBuildUnavailableError('review_unavailable')), Math.max(0, deadlineAt - Date.now()));
          })]), params.signal);
          throwIfStopped(params.signal);
          return await native.runTurn({ ...params, deadlineAt });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          releaseTurn();
        }
      } };
    },
  });
}
