import { PublicBuildEngineError, publicBuildEngineError, publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import { strongOffersOnly } from './strongOffers';
import { AiMaintenanceError } from '../../lib/aiMaintenance';
import { BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE } from '../../AgentV3/turnDeadline';
import { randomUUID } from 'node:crypto';
import { surplusBuilderLive } from './liveAdmission';
import { SURPLUS_MIN90_BASE_URL } from '../../lib/surplusClient';
import { BuildStoppedError, raceStop, throwIfStopped } from '../../AgentV3/stopSignal';
import type { RunTurnParams, TurnResult, TurnUsage } from '../../AgentV3/ClaudeClient';
import { makeSurplusTurnRunner, type SurplusTurnPermit, type SurplusTurnFailure } from '../../AgentV3/providers/SurplusTurnRunner';
import type { OpenAiCompletionLike } from '../../AgentV3/providers/OpenAiToolAdapter';
import { planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { isSurplusReceiptDecision } from './receiptPolicy';
import { createProductionSurplusAdapter } from './productionAdapter';
import type { Reviews, Snapshot, Workload } from './types';

export const SURPLUS_BUILD_POLICY = 'surplus-build-10x-official-cap-v1';
/**
 * Default ON (owner 2026-11-17). True when the switch is not explicitly off AND a usable SURPLUS_API_KEY is set.
 * Without a key this is false, so a keyless server takes the same no-I/O path the old default-OFF took.
 */
export function surplusBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return surplusBuilderLive(env);
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
  identify(raw: unknown, expectedModel?: string): { model: string; providerId: string; completion: OpenAiCompletionLike };
  receipt(raw: unknown, permit: SurplusTurnPermit, result: TurnResult): Promise<TurnUsage['surplusReceipt']>;
  failure?(raw: unknown, permit: SurplusTurnPermit, result: TurnResult, failure: SurplusTurnFailure): Promise<{ receipt?: TurnUsage['surplusReceipt']; canRetry: boolean }>;
}
export interface SurplusBuildSession {
  readonly buildId: string;
  readonly model: string;
  readonly estimatedMicroUsd: string;
  runner(callbacks?: { onTurnComplete?: (result: TurnResult, used: 'SURPLUS') => void; onProviderUsed?: (permit: SurplusTurnPermit) => void; onAttemptFailed?: (failure: SurplusAttemptFailure) => void }): ReturnType<typeof makeSurplusTurnRunner>;
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
/** OpenAI-style reasoning ids (gpt-5.x, o-series, *-sol/-terra, *thinking/*reason*). Flash/mini/instruct stay plain. */
export function isSurplusReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  if (/flash|instruct|chat|non-?reason|turbo/.test(m)) return false;
  return /(^|\/)(gpt-5|o[1-9])|-(sol|terra)\b|think|reason|\br1\b/.test(m);
}
/** Switched off or keyless is a strict no-I/O path. A key with the switch not off uses live admission (no Firestore review seed). */
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
    if (!state.snapshot) return null;
    const offers = state.snapshot.offers.filter(offer => {
      if ((selectedModel && offer.model !== selectedModel) || excluded.has(offer.model)
          || (options.tier === 'weak' && /claude|sonnet|opus/i.test(offer.model))) return false;
      try { capability(state, offer, at, workload); return true; } catch { return false; }
    });
    // THE SHARED RULE'S FILTER (modelChoice.ts, admin 2026-11-18): Surplus keeps its own reviewed, price-objective
    // choice and its accounting; it only stops choosing outside the strong coding families — and never empties.
    return { ...state.snapshot, offers: strongOffersOnly(offers) };
  }
  // Scope/first call: prefer a flash / non-reasoning Surplus model (reasoning models burned the budget
  // thinking → empty/invalid scope answers). Reasoning models stay eligible as the Surplus-internal B/C.
  const reasoningModels = new Set((initialState.snapshot?.offers ?? []).map(o => o.model).filter(isSurplusReasoningModel));
  const plainFirst = planSurplusDispatchCandidate(eligibleSnapshot(initialState, initialWorkload, now(), undefined, reasoningModels), initialState.reviews, initialWorkload, now(), initialState.floorContract);
  const initial = plainFirst.status === 'estimated_candidate' && plainFirst.selection ? plainFirst
    : planSurplusDispatchCandidate(eligibleSnapshot(initialState, initialWorkload, now()), initialState.reviews, initialWorkload, now(), initialState.floorContract);
  if (initial.status !== 'estimated_candidate' || !initial.selection) return fail(initial.reason);
  let model = initial.selection.model;
  // DNA (failedbr 627/630, 2026-10-30): a mid-build turn that failed (budget/deadline abort, transport,
  // empty) or whose failure receipt could not be settled used to poison the session, so EVERY later turn died
  // with previous_call_accounting_unavailable (503 DISCOUNT_BUILD_UNAVAILABLE → "engine unavailable").
  // Billing never blocks inference: the failed turn's cost is absorbed, its model is benched for this
  // session, and the next turn moves to another Surplus-internal model (AI2/AI3) — never Weak.
  const benchedModels = new Set<string>();
  // Q-3019 (failedbr #2478): benching on the FIRST failure moved the next turn to another model with a cold cache —
  // same-model calls took a median 4.6 s, the first call after a switch 36.7 s, ~7.5 of a 25-minute build. A single
  // failure is most often transient (a timeout, a dropped socket), so a model is benched only at its SECOND failure in
  // this session; the retry in between stays on the same model and keeps its warm cache. A policy refusal stays terminal.
  const failuresByModel = new Map<string, number>();
  let terminalPolicyFailure: PublicBuildEngineError | undefined;
  // Owner 2026-11-16 ("ek bar me ek call wali limit hatao, 100+ call ek saath"): model calls of one build
  // used to be fully serialized here, so a build's agents waited on each other. They now run in parallel up
  // to `SURPLUS_PARALLEL_CALLS_PER_BUILD` (default 128; `1` restores the old one-at-a-time order). A queued
  // call may still be cancelled before spending; only durably resolved safe failures get a new attempt.
  const parallel = surplusParallelCallsPerBuild();
  const callSlots = createSurplusSlots(parallel);
  const turnSlots = createSurplusSlots(parallel);
  const activePermits = new Map<string, SurplusTurnPermit>();
  const releases = new WeakMap<object, () => void>();
  async function acquire(permit: SurplusTurnPermit, signal: AbortSignal) {
    const release = await callSlots.acquire(signal);
    releases.set(permit, release); activePermits.set(permit.callId, permit);
  }
  function release(permit: SurplusTurnPermit) { releases.get(permit)?.(); releases.delete(permit); activePermits.delete(permit.callId); }
  const issued = new WeakMap<object, { review: SurplusCapabilityReview; used: boolean; state: SurplusReviewedState; workload: Workload }>();
  return Object.freeze({ buildId: options.buildId, get model() { return model; }, estimatedMicroUsd: initial.selection.estimatedMicroUsd,
    runner(callbacks: Parameters<SurplusBuildSession['runner']>[0] = {}) {
      const failedModels = new WeakMap<object, Set<string>>();
      /** Failed attempts already reported by the per-attempt handler, so the stay-alive loop never counts one twice. */
      let attemptNotices = 0;
      const authorizedFallbacks = new WeakSet<object>();
      async function authorize(params: RunTurnParams, previous?: SurplusTurnPermit) {
          if (terminalPolicyFailure) throw terminalPolicyFailure;
          const workload = estimate(params), state = await adapter.readState(), at = now();
          // A winning model stays sticky. Only a durably resolved safe failed turn may change it.
          const excluded = previous ? new Set([...(failedModels.get(previous) ?? []), previous.model]) : new Set<string>();
          for (const m of benchedModels) excluded.add(m);
          let snapshot = eligibleSnapshot(state, workload, at, previous ? undefined : model, excluded);
          let plan = planSurplusDispatchCandidate(snapshot, state.reviews, workload, at, state.floorContract);
          if ((plan.status !== 'estimated_candidate' || !plan.selection) && benchedModels.size > 0 && !previous) {
            // Every alternative is benched: un-bench once and retry on Surplus rather than refusing the build.
            for (const m of benchedModels) excluded.delete(m);
            benchedModels.clear();
            snapshot = eligibleSnapshot(state, workload, at, undefined, excluded);
            plan = planSurplusDispatchCandidate(snapshot, state.reviews, workload, at, state.floorContract);
          }
          // DNA (z@ live 2026-10-29): the sticky model is the small flash scope model; a full build turn
          // (system+tools) can exceed its reviewed context/output, which filtered the ONLY allowed offer
          // and threw DISCOUNT_BUILD_UNAVAILABLE. Stickiness is a preference: move to another eligible
          // Surplus model (Surplus AI2/AI3) instead of refusing the build.
          if (!previous && (plan.status !== 'estimated_candidate' || !plan.selection)) {
            snapshot = eligibleSnapshot(state, workload, at, undefined, excluded);
            plan = planSurplusDispatchCandidate(snapshot, state.reviews, workload, at, state.floorContract);
          }
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
              const checked = planSurplusDispatchCandidate(frozenState.snapshot, frozenState.reviews, workload, now(), frozenState.floorContract);
              if (checked.status !== 'estimated_candidate' || !checked.selection) return fail(checked.reason);
              capability(frozenState, { model: selectedModel, providerId: review.providerId, offerId: plan.selection!.offerId }, now(), workload);
            },
            validateResponse(raw: unknown) {
              const identity = adapter.identify(raw, selectedModel);
              if (identity.model !== selectedModel || identity.providerId !== review.providerId) return fail('returned_route_identity_mismatch');
              return identity.completion;
            },
          });
          adapter.bind?.(permit, state, review);
          issued.set(permit, { review, used: false, state: frozenState, workload });
          failedModels.set(permit, excluded);
          return permit;
      }
      const stayAlive = surplusStayAlivePolicy();
      const native = makeSurplusTurnRunner({
        authorize,
        timeoutMs: stayAlive.turnMs,
        async authorizeFallback(params, previous) {
          if (!authorizedFallbacks.delete(previous)) return undefined;
          return authorize(params, previous);
        },
        async dispatch(request, signal, permit) {
          await acquire(permit, signal);
          const grant = issued.get(permit);
          if (!grant || grant.used || grant.review.expiresAt <= now()) { release(permit); return fail('expired_or_replayed_dispatch'); }
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
          // DNA (z@ live 2026-10-30): a validated, identity-checked Surplus reply whose receipt could not be
          // settled (blocked/duplicate/conflict, or the audit store threw) used to poison the whole session:
          // that turn died with response_accounting_unavailable and every later turn with
          // previous_call_accounting_unavailable — killing a build that Surplus was answering fine.
          // Accounting is now non-fatal: the reply is kept, the cost is absorbed (user charge 0), and the
          // reason is logged for reconciliation. Billing never blocks inference.
          let receipt: TurnUsage['surplusReceipt'];
          try { receipt = await adapter.receipt(raw, permit, result); }
          catch (error) {
            console.warn(`[SURPLUS] receipt unavailable (non-fatal, absorbed): ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`);
            release(permit);
            return undefined;
          }
          if (!isSurplusReceiptDecision(receipt) || !['chargeable', 'absorbed'].includes(receipt.status)) {
            const why = isSurplusReceiptDecision(receipt) ? `${receipt.status}:${receipt.reason}` : 'invalid_decision';
            console.warn(`[SURPLUS] receipt not settled (non-fatal, absorbed): ${why}`);
            release(permit);
            return isSurplusReceiptDecision(receipt) ? receipt : undefined;
          }
          return receipt;
        },
        async onFailure(raw, permit, _error, failure) {
          // Refusal cannot be downgraded into generic poisoned-session availability on a later turn.
          if (failure?.reason === 'content_filter') terminalPolicyFailure = publicBuildEngineError('policy_refusal');
          const result: TurnResult = { text: '', toolUses: [], rawContent: [], stopReason: null, model: permit.model,
            // A FAILED attempt (Q-2920): it did not answer, so it is not "a provider that returned no usage".
            usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, measured: false, failedAttempt: true } };
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
          } catch (error) {
            // Unsettled failure accounting is absorbed (user charge 0) and logged; it never poisons the session.
            console.warn(`[SURPLUS] failure receipt unavailable (non-fatal, absorbed): ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`);
          }
          finally { release(permit); }
          const failures = (failuresByModel.get(permit.model) ?? 0) + 1;
          failuresByModel.set(permit.model, failures);
          const bench = !terminalPolicyFailure && (failures >= SURPLUS_FAILURES_BEFORE_BENCH || refusedOutright(failure?.httpStatus));
          if (bench) {
            benchedModels.add(permit.model);
            if (model === permit.model) {
              const alt = (initialState.snapshot?.offers ?? []).map(o => o.model).find(m => !benchedModels.has(m) && !(options.tier === 'weak' && /claude|sonnet|opus/i.test(m)));
              if (alt) model = alt;
            }
          }
          // Q-3019 (failedbr #2478): a failed attempt was retried inside this session and reached the report only as a
          // slower "ok" call — the report said no engine wasted any time. It is now said, with codes only.
          attemptNotices++;
          notifyAttemptFailed(callbacks, { model: permit.model, stage: failure?.stage ?? 'dispatch', reason: failure?.reason ?? 'dispatch_failed',
            attempt: failure?.attempt ?? 1, ...(typeof failure?.httpStatus === 'number' ? { httpStatus: failure.httpStatus } : {}), benched: bench, ...(bench && model !== permit.model ? { nextModel: model } : {}), ...(!bench && !terminalPolicyFailure ? { sameModelRetry: true } : {}) });
        },
        onProviderUsed: permit => { model = permit.model; try { callbacks.onProviderUsed?.(permit); } catch { /* observation cannot hold the inference queue */ } },
        onTurnComplete(result, used) {
          try { callbacks.onTurnComplete?.(result, used); }
          finally { if (result.usage.surplusReceipt?.callId) {
            const permit = activePermits.get(result.usage.surplusReceipt.callId); if (permit) release(permit);
          } }
        },
      });
      return {
        // BR1992: what this Surplus session will call next, for RECORDS only (TurnRunner.plannedModel). Without it a
        // Surplus call stopped by the build's clock was filed under the request's Claude default
        // (`claude-sonnet-4-6`) on a Weak build that can never call Claude. Never sent to any provider.
        get plannedModel() { return model; },
        async runTurn(params: RunTurnParams) {
        // Queue the complete failed-turn boundary, not individual HTTP attempts. A normal
        // concurrent turn must authorize AFTER the prior fallback winner becomes sticky.
        // Waiting for a free slot behind other turns of the SAME build is not a Surplus failure: never time
        // it out into "engine unavailable" — each running turn is itself bounded by its own deadline.
        const releaseTurn = await turnSlots.acquire(params.signal);
        try {
          // DNA (failedbr A–C 2026-10-31, owner: "Surplus marna nahi chahiye"): a single transient
          // turn failure (timeout / transport / empty / unsettled) used to end the whole game build with
          // ENGINE_UNAVAILABLE after files were half-written. Keep the SAME Surplus session alive:
          // retry the turn with backoff and a fresh per-turn deadline (other Surplus models after a
          // benched one), so one Surplus run finishes the whole game. Only Stop, maintenance, policy
          // refusal, the build's own budget/deadline, or exhausting the retry budget end it.
          const policy = stayAlive;
          let lastError: unknown;
          for (let attempt = 0; attempt <= policy.retries; attempt++) {
            throwIfStopped(params.signal);
            const now0 = Date.now();
            const outer = params.deadlineAt ?? Infinity;
            if (attempt > 0 && outer - now0 < policy.minTurnMs) break;
            const deadlineAt = Math.min(outer, now0 + policy.turnMs);
            const noticesBefore = attemptNotices;
            try {
              return await native.runTurn({ ...params, deadlineAt });
            } catch (error) {
              lastError = error;
              if (!isSurplusTurnRetryable(error) || params.signal?.aborted || terminalPolicyFailure) throw error;
              if (attempt >= policy.retries) break;
              const wait = policy.backoffMs[Math.min(attempt, policy.backoffMs.length - 1)];
              try { console.warn(`[SURPLUS] stay-alive: turn retry ${attempt + 1}/${policy.retries} in ${wait}ms`); } catch { /* best-effort */ }
              // Q-3019: a failed turn no per-attempt notice covered (a timeout, a transport death before dispatch) — once,
              // with its time and the wait before the next try. One failure is one notice, so the tally stays true.
              if (attemptNotices === noticesBefore) {
                notifyAttemptFailed(callbacks, { model, stage: 'turn', reason: publicBuildEngineSafeReason(error) ?? 'turn_failed',
                  attempt: attempt + 1, elapsedMs: Date.now() - now0, retryInMs: wait });
              }
              await raceStop(new Promise<void>(resolve => setTimeout(resolve, wait)), params.signal);
            }
          }
          throw lastError;
        } finally {
          releaseTurn();
        }
      } };
    },
  });
}

