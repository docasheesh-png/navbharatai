import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { evaluateSurplusReceipt } from './receiptPolicy';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import { createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';
import { AgentRunner } from '../../AgentV3/AgentRunner';
import { ToolDispatcher, type ActuatorPort } from '../../AgentV3/ToolDispatcher';
import { WorkspaceState } from '../../AgentV3/WorkspaceState';
import { AgentEventStream } from '../../AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../../AgentV3/ToolCatalog';
import { judgeBuild, judgeActuallyRan } from '../../AgentV3/BuildJudge';
import { createProviderUsageLedger } from '../../AgentV3/ProviderUsageLedger';
import { isBuildReviewProviderEligible } from '../../AgentV3/surplusReviewEligibility';
import { abortBuild } from '../../AgentV3/buildAbortCause';
import { settleStopOrFailure } from '../../AgentV3/cancelledBuildBilling';
import { decideBuildBilledUsd } from '../../routes/agentv3';
import type { OpenAiCompletionLike } from '../../AgentV3/providers/OpenAiToolAdapter';
import type { AgentEvent } from '../../AgentV3/types';
const now = 1800000000000;
function state(): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [{ model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
      discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified', observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://www.surplusintelligence.ai/api/markets/model-a' }] },
    reviews: { quality: [{ binding: 'model-provider', model: 'model-a', providerId: 'provider-a', benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 }], pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: [{ reviewId: 'capability', model: 'model-a', modelVersion: 'reviewed-v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' }],
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  };
}
function receipt(permit: SurplusTurnPermit, costMicro: string) {
  const binding = { buildId: permit.buildId, callId: permit.callId, accountId: 'account', modelId: permit.model, modelVersion: 'reviewed-v1', providerId: permit.providerId, endpoint: permit.endpoint, offerId: null, startedAt: now - 1 };
  return evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'server-dispatch-id', receiptId: permit.callId, requestId: permit.callId, currency: 'USD', buyerCostMicro: costMicro, costSource: 'usage.buyer_cost_micro', responseComplete: true, receivedAt: now, evidenceSha256: 'b'.repeat(64), additionalCharges: 'none', usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'mapping', tokens: { input: '10', output: '2', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing', artifactSha256: 'c'.repeat(64), reviewId: 'tariff-review', reviewedAt: now - 2, reviewExpiresAt: now + 300000, effectiveFrom: now - 10, effectiveUntil: null, observedAt: now - 3, surplusModelId: permit.model, surplusModelVersion: 'reviewed-v1', officialModelId: 'model-a', officialModelVersion: 'v1', modelMappingReviewId: 'model-mapping', usageMappingReviewId: 'mapping', currency: 'USD', billingBasis: 'tokens-only', usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: 'not-supported', reasoning: '2' } },
  });
}

