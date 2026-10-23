import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProviderResponse } from '../Router/ProviderTypes';
import type { InferenceGatewayContext } from './context';

const m = vi.hoisted(() => ({
  selected: false, gateway: vi.fn(), legacy: vi.fn(), strict: vi.fn(), freeChain: vi.fn(),
  spend: vi.fn(), summary: vi.fn(),
}));
vi.mock('./runtime', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const contexts = new AsyncLocalStorage<InferenceGatewayContext>();
  return {
    // Routing-only fixture; private account authorization is exercised with real runtime in nested/private-memory tests.
    assertGatewayAccountAccess: () => {},
    runWithInferenceGatewayContext: <T>(context: InferenceGatewayContext, run: () => T): T => contexts.run(context, run),
    currentInferenceGatewayContext: () => contexts.getStore(),
    isGatewayRouteSelected: () => m.selected && !!contexts.getStore(),
    isGatewayTerminalError: (error: unknown) => error instanceof Error && error.name === 'GatewayTerminalError',
    maybeGatewayText: (input: unknown) => m.selected && contexts.getStore() ? m.gateway(input, contexts.getStore()) : Promise.resolve(null),
  };
});
vi.mock('../LiveRegistry/runtime', () => ({ strictFreeText: m.strict, strictFreeChat: m.strict }));
vi.mock('../FreeChain/runtime', () => ({ maybeFreeChain: m.freeChain }));
vi.mock('../../lib/aiSpendZone', () => ({ recordAiSpend: m.spend }));
vi.mock('../../lib/AssistantSpendStore', () => ({ assistantSpendStore: { record: m.summary } }));

import { runWithInferenceGatewayContext, currentInferenceGatewayContext } from './runtime';
import { AIRouter } from '../Router/AIRouter';
import { AIRouterManager } from '../AIRouterManager';
import { UniversalAIRouter } from '../UniversalAIRouter';
import { runWithInferenceScope, strictFreeRequired } from '../inferencePolicy';
import { callProfessionalAIWithUsage } from '../../lib/professionalRouting';
import * as conversationMemory from '../../memory/conversationMemory';
import { runProfessionalChatWithUsage } from '../../professionals/engine';

const response: AIProviderResponse & { ok: true } = {
  content: 'gateway answer', provider: 'GROQ', model: 'reviewed-test-model',
  latencyMs: 17, usage: { inputTokens: 42, outputTokens: 9 }, ok: true,
};
function context(overrides: Partial<InferenceGatewayContext> = {}): InferenceGatewayContext {
  return {
    principalId: 'verified-user', tenantId: 'verified-tenant', surface: 'professional',
    policyKey: 'test-professional', qualityTier: 'professional', dataClass: 'confidential',
    funding: 'platform-free-fallback', mode: 'free-first-authorized-paid',
    deadlineAtMs: Date.now() + 60_000, ...overrides,
  };
}
function terminal(): Error { const error = new Error('Selected route unavailable'); error.name = 'GatewayTerminalError'; return error; }
function legacyRouter(): AIRouter {
  const router = new AIRouter('text-callers-test');
  router.registerProvider({
    name: 'GROQ', priority: 1, healthCheck: async () => true,
    execute: m.legacy,
    executeStream: async (_p, _s, chunk) => { m.legacy(); chunk('legacy answer'); return 'legacy answer'; },
  });
  return router;
}

beforeEach(() => {
  vi.clearAllMocks(); m.selected = false; AIRouterManager.reset();
  m.gateway.mockResolvedValue(response);
  m.legacy.mockResolvedValue({ ...response, content: 'legacy answer' });
  m.freeChain.mockResolvedValue(null);
  m.summary.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); AIRouterManager.reset(); });