/**
 * One failed Surplus attempt, as the build report may show it (Q-3019). Codes only — never the raw provider text,
 * which stays behind the public wording (rawErrorDetail.ts).
 */
export interface SurplusAttemptFailure {
  model: string;
  /** 'dispatch' / 'response_validation' (one HTTP attempt) or 'turn' (the whole turn, retried by the stay-alive loop). */
  stage: string;
  reason: string;
  attempt: number;
  elapsedMs?: number;
  retryInMs?: number;
  /** The model was taken out of this build's rotation — the next turn starts on another model, with a cold cache. */
  benched?: boolean;
  nextModel?: string;
  /** The attempt's HTTP status when the engine answered with one (Q-3234). A refused request (not 2xx) is said as such. */
  httpStatus?: number;
  /** First failure of this model in the session: the retry stays on it, cache warm (Q-3019). */
  sameModelRetry?: boolean;
}

/**
 * A REFUSED request leaves the rotation at once (failedbr #2485, Q-3234; admin decision 2026-11-21, option A). The engine
 * answered HTTP 404 six times across three models — 85.5 s that returned nothing — because a refusal was treated like a blip
 * and retried on the same model first. A 4xx is the engine saying it will not serve this request, not a passing fault;
 * only "too many requests" (429) and "request timeout" (408) are passing, and keep the warm-cache retry. PURE.
 */
