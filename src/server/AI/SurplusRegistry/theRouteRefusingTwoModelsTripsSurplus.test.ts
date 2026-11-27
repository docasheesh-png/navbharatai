/**
 * Q-3464 (failedbr #2525; admin decision 2026-11-27, option A). Six Surplus models — qwen3-coder, deepseek-v4.1-flash,
 * deepseek-v4.1-flash-1017, glm-5.3, glm-5.3-flash, glm-5.2 — each answered HTTP 404 at response_validation and were
 * benched one by one: 87 s with no work. One 404 can be a retired model id; the SAME 404 from a SECOND, different model is
 * the route, so Surplus is tripped for THIS build at the second model and the turn falls open to the Weak chain. The trip
 * is per build only ("Surplus marna nahi chahiye"): the next build session tries Surplus afresh.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { readFileSync } from 'node:fs';
import { evaluateSurplusReceipt } from './receiptPolicy';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import {
  createSurplusBuildSession, describeSurplusAttemptFailure, describeSurplusRouteTrip, isSurplusRouteRefusal,
  type SurplusAttemptFailure, type SurplusReviewedAdapter, type SurplusReviewedState,
} from './buildSession';
import { wrapSurplusRunnerPreWriteFailOpen } from './surplusPreWriteFailOpen';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import { publicBuildEngineError } from '../../lib/buildEngineError';

const now = 1800000000000;
/** #2525's six models, in the order the build asked them. */
const BR2525 = ['qwen3-coder', 'deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017', 'glm-5.3', 'glm-5.3-flash', 'glm-5.2'];
const ENDPOINT = 'https://api.surplusintelligence.ai/min90/v1';

function state(models: string[], providerId: string): SurplusReviewedState {
  const offer = (model: string) => ({ model, offerId: `offer-${model}`, providerId, available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
    discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified' as const, observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: `https://www.surplusintelligence.ai/api/markets/${model}` });
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: [...models], offers: models.map(offer) },
    reviews: { quality: models.map(model => ({ binding: 'model-provider' as const, model, providerId, benchmarkId: 'bench', cohort: 'coding', approved: true as const, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 })),
      pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: models.map(model => ({ reviewId: `capability-${model}`, model, modelVersion: 'reviewed-v1', providerId, reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true as const, parallelTools: true as const, transcriptRoundTrip: true as const, providerPinVerified: true as const, returnedIdentityVerified: true as const, reportedChargeContractVerified: true as const, endpoint: ENDPOINT as typeof ENDPOINT })),
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: ENDPOINT, reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  } as SurplusReviewedState;
}
const params = { model: 'ignored-legacy-model', system: 'build', messages: [{ role: 'user' as const, content: 'Make an FPS shooter' }], tools: [], maxTokens: 100 };
function receipt(permit: SurplusTurnPermit) {
  const binding = { buildId: permit.buildId, callId: permit.callId, accountId: 'account', modelId: permit.model, modelVersion: 'reviewed-v1', providerId: permit.providerId, endpoint: permit.endpoint, offerId: null, startedAt: now - 1 };
  return evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'server-dispatch-id', receiptId: permit.callId, requestId: permit.callId, currency: 'USD', buyerCostMicro: '1', costSource: 'usage.buyer_cost_micro', responseComplete: true, receivedAt: now, evidenceSha256: 'b'.repeat(64), additionalCharges: 'none', usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'mapping', tokens: { input: '10', output: '2', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing', artifactSha256: 'c'.repeat(64), reviewId: 'tariff-review', reviewedAt: now - 2, reviewExpiresAt: now + 300000, effectiveFrom: now - 10, effectiveUntil: null, observedAt: now - 3, surplusModelId: permit.model, surplusModelVersion: 'reviewed-v1', officialModelId: permit.model, officialModelVersion: 'v1', modelMappingReviewId: 'model-mapping', usageMappingReviewId: 'mapping', currency: 'USD', billingBasis: 'tokens-only', usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: 'not-supported', reasoning: '2' } },
  });
}

/**
 * A Surplus engine whose answer per call is chosen by `answer(model, callIndex)`: a refusal envelope `{ status, body? }`
 * or 'ok'. The adapter's failure hook allows the in-turn retry on another model, as production's does.
 */
function engine(answer: (model: string, call: number) => { status: number; body?: unknown } | 'ok', providerId = 'provider-a') {
  const asked: string[] = [];
  const adapter: SurplusReviewedAdapter = {
    readState: vi.fn(async () => state(BR2525, providerId)),
    routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }),
    dispatch: vi.fn(async (req: Record<string, unknown>) => {
      const model = String(req.model);
      const a = answer(model, asked.push(model) - 1);
      return a === 'ok' ? { model, choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } } : a;
    }),
    identify: (raw: any, expected?: string) => {
      if (typeof raw?.status === 'number') throw new Error(`Surplus response route or capabilities did not match (http_${raw.status})`);
      return { model: String(expected), providerId, completion: raw };
    },
    receipt: vi.fn(async (_raw, permit) => receipt(permit)),
    failure: vi.fn(async () => ({ canRetry: true })),
  };
  const make = (buildId = 'build-2525') => createSurplusBuildSession({ buildId, tier: 'weak', enabled: true, adapter, now: () => now });
  return { asked, adapter, make };
}

