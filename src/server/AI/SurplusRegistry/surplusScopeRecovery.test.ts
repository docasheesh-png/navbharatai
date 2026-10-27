import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import type { RunTurnParams, TurnResult, TurnRunner } from '../../AgentV3/ClaudeClient';
import { BuildStoppedError } from '../../AgentV3/stopSignal';
import { BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE } from '../../AgentV3/turnDeadline';
import { admitWeakBuild } from '../../AgentV3/weakBuildAdmission';
import { weakForceContinueDecision } from '../../AgentV3/weakBuildPreflight';
import { makeSurplusTurnRunner, type SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import type { OpenAiCompletionLike } from '../../AgentV3/providers/OpenAiToolAdapter';
import { AiMaintenanceError } from '../../lib/aiMaintenance';
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE, publicBuildEngineError, publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import { createSurplusBuildSession, type SurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';
import { createSurplusScopeAsk } from './scopeAdmission';
import { tryConsumeSurplusPreWriteFailOpen, wrapSurplusRunnerPreWriteFailOpen, type SurplusPreWriteFailOpenHooks } from './surplusPreWriteFailOpen';

const circuit = vi.hoisted(() => ({ death: vi.fn(), success: vi.fn() }));
vi.mock('./surplusAdmitCircuit', () => ({ recordSurplusMidBuildDeath: circuit.death, recordSurplusAdmitProbeSuccess: circuit.success }));
vi.mock('../../lib/aiMaintenance', () => ({
  assertAiAvailable: vi.fn(async () => {}),
  AiMaintenanceError: class extends Error { constructor() { super('maintenance'); } },
  aiMaintenanceStore: { onChange: () => () => {} },
}));
vi.mock('../../AgentV3/weakBuildAdmissionAsk', () => ({ weakBuildAdmissionAsk: vi.fn() }));

const params = (signal?: AbortSignal): RunTurnParams => ({ model: 'synthetic-model', messages: [], tools: [], maxTokens: 32, signal });
const answer = (text = 'Useful synthetic build response'): TurnResult => ({
  text, rawContent: [], toolUses: [], stopReason: 'end_turn', model: 'synthetic-weak-model', usage: { inputTokens: 2, outputTokens: 3 },
});
function harness(runTurn: TurnRunner['runTurn'], userFilesWritten: () => number = () => 0) {
  const runner = vi.fn(() => ({ runTurn }));
  const session = { model: 'synthetic-model', runner } as unknown as SurplusBuildSession;
  const turns: TurnResult[] = [], records: Omit<LlmCallRecord, 'ts'>[] = [];
  const observe = vi.fn(), onFailure = vi.fn(), onFailOpen = vi.fn();
  const hooks: SurplusPreWriteFailOpenHooks = { state: { dropped: false }, userFilesWritten, onFailOpen };
  return { session, runner, turns, records, observe, onFailure, onFailOpen, hooks };
}

beforeEach(() => vi.clearAllMocks());

describe('scope failure recovery before builder creation', () => {
  it('carries the real scope failure into one pre-write recovery and returns a useful Weak turn', async () => {
    const failure = new PublicBuildEngineError();
    const surplusRun = vi.fn(async () => { throw failure; });
    const h = harness(surplusRun);
    const ask = createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!;
    await expect(ask('SYNTHETIC_PRIVATE_SYSTEM', 'SYNTHETIC_PRIVATE_REQUEST')).rejects.toBe(failure);
    expect(h.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(h.records).toMatchObject([{ ok: false, responseChars: 0, error: 'Build scope classification failed' }]);
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, h.onFailure.mock.calls[0][0])).toBe('mid_build_engine_unavailable');
    const weakRun = vi.fn(async () => answer());
    const wrapped = wrapSurplusRunnerPreWriteFailOpen({ runTurn: surplusRun }, () => ({ runTurn: weakRun }), h.hooks);
    await expect(wrapped.runTurn(params())).resolves.toMatchObject({ text: 'Useful synthetic build response' });
    await expect(wrapped.runTurn(params())).resolves.toMatchObject({ text: 'Useful synthetic build response' });
    expect(surplusRun).toHaveBeenCalledOnce();
    expect(weakRun).toHaveBeenCalledTimes(2);
    expect(h.onFailOpen).toHaveBeenCalledOnce();
    expect(circuit.death).toHaveBeenCalledOnce();
    expect(JSON.stringify([h.records, h.turns, h.observe.mock.calls])).not.toContain('SYNTHETIC_PRIVATE');
  });

  it('retains an internal error for classification without publishing its contents', async () => {
    const failure = new Error('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');
    const h = harness(async () => { throw failure; });
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!('system', 'request')).rejects.toBe(failure);
    expect(h.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, failure)).toBeNull();
    expect(JSON.stringify([h.records, h.turns, h.observe.mock.calls])).not.toContain('SYNTHETIC_PRIVATE');
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it('cannot replace the original failure when its observer throws', async () => {
    const failure = new PublicBuildEngineError(), h = harness(async () => { throw failure; });
    h.onFailure.mockImplementation(() => { throw new Error('synthetic observer failure'); });
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!('system', 'request')).rejects.toBe(failure);
    expect(h.records).toHaveLength(1);
  });

  it('captures a synchronous session-runner construction failure', async () => {
    const failure = new PublicBuildEngineError(), h = harness(async () => answer());
    h.runner.mockImplementation(() => { throw failure; });
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!('system', 'request')).rejects.toBe(failure);
    expect(h.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(h.records).toMatchObject([{ ok: false }]);
  });

  it('does not turn a successful answer containing public error wording into a failed call', async () => {
    const h = harness(async () => answer(PUBLIC_BUILD_ENGINE_UNAVAILABLE));
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!('system', 'request')).resolves.toEqual({ text: PUBLIC_BUILD_ENGINE_UNAVAILABLE });
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(h.records).toMatchObject([{ ok: true }]);
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, undefined)).toBeNull();
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it('does no Surplus work or recovery when no session was admitted', () => {
    const h = harness(async () => answer());
    expect(createSurplusScopeAsk(undefined, h.turns, h.records, h.observe, h.onFailure)).toBeUndefined();
    expect(h.runner).not.toHaveBeenCalled();
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(h.records).toEqual([]);
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it.each([
    ['stop', () => new BuildStoppedError()],
    ['maintenance', () => new AiMaintenanceError()],
    ['exhausted budget', () => new Error(BUDGET_EXHAUSTED_MESSAGE)],
    ['reached budget', () => new Error(BUDGET_REACHED_MESSAGE)],
    ['policy refusal', () => publicBuildEngineError('policy_refusal')],
  ] as const)('observes %s without consuming a recovery or recording an availability death', async (_label, makeFailure) => {
    const failure = makeFailure(), h = harness(async () => { throw failure; });
    await expect(createSurplusScopeAsk(h.session, h.turns, h.records, h.observe, h.onFailure)!('system', 'request')).rejects.toBe(failure);
    expect(h.onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, failure)).toBeNull();
    expect(h.hooks.state.dropped).toBe(false);
    expect(h.onFailOpen).not.toHaveBeenCalled();
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it.each([1, -1, NaN, Infinity])('requires proven zero authored files, not %s', files => {
    const h = harness(async () => answer(), () => files);
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, new PublicBuildEngineError())).toBeNull();
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it('does not assume zero authored files when the counter throws', () => {
    const h = harness(async () => answer(), () => { throw new Error('synthetic unavailable file evidence'); });
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, new PublicBuildEngineError())).toBeNull();
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it.each([
    PUBLIC_BUILD_ENGINE_UNAVAILABLE,
    `Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`,
    new Error(`Quoted text: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`),
    { code: 'DISCOUNT_BUILD_UNAVAILABLE' },
  ])('does not authorize recovery from a summary or duck-typed value', failure => {
    const h = harness(async () => answer());
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, failure)).toBeNull();
    expect(circuit.death).not.toHaveBeenCalled();
  });

  it('does not begin Weak recovery after cancellation wins against a public failure', async () => {
    const abort = new AbortController(), failure = new PublicBuildEngineError();
    const h = harness(async () => { abort.abort(); throw failure; });
    const weak = vi.fn(async () => answer());
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(h.session.runner(), () => ({ runTurn: weak }), h.hooks);
    await expect(wrapped.runTurn(params(abort.signal))).rejects.toThrow();
    expect(weak).not.toHaveBeenCalled();
    expect(circuit.death).not.toHaveBeenCalled();
  });
});