export function refusedOutright(httpStatus: number | undefined): boolean {
  return typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;
}

/** A model leaves this build's rotation only at this many failures (Q-3019: once was a cold-cache switch per blip). */
export const SURPLUS_FAILURES_BEFORE_BENCH = 2;

/** Plain words for the report: what failed, what it cost, what happens next. PURE. */
export function describeSurplusAttemptFailure(f: SurplusAttemptFailure): string {
  // An answer that was never a completion is not an "invalid completion": a refused request is named by its status.
  const refused = typeof f.httpStatus === 'number' && (f.httpStatus < 200 || f.httpStatus >= 300);
  const parts = [`Surplus attempt ${f.attempt} on ${f.model} failed (${f.stage}: ${refused ? `the engine refused the request, HTTP ${f.httpStatus}` : f.reason})`];
  if (typeof f.elapsedMs === 'number') parts.push(`after ${Math.round(f.elapsedMs / 100) / 10}s`);
  if (f.benched) parts.push(f.nextModel ? `— ${f.model} is benched for this build; the next turn moves to ${f.nextModel}, whose cache is cold` : `— ${f.model} is benched for this build`);
  if (f.sameModelRetry) parts.push(`— retried on the same model (its cache stays warm); a second failure benches it`);
  if (typeof f.retryInMs === 'number') parts.push(`— retrying in ${Math.round(f.retryInMs / 1000)}s`);
  return parts.join(' ');
}