async function withRetries<T>(n: string, fn: () => Promise<T>): Promise<T> {
  process.env.SURPLUS_TURN_RETRIES = n;
  try { return await fn(); } finally { delete process.env.SURPLUS_TURN_RETRIES; }
}

describe('Q-3464: the same HTTP 404 at response_validation from a SECOND distinct model trips Surplus for this build', () => {
  it('#2525 exact sequence — every model answers 404 — stops after the SECOND model, not the sixth', async () => {
    await withRetries('1', async () => {
      const { asked, make } = engine(() => ({ status: 404 }));
      const session = (await make())!;
      const seen: SurplusAttemptFailure[] = [];
      const error = await session.runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any).then(() => null, e => e);
      expect(error).toBeInstanceOf(Error);                         // the turn fails at once, for the fail-open to catch
      expect(asked).toHaveLength(2);                               // two models asked, never a third
      expect(new Set(asked).size).toBe(2);
      expect(seen).toHaveLength(2);
      expect(seen[0].routeTripped).toBeUndefined();
      expect(seen[1].routeTripped).toEqual({ models: asked, httpStatus: 404, stage: 'response_validation' });
      expect(seen[1].nextModel).toBeUndefined();                   // no "the next turn moves to …" that will never happen
      const line = describeSurplusAttemptFailure(seen[1]);
      expect(line).toContain(`Surplus skipped for the rest of THIS build: 2 different models (${asked.join(', ')}) each answered HTTP 404 at response_validation`);
      // A later turn of the same build does not ask Surplus again (no third model, no new 87 s).
      await session.runner().runTurn(params as any).catch(() => undefined);
      expect(asked).toHaveLength(2);
    });
  }, 20000);

  it('per build only — a new build session asks Surplus again', async () => {
    await withRetries('1', async () => {
      const { asked, make } = engine(() => ({ status: 404 }));
      await (await make('build-1'))!.runner().runTurn(params as any).catch(() => undefined);
      expect(asked).toHaveLength(2);
      await (await make('build-2'))!.runner().runTurn(params as any).catch(() => undefined);
      expect(asked).toHaveLength(4);
    });
  }, 20000);

  it('the FIRST single 404 still only benches that model; the next model answers and nothing trips', async () => {
    await withRetries('1', async () => {
      const { asked, make } = engine((_m, call) => call === 0 ? { status: 404 } : 'ok');
      const seen: SurplusAttemptFailure[] = [];
      const r = await (await make())!.runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
      expect(r.text).toBe('done');
      expect(asked).toHaveLength(2);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ model: asked[0], httpStatus: 404, benched: true });
      expect(seen[0].routeTripped).toBeUndefined();
      expect(describeSurplusAttemptFailure(seen[0])).not.toContain('Surplus skipped');
    });
  }, 20000);

  it('a different error class does not trip: two models answering 403, or 500, keep walking to a third', async () => {
    for (const status of [403, 500]) {
      await withRetries('1', async () => {
        const { asked, make } = engine((_m, call) => call < 2 ? { status } : 'ok');
        const seen: SurplusAttemptFailure[] = [];
        const r = await (await make())!.runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
        expect(r.text, String(status)).toBe('done');
        expect(asked.length, String(status)).toBe(3);
        expect(seen.some(f => f.routeTripped), String(status)).toBe(false);
      });
    }
  }, 20000);

  it('a 404 that is a MARKET refusal (one model+seller pair) does not count toward the trip', async () => {
    await withRetries('1', async () => {
      const { asked, make } = engine((_m, call) => call < 2 ? { status: 404, body: { error: { code: 'no_sellers_for_model' } } } : 'ok', 'provider-market');
      const seen: SurplusAttemptFailure[] = [];
      const r = await (await make())!.runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
      expect(r.text).toBe('done');
      expect(asked).toHaveLength(3);
      expect(seen.some(f => f.routeTripped)).toBe(false);
    });
  }, 20000);

  it('the tripped turn falls open to the Weak chain at once, and that build never calls Surplus again', async () => {
    await withRetries('1', async () => {
      const { asked, make } = engine(() => ({ status: 404 }));
      const surplus = (await make())!.runner();
      const weakTurns: string[] = [];
      const weak = { plannedModel: 'weak-engine', async runTurn() { weakTurns.push('weak'); return { text: 'weak done', toolUses: [], rawContent: [], stopReason: 'end_turn', model: 'weak-engine', usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }; } } as unknown as TurnRunner;
      const reasons: string[] = [];
      const wrapped = wrapSurplusRunnerPreWriteFailOpen(surplus as unknown as TurnRunner, () => weak, { state: { dropped: false }, userFilesWritten: () => 0, onFailOpen: r => reasons.push(r) });
      expect((await wrapped.runTurn(params as any)).text).toBe('weak done');
      expect((await wrapped.runTurn(params as any)).text).toBe('weak done');
      expect(asked).toHaveLength(2);
      expect(weakTurns).toHaveLength(2);
      expect(reasons).toHaveLength(1);
    });
  }, 20000);
});