describe('real text caller chokepoints', () => {
  it('rollout OFF preserves the legacy route and exact system prompt', async () => {
    const result = await runWithInferenceGatewayContext(context(), () => legacyRouter().route('user words', 'system rules'));
    expect(result.response.content).toBe('legacy answer');
    expect(m.legacy).toHaveBeenCalledWith('user words', undefined, undefined, 'system rules', undefined);
    expect(m.gateway).not.toHaveBeenCalled();
  });

  it.each(['route', 'routeRaced'] as const)('%s uses one gateway dispatch, never a legacy rung/race', async method => {
    m.selected = true;
    const result = await runWithInferenceGatewayContext(context(), () => legacyRouter()[method]('user words', 'system rules'));
    expect(result.response).toEqual(response);
    expect(result.telemetry).toMatchObject({ provider: 'GROQ', latency: 17, success: true });
    expect(m.gateway).toHaveBeenCalledTimes(1);
    expect(m.gateway.mock.calls[0][0]).toMatchObject({ prompt: 'user words', systemPrompt: 'system rules' });
    expect(m.legacy).not.toHaveBeenCalled();
  });

  it('streams only gateway chunks and carries cancellation plus partial outcome without hopping', async () => {
    m.selected = true; const signal = new AbortController().signal; const chunks: string[] = [];
    m.gateway.mockImplementationOnce(async input => { input.onChunk('partial'); return { ...response, content: 'partial', reason: 'stalled' }; });
    const result = await runWithInferenceGatewayContext(context(), () => legacyRouter().routeStream('words', 'rules', chunk => chunks.push(chunk), signal));
    expect(result).toMatchObject({ ok: true, reason: 'stalled', raced: false, usage: response.usage });
    expect(chunks).toEqual(['partial']);
    expect(m.gateway.mock.calls[0][0].signal).toBe(signal);
    expect(m.legacy).not.toHaveBeenCalled();
  });

  it('keeps pinned models/images/schema in the gateway envelope instead of dropping capabilities', async () => {
    m.selected = true; m.gateway.mockRejectedValue(terminal());
    const router = legacyRouter();
    await expect(runWithInferenceGatewayContext(context(), () => router.route('words', 'rules', ['image'], 'pinned'))).rejects.toThrow('Selected route');
    expect(m.gateway.mock.calls[0][0]).toMatchObject({ images: ['image'], modelOverride: 'pinned' });
    const schema = { type: 'OBJECT', properties: { answer: { type: 'STRING' } } };
    await expect(runWithInferenceGatewayContext(context(), () => router.generate('words', schema))).rejects.toThrow('Selected route');
    expect(m.gateway.mock.calls[1][0].schema).toEqual(schema);
    expect(m.legacy).not.toHaveBeenCalled();
  });

  it('selected strict-free reaches the gateway with strict policy still active, not the old unchecked dispatcher', async () => {
    m.selected = true; vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
    m.gateway.mockImplementationOnce(async () => { expect(strictFreeRequired()).toBe(true); return response; });
    await runWithInferenceScope('free-modules', () => runWithInferenceGatewayContext(context(), () => legacyRouter().route('words', 'rules')));
    expect(m.gateway).toHaveBeenCalledTimes(1);
    expect(m.strict).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled();
  });

  it('selected manager does not construct/register the legacy provider universe', () => {
    m.selected = true;
    expect(runWithInferenceGatewayContext(context(), () => AIRouterManager.getRouter('professional').getProviderChain())).toEqual([]);
  });

  it('Universal bypasses old FreeChain once selected and preserves folded history, system and signal', async () => {
    m.selected = true; const signal = new AbortController().signal;
    const oldContext = { uid: 'verified-user', conversationKey: 'conversation', privateTurn: true, healthTurn: false, cacheEligible: false };
    const result = await runWithInferenceGatewayContext(context({ surface: 'chat' }), () => new UniversalAIRouter().routeDetailed('hello', [{ sender: 'user', text: 'earlier' }], 'navbharat', undefined, 'language + system', false, signal, oldContext));
    expect(result).toMatchObject({ ok: true, provider: 'GROQ', usage: response.usage });
    expect(m.gateway).toHaveBeenCalledTimes(1);
    expect(m.gateway.mock.calls[0][0]).toMatchObject({ prompt: 'User: earlier\nUser: hello', systemPrompt: 'language + system', signal });
    expect(m.freeChain).not.toHaveBeenCalled();
  });

  it('professional denial is terminal: it cannot be caught and restarted on its second namespace', async () => {
    m.selected = true; m.gateway.mockRejectedValue(terminal());
    await expect(runWithInferenceGatewayContext(context(), () => callProfessionalAIWithUsage('rules', 'words', 'paid'))).rejects.toThrow('Selected route');
    expect(m.gateway).toHaveBeenCalledTimes(1);
    expect(m.spend).not.toHaveBeenCalled();
  });

  it('unexpected gateway errors and malformed empty results also cannot reopen the professional fallback', async () => {
    m.selected = true; m.gateway.mockRejectedValueOnce(new Error('unexpected adapter failure'));
    await expect(runWithInferenceGatewayContext(context(), () => callProfessionalAIWithUsage('rules', 'words', 'paid'))).rejects.toThrow('unexpected adapter failure');
    expect(m.gateway).toHaveBeenCalledTimes(1);
    m.gateway.mockResolvedValueOnce({ ...response, content: '   ' });
    await expect(runWithInferenceGatewayContext(context(), () => callProfessionalAIWithUsage('rules', 'words', 'paid'))).rejects.toThrow('did not return an answer');
    expect(m.gateway).toHaveBeenCalledTimes(2);
    expect(m.spend).not.toHaveBeenCalled();
  });

  it('professional answer keeps real usage flowing to its unchanged spend collector', async () => {
    m.selected = true;
    const result = await runWithInferenceGatewayContext(context(), () => callProfessionalAIWithUsage('rules', 'words'));
    expect(result.spend).toMatchObject({ provider: 'GROQ', model: 'reviewed-test-model', inputTokens: 42, outputTokens: 9 });
    expect(m.spend).toHaveBeenCalledWith(result.spend);
    expect(m.summary).toHaveBeenCalledTimes(1); expect(m.gateway).toHaveBeenCalledTimes(1);
  });

  it('unreviewed professional personas carry health/clinical requirements and the verified principal', async () => {
    m.selected = true;
    const deadlineAtMs = Date.now() + 20_000; const signal = new AbortController().signal;
    await runProfessionalChatWithUsage({ id: 'unreviewed_ai', name: 'Unknown expert', systemPrompt: 'Persona stays intact.' }, 'hello', [], 'real-user', 'free', { deadlineAtMs, signal, freeProductGateway: true });
    expect(m.gateway.mock.calls[0][1]).toMatchObject({ principalId: 'real-user', tenantId: 'real-user', surface: 'professional', qualityTier: 'clinical', dataClass: 'health', funding: 'platform-free-fallback', deadlineAtMs, signal });
    expect(m.gateway.mock.calls[0][0].systemPrompt).toContain('Persona stays intact.');
  });
  it('professional engine preserves the typed terminal error rather than masking it as retryable', async () => {
    m.selected = true; const refusal = terminal(); m.gateway.mockRejectedValueOnce(refusal);
    await expect(runProfessionalChatWithUsage({ id: 'unreviewed_ai', name: 'Expert', systemPrompt: 'Persona' }, 'hello', [], 'real-user', 'free', { freeProductGateway: true })).rejects.toBe(refusal);
    expect(m.gateway).toHaveBeenCalledOnce();
  });

  it('paid professional entry remains legacy even when the Free gateway rollout is enabled', async () => {
    m.selected = true;
    const routed = vi.fn(async () => {
      expect(currentInferenceGatewayContext()).toBeUndefined();
      return { response, telemetry: { success: true } };
    });
    vi.spyOn(AIRouterManager, 'getRouter').mockReturnValue({ routeRaced: routed } as unknown as AIRouter);
    await runProfessionalChatWithUsage({ id: 'paid_expert', name: 'Expert', systemPrompt: 'Original paid persona' }, 'hello', [], 'real-user', 'paid');
    expect(routed).toHaveBeenCalledOnce(); expect(m.gateway).not.toHaveBeenCalled();
  });
  it('a tenant/API helper tier named free is not itself a Free product ingress grant', async () => {
    m.selected = true;
    const routed = vi.fn(async () => {
      expect(currentInferenceGatewayContext()).toBeUndefined();
      return { response, telemetry: { success: true } };
    });
    vi.spyOn(AIRouterManager, 'getRouter').mockReturnValue({ routeRaced: routed } as unknown as AIRouter);
    await runProfessionalChatWithUsage({ id: 'api_expert', name: 'Expert', systemPrompt: 'API persona' }, 'hello', [], 'verified-api-owner', 'free');
    expect(routed).toHaveBeenCalledOnce(); expect(m.gateway).not.toHaveBeenCalled();
  });
  it('professional persona never moves a tenant-funded request to the platform fallback pool', async () => {
    m.selected = true;
    const tenant = context({ surface: 'developer-api', funding: 'existing-tenant', deadlineAtMs: Date.now() + 10_000 });
    await runWithInferenceGatewayContext(tenant, () => runProfessionalChatWithUsage({ id: 'test_ai', name: 'Expert', systemPrompt: 'Persona' }, 'hello', [], 'real-user', 'free'));
    expect(m.gateway.mock.calls[0][1]).toMatchObject({ principalId: tenant.principalId, tenantId: tenant.tenantId, surface: 'developer-api', funding: 'existing-tenant', deadlineAtMs: tenant.deadlineAtMs });
  });
});

it('delivers a completed professional answer when optional selected memory persistence is unavailable', async () => {
 m.selected = true;
 const remember = vi.spyOn(conversationMemory, 'rememberTurn').mockRejectedValue(terminal());
 const result = await runWithInferenceGatewayContext(context(), () => runProfessionalChatWithUsage({ id: 'test', name: 'Test', systemPrompt: 'Test expert' }, 'hello', [], 'verified-user', 'free'));
 expect(result.reply).toBe('gateway answer'); expect(result.memoryStatus).toBe('not-saved');
 expect(remember).toHaveBeenCalledOnce(); expect(m.gateway).toHaveBeenCalledOnce(); expect(m.legacy).not.toHaveBeenCalled();
});