function notifyAttemptFailed(callbacks: { onAttemptFailed?: (f: SurplusAttemptFailure) => void } | undefined, f: SurplusAttemptFailure): void {
  try { callbacks?.onAttemptFailed?.(f); } catch { /* an observation never holds the inference queue */ }
}

export const SURPLUS_PARALLEL_CALLS_DEFAULT = 128;
export const SURPLUS_PARALLEL_CALLS_MAX = 1024;
/** How many model calls of ONE build may be in flight at once. `1` = the old strict one-at-a-time order. */
export function surplusParallelCallsPerBuild(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SURPLUS_PARALLEL_CALLS_PER_BUILD?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? Math.min(n, SURPLUS_PARALLEL_CALLS_MAX) : SURPLUS_PARALLEL_CALLS_DEFAULT;
}

/** A counting semaphore: at most `limit` holders, FIFO, Stop-aware. A waiter that is stopped leaves the line
 * without taking a slot; every release is idempotent so a double release can never admit an extra caller. */
export function createSurplusSlots(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    while (active < limit && waiting.length) { active++; waiting.shift()!(); }
  };
  const releaser = () => { let done = false; return () => { if (done) return; done = true; active--; next(); }; };
  return {
    get active() { return active; },
    get waiting() { return waiting.length; },
    async acquire(signal?: AbortSignal): Promise<() => void> {
      throwIfStopped(signal);
      if (active < limit && waiting.length === 0) { active++; return releaser(); }
      let admit!: () => void;
      const admitted = new Promise<void>(resolve => { admit = resolve; });
      let granted = false;
      const entry = () => { granted = true; admit(); };
      waiting.push(entry);
      try { await raceStop(admitted, signal); throwIfStopped(signal); }
      catch (error) {
        const at = waiting.indexOf(entry);
        if (at >= 0) waiting.splice(at, 1);
        else if (granted) { active--; next(); }
        throw error;
      }
      return releaser();
    },
  };
}