describe('native refusal stays terminal across the public boundary and outer recovery wrapper', () => {
  it('does not downgrade a known refusal when receipt accounting outlives the native timeout', async () => {
    vi.useFakeTimers();
    try {
      const completion: OpenAiCompletionLike = { model: 'synthetic-model', choices: [{
        message: { role: 'assistant', content: null }, finish_reason: 'content_filter',
      }] };
      const permit: SurplusTurnPermit = {
        buildId: 'synthetic-build', callId: 'synthetic-call', model: 'synthetic-model', providerId: 'synthetic-provider', offerId: 'synthetic-offer',
        endpoint: 'https://api.surplusintelligence.ai/min90/v1', priceGeneration: 'synthetic-generation', policyVersion: 'synthetic-policy', maxTokens: 32,
        requestRouting: { provider: 'synthetic-provider', si_route: { objective: 'price' } }, validateResponse: raw => raw as OpenAiCompletionLike,
      };
      let markAccountingStarted!: () => void;
      const accountingStarted = new Promise<void>(resolve => { markAccountingStarted = resolve; });
      const failedAccounting = vi.fn(() => {
        markAccountingStarted();
        return new Promise<void>(() => {});
      });
      const dispatch = vi.fn(async () => completion);
      const native = makeSurplusTurnRunner({ authorize: async () => permit, dispatch, onFailure: failedAccounting, timeoutMs: 50 });
      const h = harness(native.runTurn), weak = vi.fn(async () => answer());
      const wrapped = wrapSurplusRunnerPreWriteFailOpen(native, () => ({ runTurn: weak }), h.hooks);
      let caught: unknown;
      const settled = wrapped.runTurn(params()).catch(error => { caught = error; });
      await accountingStarted;
      await vi.advanceTimersByTimeAsync(50);
      await settled;
      expect(publicBuildEngineSafeReason(caught)).toBe('policy_refusal');
      expect(dispatch).toHaveBeenCalledOnce();
      expect(failedAccounting).toHaveBeenCalledOnce();
      expect(weak).not.toHaveBeenCalled();
      expect(circuit.death).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['content_filter', 'explicit_refusal'] as const)('does not reroute %s to Weak', async refusal => {
    const completion: OpenAiCompletionLike = { model: 'synthetic-model', choices: [{
      message: { role: 'assistant', content: null, ...(refusal === 'explicit_refusal' ? { refusal: 'synthetic refusal' } : {}) },
      finish_reason: refusal === 'content_filter' ? 'content_filter' : 'stop',
    }] };
    const permit: SurplusTurnPermit = {
      buildId: 'synthetic-build', callId: 'synthetic-call', model: 'synthetic-model', providerId: 'synthetic-provider', offerId: 'synthetic-offer',
      endpoint: 'https://api.surplusintelligence.ai/min90/v1', priceGeneration: 'synthetic-generation', policyVersion: 'synthetic-policy', maxTokens: 32,
      requestRouting: { provider: 'synthetic-provider', si_route: { objective: 'price' } }, validateResponse: raw => raw as OpenAiCompletionLike,
    };
    const dispatch = vi.fn(async () => completion), failedAccounting = vi.fn(async () => undefined);
    const native = makeSurplusTurnRunner({ authorize: async () => permit, dispatch, onFailure: failedAccounting });
    const h = harness(native.runTurn), weak = vi.fn(async () => answer());
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(native, () => ({ runTurn: weak }), h.hooks);
    let caught: unknown;
    try { await wrapped.runTurn(params()); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PublicBuildEngineError);
    expect(publicBuildEngineSafeReason(caught)).toBe('policy_refusal');
    expect(dispatch).toHaveBeenCalledOnce();
    expect(failedAccounting).toHaveBeenCalledOnce();
    expect(weak).not.toHaveBeenCalled();
    expect(circuit.death).not.toHaveBeenCalled();
    expect(JSON.stringify(caught)).not.toContain('refusal');
    expect(Object.getOwnPropertyNames(caught)).not.toContain('reason');
  });

  it('retains a refused scope across real-session poisoning and an attempted forced continuation', async () => {
    const now = Date.now(), model = 'synthetic-model', provider = 'synthetic-provider';
    const state: SurplusReviewedState = {
      snapshot: { version: 'synthetic-generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: [model], offers: [{
        model, offerId: 'synthetic-offer', providerId: provider, available: true, healthy: true, trusted: true, providerTrustConfirmed: true,
        trustObservedAt: now, discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' },
        unit: 'unverified', observedAt: now, upstreamGeneratedAt: now, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30,
        sourceUrl: 'https://www.surplusintelligence.ai/api/markets/synthetic-model',
      }] },
      reviews: {
        quality: [{ binding: 'model-provider', model, providerId: provider, benchmarkId: 'synthetic-benchmark', cohort: 'coding', approved: true,
          artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 }],
        pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 },
        accountAndPrivacyReviewedUntil: now + 300000,
      },
      capabilities: [{ reviewId: 'synthetic-capability', model, modelVersion: 'synthetic-version', providerId: provider, reviewedAt: now - 1,
        expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true,
        providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' }],
      floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1',
        reviewId: 'synthetic-floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
    };
    const completion: OpenAiCompletionLike = { model, choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'content_filter' }] };
    const dispatch = vi.fn(async () => completion), accountFailure = vi.fn(async () => ({ canRetry: false }));
    const adapter: SurplusReviewedAdapter = {
      readState: async () => state,
      routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }),
      dispatch, identify: raw => ({ model, providerId: provider, completion: raw as OpenAiCompletionLike }),
      receipt: vi.fn(async () => undefined), failure: accountFailure,
    };
    const session = await createSurplusBuildSession({ buildId: 'synthetic-build', tier: 'weak', enabled: true, adapter, now: () => now });
    expect(session).toBeDefined();
    const h = harness(async () => answer());
    const admission = await admitWeakBuild('A synthetic small application', createSurplusScopeAsk(session, h.turns, h.records, h.observe, h.onFailure)!);
    expect(admission).toMatchObject({ scope: null, source: 'unavailable' });
    expect(weakForceContinueDecision(true, 'weak', admission).blocked).toBe(false);
    const initialFailure: unknown = h.onFailure.mock.calls[0]?.[0];
    expect(publicBuildEngineSafeReason(initialFailure)).toBe('policy_refusal');
    expect(tryConsumeSurplusPreWriteFailOpen(h.hooks, initialFailure)).toBeNull();
    const weak = vi.fn(async () => answer());
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(session!.runner(), () => ({ runTurn: weak }), h.hooks);
    let continuedFailure: unknown;
    try { await wrapped.runTurn(params()); } catch (error) { continuedFailure = error; }
    expect(publicBuildEngineSafeReason(continuedFailure)).toBe('policy_refusal');
    expect(dispatch).toHaveBeenCalledOnce();
    expect(accountFailure).toHaveBeenCalledOnce();
    expect(weak).not.toHaveBeenCalled();
    expect(circuit.death).not.toHaveBeenCalled();
  });
});

describe('route recovery placement', () => {
  it('consumes the captured early failure rather than replaying a failed builder result', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route.includes('earlySurplusFailure')).toBe(true);
    expect(route.includes('scrubRetry')).toBe(false);
    expect(route.includes('isPublicBuildEngineUnavailableText(result.summary)')).toBe(false);
    expect(route.includes('earlySurplusRecords.some((r) => r.ok === false)')).toBe(false);
  });
});
