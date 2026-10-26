/** A timed-out observer must abort transport, not release an unsettled physical provider slot. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouter, getProviderStats } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); resetAllBreakers(); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('CHAT_STREAM_WATCHDOG', 'on'); vi.stubEnv('CHAT_STREAM_FIRST_TOKEN_MS', '5000'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('sequential stream physical ownership', () => {
  it('watchdog aborts the attempt but retains an uncooperative SDK slot until actual settlement', async () => {
    const router = new AIRouter('physical-watchdog-test');
    let signal: AbortSignal | undefined; let finish!: () => void; let late!: () => void;
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: async (_p, _s, chunk, _m, received) => {
      signal = received; late = () => chunk('late answer'); await new Promise<void>(resolve => { finish = resolve; }); return 'late answer';
    } });
    const chunks = vi.fn(); const pending = router.routeStream('hello', undefined, chunks);
    await flush(); await vi.advanceTimersByTimeAsync(5000); const outcome = await pending;
    expect.soft(outcome.ok).toBe(false); expect.soft(signal?.aborted).toBe(true);
    expect.soft(getProviderStats().GLM.inFlightByUniverse['physical-watchdog-test']).toBe(1);
    const before = chunks.mock.calls.length; late(); expect(chunks).toHaveBeenCalledTimes(before);
    finish(); await flush(); expect(getProviderStats().GLM.inFlightByUniverse['physical-watchdog-test']).toBe(0);
  });
  it('eight abandoned physical attempts fill the existing cap; a ninth cannot create zombie overflow', async () => {
    const router = new AIRouter('physical-watchdog-cap'); const finish: Array<() => void> = [];
    const executeStream = vi.fn(async () => { await new Promise<void>(resolve => finish.push(resolve)); return ''; });
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream });
    for (let i = 0; i < 9; i++) { const turn = router.routeStream('hello', undefined, () => {}); await flush(); await vi.advanceTimersByTimeAsync(5000); await turn; }
    expect.soft(executeStream).toHaveBeenCalledTimes(8); expect.soft(getProviderStats().GLM.inFlightByUniverse['physical-watchdog-cap']).toBe(8);
    finish.forEach(resolve => resolve()); await flush(); expect(getProviderStats().GLM.inFlightByUniverse['physical-watchdog-cap']).toBe(0);
  });
  it('parent cancellation reaches the attempt without penalizing provider health', async () => {
    const router = new AIRouter('physical-parent-cancel'); let signal: AbortSignal | undefined;
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: async (_p, _s, _c, _m, received) => {
      signal = received; await new Promise<void>((_resolve, reject) => received?.addEventListener('abort', () => reject(received.reason), { once: true })); return '';
    } });
    const parent = new AbortController(); const pending = router.routeStream('hello', undefined, () => {}, parent.signal);
    await flush(); parent.abort(); expect(await pending).toMatchObject({ ok: false, reason: 'aborted' });
    expect(signal?.aborted).toBe(true); expect(getProviderStats().GLM.consecutiveFailures).toBe(0);
    expect(getProviderStats().GLM.inFlightByUniverse['physical-parent-cancel']).toBe(0);
  });
  it('late rejection releases only its own slot, not another still-running attempt', async () => {
    const router = new AIRouter('physical-late-reject'); let reject!: (error: Error) => void; let finish!: () => void;
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: async prompt => {
      if (prompt === 'reject') await new Promise<void>((_resolve, fail) => { reject = fail; });
      else await new Promise<void>(resolve => { finish = resolve; });
      return '';
    } });
    const a = router.routeStream('reject', undefined, () => {}); const b = router.routeStream('survivor', undefined, () => {});
    await flush(); await vi.advanceTimersByTimeAsync(5000); await Promise.all([a, b]);
    expect(getProviderStats().GLM.inFlightByUniverse['physical-late-reject']).toBe(2);
    reject(new Error('late transport rejection')); await flush();
    expect(getProviderStats().GLM.inFlightByUniverse['physical-late-reject']).toBe(1);
    finish(); await flush(); expect(getProviderStats().GLM.inFlightByUniverse['physical-late-reject']).toBe(0);
  });
  it('an idle partial stream aborts its attempt and keeps partial outcome without another provider', async () => {
    vi.stubEnv('CHAT_STREAM_IDLE_MS', '5000');
    const router = new AIRouter('physical-partial-idle'); let finish!: () => void; let signal: AbortSignal | undefined;
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: async (_p, _s, chunk, _m, received) => {
      signal = received; chunk('partial answer'); await new Promise<void>(resolve => { finish = resolve; }); return 'partial answer';
    } });
    const fallback = vi.fn(async () => 'unused'); router.registerProvider({ name: 'GROQ', priority: 2, healthCheck: async () => true, execute: vi.fn(), executeStream: fallback });
    const chunks = vi.fn(); const pending = router.routeStream('hi', undefined, chunks);
    await flush(); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ ok: true, reason: 'stalled' }); expect(signal?.aborted).toBe(true);
    expect(chunks).toHaveBeenCalledExactlyOnceWith('partial answer'); expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM.inFlightByUniverse['physical-partial-idle']).toBe(1);
    finish(); await flush(); expect(getProviderStats().GLM.inFlightByUniverse['physical-partial-idle']).toBe(0);
  });
  it('normal completion leaves no watchdog timer or physical occupancy', async () => {
    const router = new AIRouter('physical-normal');
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: async (_p, _s, chunk) => { chunk('answer'); return 'answer'; } });
    expect((await router.routeStream('hi', undefined, () => {})).ok).toBe(true);
    expect(getProviderStats().GLM.inFlightByUniverse['physical-normal']).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('a synchronous adapter throw releases its one slot exactly once', async () => {
    const router = new AIRouter('physical-sync-throw');
    let finish!: () => void;
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: vi.fn(), executeStream: prompt => {
      if (prompt === 'survivor') return new Promise<string>(resolve => { finish = () => resolve(''); });
      throw new Error('synthetic adapter failure');
    } });
    const survivor = router.routeStream('survivor', undefined, () => {}); await flush();
    expect((await router.routeStream('hello', undefined, () => {})).ok).toBe(false);
    expect(getProviderStats().GLM.inFlightByUniverse['physical-sync-throw']).toBe(1);
    finish(); await survivor; expect(getProviderStats().GLM.inFlightByUniverse['physical-sync-throw']).toBe(0);
  });
});
