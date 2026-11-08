/** Raced-stream commitment and terminal-state regressions. Synthetic providers only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRouter, _resetRouterOutcomes, getProviderStats, getRouterOutcomeStats } from '../src/server/AI/Router/AIRouter';
import { getBreaker, resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';

vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));

type Stream = NonNullable<AIProvider['executeStream']>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function configure(first: Stream, second: Stream, universe = 'professional') {
  const router = new AIRouter(universe);
  const firstCall = vi.fn(first), secondCall = vi.fn(second);
  for (const [name, priority, executeStream] of [['GROK', 1, firstCall], ['GEMINI', 2, secondCall]] as const) {
    router.registerProvider({ name, priority, pinnedModel: `synthetic-${name}`, execute: vi.fn(), healthCheck: async () => true, executeStream });
  }
  return { router, firstCall, secondCall };
}
beforeEach(() => {
  vi.useFakeTimers(); resetAllBreakers(); _resetRouterOutcomes();
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('AI_STREAM_RACE', ''); vi.stubEnv('CHAT_STREAM_WATCHDOG', 'on');
  vi.stubEnv('CHAT_STREAM_IDLE_MS', '5000');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('paid race: visible-output commitment and honest terminal outcomes', () => {
  it.each(['on', 'off'])('whitespace must not beat a real answer (watchdog %s)', async watchdog => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const { router, firstCall, secondCall } = configure(
      async (_p, _s, chunk) => { chunk(' \n'); return ' \n'; },
      async (_p, _s, chunk) => { chunk('Healthy answer.'); return 'Healthy answer.'; },
    );
    const chunks: string[] = [];
    const outcome = await router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).toHaveBeenCalledOnce();
    expect.soft(chunks.join('')).toBe('Healthy answer.');
    expect.soft(outcome).toMatchObject({ ok: true, provider: 'GEMINI', raced: true });
    expect.soft(getBreaker('GROK').snapshot().consecutiveFailures).toBe(1);
    expect(getProviderStats().GROK.inFlight).toBe(0);
    expect(getProviderStats().GEMINI.inFlight).toBe(0);
  });

  it.each(['on', 'off'])('committed rejection must report the answer interrupted, not clean (watchdog %s)', async watchdog => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const { router, firstCall, secondCall } = configure(
      async (_p, _s, chunk) => { chunk('One partial answer.'); throw new Error('synthetic upstream disconnect'); },
      async (_p, _s, chunk) => { chunk('Discarded alternative.'); return 'Discarded alternative.'; },
    );
    const chunks: string[] = [];
    const outcome = await router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).toHaveBeenCalledOnce();
    expect(chunks).toEqual(['One partial answer.']);
    expect(getBreaker('GROK').snapshot().consecutiveFailures).toBe(1);
    expect(getRouterOutcomeStats()).toEqual({ requests: 1, failed: 0 }); // partial was genuinely delivered
    expect(outcome).toMatchObject({ ok: true, provider: 'GROK', raced: true, reason: 'stalled' });
  });

  it('clean winner and a later successful loser release both slots without mixing output', async () => {
    const loser = deferred<string>(); let late!: (chunk: string) => void;
    const { router, secondCall } = configure(
      async (_p, _s, chunk) => { chunk('Complete answer.'); return 'Complete answer.'; },
      (_p, _s, chunk) => { late = chunk; return loser.promise; },
    );
    const chunks: string[] = [];
    const outcome = await router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    expect(outcome).toMatchObject({ ok: true, provider: 'GROK', raced: true });
    expect(outcome.reason).toBeUndefined(); expect(secondCall).toHaveBeenCalledOnce();
    late('Discarded late answer.'); loser.resolve('Discarded late answer.');
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual(['Complete answer.']);
    expect(getProviderStats().GROK.inFlight).toBe(0); expect(getProviderStats().GEMINI.inFlight).toBe(0);
    expect(getBreaker('GEMINI').snapshot().consecutiveFailures).toBe(0);
  });

  it('pre-aborted turn starts no providers and is excluded from outcome accounting', async () => {
    const stream = vi.fn<Stream>(); const { router, firstCall, secondCall } = configure(stream, stream);
    const controller = new AbortController(); controller.abort();
    expect(await router.routeStream('Synthetic test', undefined, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'aborted' });
    expect(firstCall).not.toHaveBeenCalled(); expect(secondCall).not.toHaveBeenCalled();
    expect(getRouterOutcomeStats()).toEqual({ requests: 0, failed: 0 });
  });

  it('client abort after commitment is not provider failure or an answered terminal outcome', async () => {
    const controller = new AbortController();
    const stopOnAbort = (text: string): Stream => (_p, _s, chunk, _m, signal) => {
      chunk(text);
      return new Promise<string>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
    };
    const { router, firstCall, secondCall } = configure(stopOnAbort('Partial answer.'), stopOnAbort('Discarded.'));
    const chunks: string[] = [];
    const pending = router.routeStream('Synthetic test', undefined, c => chunks.push(c), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).toHaveBeenCalledOnce();
    controller.abort();
    const outcome = await pending;
    expect(chunks).toEqual(['Partial answer.']);
    expect.soft(outcome).toEqual({ ok: false, reason: 'aborted' });
    expect.soft(getRouterOutcomeStats()).toEqual({ requests: 0, failed: 0 });
    expect.soft(getBreaker('GROK').snapshot().consecutiveFailures).toBe(0);
    expect.soft(getBreaker('GEMINI').snapshot().consecutiveFailures).toBe(0);
    expect(getProviderStats().GROK.inFlight).toBe(0); expect(getProviderStats().GEMINI.inFlight).toBe(0);
  });

  it.each(['on', 'off'])('preserves leading formatting and trailing whitespace for the real winner (%s)', async watchdog => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const { router } = configure(
      async (_p, _s, chunk) => { chunk(' \n'); chunk('Complete answer.'); chunk('\n'); return 'metadata'; },
      async (_p, _s, chunk) => { chunk('Discarded.'); return 'Discarded.'; },
    );
    const chunks: string[] = [];
    const outcome = await router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    expect(chunks).toEqual([' \nComplete answer.', '\n']);
    expect(outcome).toMatchObject({ ok: true, provider: 'GROK', raced: true });
    expect(outcome.reason).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['on', 'off'])('professional empty completions immediately use the existing rest fallback (%s)', async watchdog => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const { router, firstCall, secondCall } = configure(async () => 'metadata only', async (_p, _s, chunk) => { chunk(''); chunk(' \n'); return 'metadata'; });
    const fallback = vi.fn<Stream>(async (_p, _s, chunk) => { chunk('Fallback answer.'); return 'Fallback answer.'; });
    router.registerProvider({ name: 'ANTHROPIC', priority: 3, execute: vi.fn(), healthCheck: async () => true, executeStream: fallback });
    const chunks: string[] = [];
    const pending = router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true, provider: 'ANTHROPIC', raced: false });
    expect(chunks).toEqual(['Fallback answer.']);
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).toHaveBeenCalledOnce(); expect(fallback).toHaveBeenCalledOnce();
    expect(getBreaker('GROK').snapshot().consecutiveFailures).toBe(1);
    expect(getBreaker('GEMINI').snapshot().consecutiveFailures).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['on', 'off'])('a synchronous client abort in the first callback never starts the second racer (%s)', async watchdog => {
    vi.stubEnv('CHAT_STREAM_WATCHDOG', watchdog);
    const controller = new AbortController();
    const { router, firstCall, secondCall } = configure(
      async (_p, _s, chunk) => { chunk('Partial.'); return 'Partial.'; },
      async () => 'Never called',
    );
    const pending = router.routeStream('Synthetic test', undefined, () => controller.abort(), controller.signal);
    expect(await pending).toEqual({ ok: false, reason: 'aborted' });
    expect(firstCall).toHaveBeenCalledOnce(); expect(secondCall).not.toHaveBeenCalled();
    expect(getBreaker('GROK').snapshot().consecutiveFailures).toBe(0);
    expect(getRouterOutcomeStats()).toEqual({ requests: 0, failed: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['AbortError', 'APIUserAbortError', 'TimeoutError', 'Error'])('unproven provider %s is not claimed as caller cancellation', async name => {
    const { router } = configure(
      async (_p, _s, chunk) => { chunk('Partial.'); throw Object.assign(new Error('synthetic provider termination'), { name }); },
      async (_p, _s, chunk) => { chunk('Discarded.'); return 'Discarded.'; },
    );
    expect(await router.routeStream('Synthetic test', undefined, vi.fn())).toMatchObject({ ok: true, reason: 'stalled', raced: true });
    expect(getBreaker('GROK').snapshot().consecutiveFailures).toBe(1);
    expect(getRouterOutcomeStats()).toEqual({ requests: 1, failed: 0 });
  });

  it('late loser cancellation with an observed caller abort does not poison its provider', async () => {
    const controller = new AbortController(); const loser = deferred<string>();
    const { router } = configure(
      async (_p, _s, chunk) => { chunk('Complete.'); return 'Complete.'; },
      () => loser.promise,
    );
    expect(await router.routeStream('Synthetic test', undefined, vi.fn(), controller.signal)).toMatchObject({ ok: true, provider: 'GROK' });
    controller.abort(); loser.reject(controller.signal.reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(getBreaker('GEMINI').snapshot().consecutiveFailures).toBe(0);
    expect(getProviderStats().GEMINI.inFlight).toBe(0);
  });

  it('watchdog interruption followed by adapter timeout AbortError stays a genuine provider failure', async () => {
    const failed = deferred<string>(); let late!: (text: string) => void;
    const { router } = configure(
      (_p, _s, chunk) => { late = chunk; chunk('Partial.'); return failed.promise; },
      async (_p, _s, chunk) => { chunk('Discarded.'); return 'Discarded.'; },
    );
    const chunks: string[] = [];
    const pending = router.routeStream('Synthetic test', undefined, c => chunks.push(c));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ ok: true, reason: 'stalled' });
    late('Late text.');
    failed.reject(Object.assign(new Error('synthetic adapter timeout'), { name: 'AbortError' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toEqual(['Partial.']);
    expect(getBreaker('GROK').snapshot().consecutiveFailures).toBe(1);
    expect(getProviderStats().GROK.inFlight).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