// Only the external provider and sandbox are simulated. Session authorization, native tool
// dispatch, transcript conversion, receipt policy, judge parsing and route settlement are real.
class MemoryActuator implements ActuatorPort {
  readonly files = new Map<string, string>();
  async readFile(_workspace: string, path: string) {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  async writeFile(_workspace: string, path: string, content: string) { this.files.set(path, content); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const html = '<!doctype html><html><body><h1>Hello Bharat</h1></body></html>';
function completion(content: string, tool = false): OpenAiCompletionLike {
  return { model: 'model-a', choices: [{ message: { role: 'assistant', content,
    ...(tool ? { tool_calls: [{ id: 'write-hello', type: 'function', function: {
      name: 'write_file', arguments: JSON.stringify({ path: 'index.html', content: html }),
    } }] } : {}),
  }, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
}
async function setup(costMicro = '1', signal?: AbortSignal, maxSteps = 4) {
  const requests: Record<string, unknown>[] = [];
  const permits: SurplusTurnPermit[] = [];
  const script = [completion('Creating the page.', true), completion('The hello page is complete.'),
    completion(JSON.stringify({ verdict: 'pass', findings: [], score: 97 }))];
  const adapter: SurplusReviewedAdapter = {
    readState: vi.fn(async () => state()),
    routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }),
    dispatch: vi.fn(async (request, _signal, permit) => {
      requests.push(structuredClone(request)); permits.push(permit);
      const response = script.shift();
      if (!response) throw new Error('Unexpected extra provider request');
      return response;
    }),
    identify: raw => ({ model: 'model-a', providerId: 'provider-a', completion: raw as OpenAiCompletionLike }),
    receipt: vi.fn(async (_raw, permit) => receipt(permit, costMicro)),
  };
  const session = await createSurplusBuildSession({ buildId: 'hello-build', tier: 'weak', enabled: true, adapter, now: () => now });
  if (!session) throw new Error('Expected an enabled reviewed session');
  const ledger = createProviderUsageLedger();
  let phase = 'build';
  const client = session.runner({ onTurnComplete: (turn, provider) => {
    ledger.add(provider, turn.usage, turn.model, { phase });
  } });
  const actuator = new MemoryActuator();
  const stream = new AgentEventStream();
  const events: AgentEvent[] = [];
  stream.subscribe(event => events.push(event), false);
  const workspace = new WorkspaceState(stream);
  const runner = new AgentRunner({ client, dispatcher: new ToolDispatcher(actuator, 'hello-workspace', workspace, stream),
    state: workspace, events: stream, model: session.model, system: 'Build the requested page.',
    tools: defaultToolCatalog(), maxSteps, maxTokensPerTurn: 8192, signal });
  return { runner, actuator, workspace, events, requests, permits, adapter, ledger,
    judge: async () => {
      const provider = ledger.entries().at(-1)?.provider;
      if (!isBuildReviewProviderEligible(provider, !!session)) throw new Error('Build is not eligible for review');
      phase = 'review';
      return judgeBuild('Build a page saying Hello Bharat', [...actuator.files].map(([path, content]) => ({ path, content })),
        args => client.runTurn(args), session.model);
    },
    bill: (vm = 0) => decideBuildBilledUsd(ledger, ledger.total(), 'off', null, null, vm, new Set<string>()),
  };
}
afterEach(() => vi.unstubAllEnvs());

describe('reviewed Surplus native builder loop through judged completion', () => {
  it.each([['1', 0.00003], ['2', 0.000042]] as const)('writes, round-trips, judges and settles %s micro per call', async (micro, expectedBill) => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'on');
    vi.stubEnv('UNIFIED_WALLET_MARGIN_BUILD', '2.5');
    const h = await setup(micro);
    const result = await h.runner.run('Build a page saying Hello Bharat');
    expect(result).toMatchObject({ ok: true, steps: 2 });
    expect(h.actuator.files.get('index.html')).toBe(html);
    expect(h.workspace.snapshot().files).toEqual([{ path: 'index.html', kind: 'create' }]);
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: true }));
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'done', ok: true }));
    expect(h.requests[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'write-hello' })] }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'write-hello', content: expect.any(String) }),
    ]));
    const verdict = await h.judge();
    expect(verdict).toEqual({ pass: true, findings: [], score: 97 });
    expect(judgeActuallyRan(verdict)).toBe(true);
    expect(JSON.stringify(h.requests[2].messages)).toContain(html);
    expect(h.adapter.dispatch).toHaveBeenCalledTimes(3);
    expect(h.permits.every(permit => permit.buildId === 'hello-build' && permit.model === 'model-a'
      && permit.providerId === 'provider-a')).toBe(true);
    expect(new Set(h.permits.map(permit => permit.callId)).size).toBe(3);
    expect(h.ledger.entries()).toHaveLength(3);
    expect(h.ledger.entries().every(entry => entry.provider === 'SURPLUS' && entry.surplusReceipt?.status === 'chargeable')).toBe(true);
    expect(h.bill()).toMatchObject({ effectiveBilledUsd: expectedBill, realCostUsd: Number(micro) * 3 / 1e6 });
    // The independent VM line keeps its existing margin, never multiplies the capped Surplus bill.
    const vmOnly = createProviderUsageLedger();
    const vmBill = decideBuildBilledUsd(vmOnly, vmOnly.total(), 'off', null, null, 0.2, new Set<string>());
    expect(h.bill(0.2).effectiveBilledUsd).toBeCloseTo(vmBill.effectiveBilledUsd + expectedBill, 10);
  });

  it('stops before dispatch when cancelled and cannot fabricate files or a charge', async () => {
    const abort = new AbortController(); abortBuild(abort, 'user-stop');
    const h = await setup('1', abort.signal);
    const result = await h.runner.run('Build a page saying Hello Bharat');
    expect(result.ok).toBe(false);
    expect(h.adapter.dispatch).not.toHaveBeenCalled();
    expect(h.actuator.files.size).toBe(0);
    expect(h.ledger.entries()).toHaveLength(0);
    expect(h.bill().effectiveBilledUsd).toBe(0);
  });

  it('retains real receipt cost on an incomplete loop but the failed-build guard makes it free', async () => {
    const h = await setup('1', undefined, 1);
    const result = await h.runner.run('Build a page saying Hello Bharat');
    expect(result.ok).toBe(false);
    expect(h.actuator.files.get('index.html')).toBe(html);
    expect(h.ledger.entries()).toHaveLength(1);
    const bill = h.bill();
    expect(bill.realCostUsd).toBe(0.000001);
    expect(bill.effectiveBilledUsd).toBe(0.00001);
    expect(settleStopOrFailure({ failed: !result.ok, facts: { abortCause: null, filesWritten: h.actuator.files.size,
      appRendered: false, decidedBilledUsd: bill.effectiveBilledUsd },
      switches: { billCancelled: false, lateStopRules: false } })).toEqual({ kind: 'failed-free', cancelBill: null });
  });
});
