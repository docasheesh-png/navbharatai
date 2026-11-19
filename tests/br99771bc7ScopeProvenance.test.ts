import { afterEach, describe, expect, it, vi } from 'vitest';
import { admitWeakBuild, WEAK_SCOPE_TIMEOUT_MS, type WeakAdmission } from '../src/server/AgentV3/weakBuildAdmission';
import { resolveWeakComplexity, weakForceContinueDecision } from '../src/server/AgentV3/weakBuildPreflight';
import { createSurplusScopeAsk, SURPLUS_SCOPE_TIMEOUT_MS } from '../src/server/AI/SurplusRegistry/scopeAdmission';
import type { SurplusBuildSession } from '../src/server/AI/SurplusRegistry/buildSession';
import type { RunTurnParams, TurnResult } from '../src/server/AgentV3/ClaudeClient';
import type { LlmCallRecord } from '../src/server/AgentV3/BuildDiagnostics';
import { readScopeFailure } from '../src/server/AgentV3/scopeFailureDiagnostic';
import { makeSurplusTurnRunner, type SurplusTurnPermit } from '../src/server/AgentV3/providers/SurplusTurnRunner';
import type { OpenAiCompletionLike } from '../src/server/AgentV3/providers/OpenAiToolAdapter';

vi.mock('../src/server/lib/aiMaintenance', () => ({
  assertAiAvailable: vi.fn(async () => {}),
  AiMaintenanceError: class extends Error {},
  aiMaintenanceStore: { onChange: () => () => {} },
}));

afterEach(() => vi.useRealTimers());

describe('99771bc7: failed scope admission is never reported as a successful classification', () => {
  it.each<WeakAdmission>([
    { scope: null, source: 'unavailable', failure: { stage: 'deadline', reason: 'scope_timeout' } },
    { scope: null, source: 'unavailable', failure: { stage: 'receipt', reason: 'receipt_failed' } },
    { scope: 'strong', source: 'model', usage: { inputTokens: 20, outputTokens: 1 } },
  ])('keeps the existing complex continuation with honest provenance for $scope / $source', async admission => {
    const before = structuredClone(admission);
    const continuation = weakForceContinueDecision(true, 'weak', admission);
    expect(continuation.blocked).toBe(false);
    expect(continuation.admissionForBuild).toEqual({ ...admission, scope: 'complex', source: 'user-override' });
    const fallback = vi.fn(async () => ({ verdict: 'simple' as const }));
    const decision = await resolveWeakComplexity(continuation.admissionForBuild, 15, fallback);
    expect(decision).toMatchObject({ verdict: 'complex', score: 15, source: 'user-override' });
    expect('reason' in decision && decision.reason).toContain('not a successful classification');
    expect(fallback).not.toHaveBeenCalled();
    expect(admission).toEqual(before);
  });

  it('keeps successful and unforced admissions unchanged', async () => {
    const accepted: WeakAdmission = { scope: 'complex', source: 'model' };
    const denied: WeakAdmission = { scope: null, source: 'unavailable' };
    expect(weakForceContinueDecision(true, 'weak', accepted).admissionForBuild).toBe(accepted);
    expect(weakForceContinueDecision(false, 'weak', denied)).toEqual({ blocked: true, admissionForBuild: denied });
    expect(weakForceContinueDecision(true, 'normal', denied)).toEqual({ blocked: true, admissionForBuild: denied });
    const decision = await resolveWeakComplexity(accepted, 15, vi.fn());
    expect(decision).toMatchObject({ verdict: 'complex', source: 'model', reason: 'one bounded preflight classified the requested implementation scope' });
  });

  it.each([WEAK_SCOPE_TIMEOUT_MS, SURPLUS_SCOPE_TIMEOUT_MS])('carries the actual %i ms deadline through a transport that throws its own generic abort', async timeoutMs => {
    vi.useFakeTimers();
    const turns: TurnResult[] = [];
    const records: Omit<LlmCallRecord, 'ts'>[] = [];
    const runTurn = vi.fn((params: RunTurnParams) => new Promise<TurnResult>((_resolve, reject) => {
      params.signal?.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT_ABORT')), { once: true });
    }));
    const session = { model: 'synthetic-model', runner: () => ({ runTurn }) } as unknown as SurplusBuildSession;
    const ask = createSurplusScopeAsk(session, turns, records)!;
    const pending = admitWeakBuild('A bounded property-trading board game', ask, { timeoutMs });
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(records).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ scope: null, source: 'unavailable', failure: { stage: 'deadline', reason: 'scope_timeout' } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ok: false, latencyMs: timeoutMs,
      error: 'Build scope classification failed (stage=deadline reason=scope_timeout)' });
    expect(JSON.stringify(records)).not.toContain('PRIVATE_');
    expect(turns).toHaveLength(0);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not infer a deadline from untrusted error properties', async () => {
    const controller = new AbortController();
    const forged = Object.assign(new Error('PRIVATE_ERROR'), { stage: 'deadline', reason: 'scope_timeout' });
    controller.abort(forged);
    const records: Omit<LlmCallRecord, 'ts'>[] = [];
    const session = { model: 'synthetic-model', runner: () => ({ runTurn: async () => { throw forged; } }) } as unknown as SurplusBuildSession;
    await expect(createSurplusScopeAsk(session, [], records)!('PRIVATE_SYSTEM', 'PRIVATE_USER', controller.signal)).rejects.toBe(forged);
    expect(readScopeFailure(forged)).toBeUndefined();
    expect(records[0].error).toBe('Build scope classification failed');
    expect(JSON.stringify(records)).not.toContain('PRIVATE_');
  });

  it('retains deadline ownership through the real native runner stop folding', async () => {
    vi.useFakeTimers();
    const permit: SurplusTurnPermit = {
      buildId: 'synthetic-build', callId: 'synthetic-call', model: 'synthetic-model', providerId: 'synthetic-provider', offerId: 'synthetic-offer',
      endpoint: 'https://api.surplusintelligence.ai/min90/v1', priceGeneration: 'synthetic-generation', policyVersion: 'synthetic-policy', maxTokens: 1024,
      requestRouting: { provider: 'synthetic-provider', si_route: { objective: 'price' } },
      validateResponse: raw => raw as OpenAiCompletionLike,
    };
    const dispatch = vi.fn((_request, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT_ABORT')), { once: true });
    }));
    const native = makeSurplusTurnRunner({ authorize: async () => permit, dispatch, timeoutMs: 120_000 });
    const session = { model: permit.model, runner: () => native } as unknown as SurplusBuildSession;
    const records: Omit<LlmCallRecord, 'ts'>[] = [];
    const pending = admitWeakBuild('A bounded property-trading board game', createSurplusScopeAsk(session, [], records)!, { timeoutMs: SURPLUS_SCOPE_TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(SURPLUS_SCOPE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ scope: null, failure: { stage: 'deadline', reason: 'scope_timeout' } });
    expect(records).toHaveLength(1);
    expect(records[0].error).toBe('Build scope classification failed (stage=deadline reason=scope_timeout)');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
