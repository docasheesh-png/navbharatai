import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({ maybeGatewayText: async () => null }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeText: vi.fn() }));
vi.mock('../src/server/AI/inferencePolicy', () => ({ strictFreeRequired: () => false, StrictFreeCapabilityError: class extends Error {} }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouter, getProviderStats, getRouterOutcomeStats, _resetRouterOutcomes } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
function provider(name: AIProvider['name'], priority: number, stream: NonNullable<AIProvider['executeStream']>): AIProvider {
  return { name, priority, pinnedModel: 'mock-model', execute: vi.fn(), healthCheck: async () => true, executeStream: stream };
}
beforeEach(() => { resetAllBreakers(); _resetRouterOutcomes(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('sequential chat commits one visible answer, not one resolved promise', () => {
  it.each(['on', 'off'])('never retries a partially delivered failed stream with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    const first = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => { chunk('The answer is '); throw new Error('connection lost'); });
    const second = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => { chunk('A second answer.'); return 'A second answer.'; });
    router.registerProvider(provider('GLM', 1, first));
    router.registerProvider(provider('GROQ', 2, second));
    const chunks: string[] = [];
    const result = await router.routeStream('offline fixture', undefined, chunk => chunks.push(chunk));
    expect.soft(chunks).toEqual(['The answer is ']);
    expect.soft(second).not.toHaveBeenCalled();
    expect.soft(result).toMatchObject({ ok: true, provider: 'GLM', reason: 'stalled', raced: false });
    expect(getProviderStats().GLM.inFlight).toBe(0);
  });
  it.each(['on', 'off'])('does not call an empty successful stream a delivered answer with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    router.registerProvider(provider('GLM', 1, vi.fn(async () => '')));
    const second = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => { chunk('Actual answer.'); return 'Actual answer.'; });
    router.registerProvider(provider('GROQ', 2, second));
    const chunks: string[] = [];
    const result = await router.routeStream('offline fixture', undefined, chunk => chunks.push(chunk));
    expect.soft(chunks).toEqual(['Actual answer.']);
    expect.soft(second).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, provider: 'GROQ' });
  });

  it.each(['on', 'off'])('discards a whitespace-only failure and closes stale callbacks with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    let late!: (text: string) => void;
    router.registerProvider(provider('GLM', 1, vi.fn(async (_p, _s, chunk) => {
      late = chunk; chunk('  \n'); throw new Error('connection lost');
    })));
    const rescue = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => {
      late('stale answer'); chunk('Useful answer.'); return 'Useful answer.';
    });
    router.registerProvider(provider('GROQ', 2, rescue));
    const chunks: string[] = [];
    expect(await router.routeStream('fixture', undefined, chunk => chunks.push(chunk))).toMatchObject({ ok: true, provider: 'GROQ' });
    late('late completion');
    expect(chunks).toEqual(['Useful answer.']);
    expect(rescue).toHaveBeenCalledOnce();
    expect(getRouterOutcomeStats()).toEqual({ requests: 1, failed: 0 });
    expect(getProviderStats().GLM.inFlight).toBe(0);
  });

  it.each(['on', 'off'])('preserves answer indentation without exposing whitespace-only answers with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    router.registerProvider(provider('GLM', 1, vi.fn(async (_p, _s, chunk) => {
      chunk('  '); chunk('indented'); chunk(' '); chunk('answer'); return '  indented answer';
    })));
    const chunks: string[] = [];
    expect(await router.routeStream('fixture', undefined, chunk => chunks.push(chunk))).toMatchObject({ ok: true, provider: 'GLM' });
    expect(chunks).toEqual(['  indented', ' ', 'answer']);
  });

  it.each(['on', 'off'])('reports terminal no-visible-output failure honestly with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    // Adapters may resolve after reasoning/metadata only: a returned string is not a streamed answer.
    router.registerProvider(provider('GLM', 1, vi.fn(async () => 'unstreamed metadata')));
    router.registerProvider(provider('GROQ', 2, vi.fn(async (_p, _s, chunk) => { chunk('  \n'); return '  \n'; })));
    const chunk = vi.fn();
    expect(await router.routeStream('fixture', undefined, chunk)).toEqual({ ok: false, reason: 'all-failed' });
    expect(chunk).toHaveBeenCalledOnce();
    expect(chunk).toHaveBeenCalledWith(expect.stringMatching(/busy/), 'notice');
    expect(getRouterOutcomeStats()).toEqual({ requests: 1, failed: 1 });
    expect(getProviderStats().GLM.inFlight).toBe(0);
    expect(getProviderStats().GROQ.inFlight).toBe(0);
  });

  it.each(['on', 'off'])('keeps fallback healthy for the next request with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    const failed = vi.fn(async () => { throw new Error('connection lost'); });
    const served = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => { chunk('Answer.'); return 'Answer.'; });
    router.registerProvider(provider('GLM', 1, failed));
    router.registerProvider(provider('GROQ', 2, served));
    const before = getProviderStats().GROQ?.requestCount ?? 0;
    for (let n = 0; n < 2; n++) {
      const chunk = vi.fn();
      expect(await router.routeStream('fixture', undefined, chunk)).toMatchObject({ ok: true, provider: 'GROQ' });
      expect(chunk).toHaveBeenCalledOnce();
    }
    expect(failed).toHaveBeenCalledOnce();
    expect(served).toHaveBeenCalledTimes(2);
    expect(getProviderStats().GROQ.requestCount - before).toBe(2);
    expect(getProviderStats().GROQ.inFlight).toBe(0);
    expect(getRouterOutcomeStats()).toEqual({ requests: 2, failed: 0 });
  });

  it.each(['on', 'off'])('releases the slot after a synchronous partial stream failure with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const router = new AIRouter('free');
    let late!: (text: string) => void;
    router.registerProvider(provider('GLM', 1, vi.fn((_p, _s, chunk) => { late = chunk; chunk('Partial.'); throw new Error('sync failure'); })));
    const fallback = vi.fn<NonNullable<AIProvider['executeStream']>>(async (_p, _s, chunk) => { chunk('Next turn.'); return 'Next turn.'; });
    router.registerProvider(provider('GROQ', 2, fallback));
    const chunks: string[] = [];
    expect(await router.routeStream('fixture', undefined, chunk => chunks.push(chunk))).toMatchObject({ ok: true, reason: 'stalled', provider: 'GLM' });
    late('late ignored');
    expect(chunks).toEqual(['Partial.']);
    expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM.inFlight).toBe(0);
    expect(await router.routeStream('next fixture', undefined, vi.fn())).toMatchObject({ ok: true, provider: 'GROQ' });
    expect(fallback).toHaveBeenCalledOnce();
    expect(getRouterOutcomeStats()).toEqual({ requests: 2, failed: 0 });
  });

  it.each(['on', 'off'])('does not turn a caller abort into success or a provider-health failure with watchdog %s', async enabled => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', enabled);
    const controller = new AbortController();
    const router = new AIRouter('free');
    let received: AbortSignal | undefined; const observedAbort = vi.fn();
    router.registerProvider(provider('GLM', 1, vi.fn(async (_p, _s, chunk, _model, signal) => {
      received = signal; signal?.addEventListener('abort', observedAbort, { once: true });
      chunk('Partial.'); controller.abort(); chunk('discarded'); return 'Partial.discarded';
    })));
    const fallback = vi.fn();
    router.registerProvider(provider('GROQ', 2, fallback));
    const chunks: string[] = [];
    expect(await router.routeStream('fixture', undefined, chunk => chunks.push(chunk), controller.signal)).toEqual({ ok: false, reason: 'aborted' });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(true); expect(received?.reason).toBe(controller.signal.reason);
    expect(observedAbort).toHaveBeenCalledOnce();
    expect(chunks).toEqual(['Partial.']);
    expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM).toMatchObject({ inFlight: 0, circuitState: 'closed' });
    expect(getRouterOutcomeStats()).toEqual({ requests: 0, failed: 0 });
  });

  it('whitespace heartbeats do not postpone the first-visible-token deadline', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CHAT_STREAM_FIRST_TOKEN_MS', '5000');
    const router = new AIRouter('free');
    let late!: (text: string) => void; let finish!: () => void;
    router.registerProvider(provider('GLM', 1, vi.fn((_p, _s, chunk) => { late = chunk; return new Promise<string>(resolve => { finish = () => resolve('late answer'); }); })));
    router.registerProvider(provider('GROQ', 2, vi.fn(async (_p, _s, chunk) => { chunk('Answer.'); return 'Answer.'; })));
    const chunks: string[] = [];
    const pending = router.routeStream('fixture', undefined, chunk => chunks.push(chunk));
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 0; n < 4; n++) { await vi.advanceTimersByTimeAsync(1000); late(' '); }
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: true, provider: 'GROQ' });
    late('stale answer');
    expect(chunks).toEqual(['Answer.']);
    expect(vi.getTimerCount()).toBe(0);
    // The observer finished, but this uncooperative SDK still owns its physical slot.
    expect(getProviderStats().GLM.inFlightByUniverse.free).toBe(1);
    finish(); for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(getProviderStats().GLM.inFlightByUniverse.free).toBe(0);
  });
});
