import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRouter, getProviderStats } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
type Stream = NonNullable<AIProvider['executeStream']>;
function routerFor(universe: string, first: Stream, second: Stream) {
  const router = new AIRouter(universe);
  const fallback = vi.fn<Stream>(async (_p, _s, chunk) => { chunk('Complete public answer.'); return 'Complete public answer.'; });
  for (const [name, priority, executeStream] of [['GROK', 1, first], ['GEMINI', 2, second], ['GLM', 3, fallback]] as const) {
    router.registerProvider({ name, priority, executeStream, execute: vi.fn(), healthCheck: async () => true });
  }
  return { router, fallback };
}
beforeEach(() => {
  vi.useFakeTimers(); resetAllBreakers();
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('AI_STREAM_RACE', ''); vi.stubEnv('CHAT_STREAM_WATCHDOG', 'on');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const failed: Stream = async () => { throw new Error('Synthetic connection failure'); };
describe('professional race terminal recovery', () => {
  it('uses the existing fallback immediately after both racers fail before output', async () => {
    const { router, fallback } = routerFor('professional', failed, failed);
    const chunks: string[] = [];
    const pending = router.routeStream('Public test', undefined, text => chunks.push(text));
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledOnce();
    expect(await pending).toMatchObject({ ok: true, provider: 'GLM', raced: false });
    expect(chunks).toEqual(['Complete public answer.']);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not wait for the commit deadline after both streams end empty', async () => {
    const empty: Stream = async (_p, _s, chunk) => { chunk('  '); return '  '; };
    const { router, fallback } = routerFor('professional', empty, empty);
    const pending = router.routeStream('Public test', undefined, vi.fn());
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledOnce();
    await pending;
  });
  it('waits for a still-running racer instead of adding a premature fallback', async () => {
    let finish!: () => void;
    const slow: Stream = async (_p, _s, chunk) => {
      await new Promise<void>(resolve => { finish = resolve; });
      chunk('Complete survivor answer.'); return 'Complete survivor answer.';
    };
    const { router, fallback } = routerFor('professional', failed, slow);
    const chunks: string[] = [];
    const pending = router.routeStream('Public test', undefined, text => chunks.push(text));
    await vi.advanceTimersByTimeAsync(100);
    expect(fallback).not.toHaveBeenCalled();
    finish();
    expect(await pending).toMatchObject({ ok: true, provider: 'GEMINI', raced: true });
    expect(chunks).toEqual(['Complete survivor answer.']);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('does not dispatch the fallback after cancellation', async () => {
    const controller = new AbortController();
    const cancel: Stream = async () => { controller.abort(); throw new Error('Stopped'); };
    const { router, fallback } = routerFor('professional', cancel, failed);
    expect(await router.routeStream('Public test', undefined, vi.fn(), controller.signal)).toMatchObject({ ok: false, reason: 'aborted' });
    expect(fallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not change Pro race timing' , async () => {
    const { router, fallback } = routerFor('pro', failed, failed);
    const pending = router.routeStream('Public test', undefined, vi.fn());
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toMatchObject({ ok: true, provider: 'GLM' });
  });
  it('does not fall back when a committed answer fails', async () => {
    const partial: Stream = async (_p, _s, chunk) => { chunk('Partial'); throw new Error('Disconnected'); };
    const { router, fallback } = routerFor('professional', partial, failed);
    const chunks: string[] = [];
    expect(await router.routeStream('Public test', undefined, text => chunks.push(text))).toMatchObject({ reason: 'stalled' });
    expect(chunks).toEqual(['Partial']); expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GROK.inFlight).toBe(0);
  });
});