/** Owner 2026-10-31: one Surplus run finishes the whole build. Env-tunable, safe defaults. */
export function surplusStayAlivePolicy(env: NodeJS.ProcessEnv = process.env) {
  const num = (v: string | undefined, d: number, lo: number, hi: number) => {
    const n = Number(v); return Number.isFinite(n) && v?.trim() ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
  };
  // Unit suites pin single-turn failure semantics; they opt in via SURPLUS_TURN_RETRIES explicitly.
  const off = /^(0|off|false|no)$/i.test(env.SURPLUS_STAY_ALIVE?.trim() ?? '') ||
    (Boolean(env.VITEST) && !env.SURPLUS_TURN_RETRIES?.trim());
  return Object.freeze({
    retries: off ? 0 : num(env.SURPLUS_TURN_RETRIES, 5, 0, 10),
    turnMs: num(env.SURPLUS_TURN_TIMEOUT_MS, env.VITEST && !env.SURPLUS_TURN_RETRIES?.trim() ? 120_000 : 240_000, 30_000, 600_000),
    minTurnMs: 20_000,
    backoffMs: [2_000, 5_000, 10_000, 20_000, 30_000],
  });
}

/** Transient Surplus deaths only. Stop / maintenance / policy / build budget are terminal. */
export function isSurplusTurnRetryable(error: unknown): boolean {
  try {
    if (!error || typeof error !== 'object') return false;
    if (error instanceof BuildStoppedError || error instanceof AiMaintenanceError) return false;
    const msg = String((error as Error).message ?? '');
    if (msg === BUDGET_REACHED_MESSAGE || msg === BUDGET_EXHAUSTED_MESSAGE) return false;
    if (error instanceof PublicBuildEngineError) return publicBuildEngineSafeReason(error) !== 'policy_refusal';
    return error instanceof SurplusBuildUnavailableError;
  } catch { return false; }
}