describe('Q-3464 sibling: a parallel turn that fails after another turn dropped Surplus continues on the Weak chain', () => {
  it('the second failing turn does not throw out of the build; the fail-open is reported once', async () => {
    let releaseB!: () => void;
    const bMayFail = new Promise<void>(resolve => { releaseB = resolve; });
    let calls = 0;
    const surplus = { plannedModel: 'surplus', async runTurn() {
      const mine = calls++;
      if (mine === 1) await bMayFail;                              // turn B is still in flight when turn A drops Surplus
      throw publicBuildEngineError('terminal_fold');
    } } as unknown as TurnRunner;
    const weak = { plannedModel: 'weak-engine', async runTurn() { return { text: 'weak done', toolUses: [], rawContent: [], stopReason: 'end_turn', model: 'weak-engine', usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }; } } as unknown as TurnRunner;
    const reasons: string[] = [];
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(surplus, () => weak, { state: { dropped: false }, userFilesWritten: () => 0, onFailOpen: r => reasons.push(r) });
    const a = wrapped.runTurn(params as any);
    const b = wrapped.runTurn(params as any);
    expect((await a).text).toBe('weak done');
    releaseB();
    expect((await b).text).toBe('weak done');
    expect(reasons).toHaveLength(1);
  });

  it('a policy refusal on that parallel turn is still terminal', async () => {
    const state = { dropped: false };
    // A sibling turn drops Surplus while this one is in flight; this one then fails with a policy refusal.
    const surplus = { plannedModel: 'surplus', async runTurn() { state.dropped = true; throw publicBuildEngineError('policy_refusal'); } } as unknown as TurnRunner;
    let weakRan = false;
    const weak = { plannedModel: 'weak-engine', async runTurn() { weakRan = true; return { text: 'weak' } as any; } } as unknown as TurnRunner;
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(surplus, () => weak, { state, userFilesWritten: () => 0 });
    await expect(wrapped.runTurn(params as any)).rejects.toThrow();
    expect(weakRan).toBe(false);
  });
});

describe('Q-3464: what counts, and what the report says', () => {
  it('only HTTP 404 at response_validation without a market code', () => {
    expect(isSurplusRouteRefusal({ stage: 'response_validation', httpStatus: 404 })).toBe(true);
    expect(isSurplusRouteRefusal({ stage: 'dispatch', httpStatus: 404 })).toBe(false);
    expect(isSurplusRouteRefusal({ stage: 'response_validation', httpStatus: 403 })).toBe(false);
    expect(isSurplusRouteRefusal({ stage: 'response_validation', httpStatus: 429 })).toBe(false);
    expect(isSurplusRouteRefusal({ stage: 'response_validation' })).toBe(false);
    expect(isSurplusRouteRefusal({ stage: 'response_validation', httpStatus: 404, engineCode: 'minimum_discount_not_met' })).toBe(false);
    expect(isSurplusRouteRefusal(undefined)).toBe(false);
  });

  it('one admin-report line names the models and the count', () => {
    expect(describeSurplusRouteTrip({ models: ['qwen3-coder', 'deepseek-v4.1-flash'], httpStatus: 404, stage: 'response_validation' }))
      .toBe('Surplus skipped for the rest of THIS build: 2 different models (qwen3-coder, deepseek-v4.1-flash) each answered HTTP 404 at response_validation — the refusal is the route\'s, not one model\'s, so no further Surplus model is tried in this build (the next build tries Surplus again)');
  });

  it('the trip lives on the build session, never in module state or a store (per build only)', () => {
    const src = readFileSync('src/server/AI/SurplusRegistry/buildSession.ts', 'utf8');
    const sessionStart = src.indexOf('export async function createSurplusBuildSession');
    for (const name of ['const routeRefusalModels', 'let routeTrip']) {
      const at = src.indexOf(name);
      expect(at, name).toBeGreaterThan(sessionStart);            // declared inside the per-build factory
    }
    expect(src).not.toMatch(/recordSurplusRouteTrip|persistRouteTrip/);
  });
});
