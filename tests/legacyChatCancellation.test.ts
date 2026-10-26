/** Offline cancellation contract: real legacy routers and real adapter argument wiring; no provider traffic. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getRouter: vi.fn() }));
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: m.getRouter } }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { UniversalAIRouter } from '../src/server/AI/UniversalAIRouter';
import { AIRouter, getProviderStats } from '../src/server/AI/Router/AIRouter';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
import { runWithFreeAnswerContext } from '../src/server/lib/freeAnswerQuotaContext';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
const answer = { content: 'A real test answer', model: 'test', provider: 'GLM' as const, latencyMs: 1 };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); resetAllBreakers(); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture(execute: (...args: any[]) => Promise<typeof answer>, universe = 'cancel-test') {
  const router = new AIRouter(universe);
  const first = vi.fn(execute); const fallback = vi.fn(async () => answer);
  router.registerProvider({ name: 'GLM', priority: 1, healthCheck: async () => true, execute: first });
  router.registerProvider({ name: 'GROQ', priority: 2, healthCheck: async () => true, execute: fallback });
  m.getRouter.mockReturnValue(router);
  return { router, first, fallback };
}
describe('legacy nonstream cancellation reaches physical attempts', () => {
  it('forwards caller cancellation and never falls back or poisons health after abort', async () => {
    let received: AbortSignal | undefined;
    let release!: () => void;
    const { first, fallback } = fixture(async (...args) => {
      received = args[5];
      await new Promise<void>((resolve, reject) => { release = resolve; received?.addEventListener('abort', () => reject(received!.reason), { once: true }); });
      return answer;
    });
    const controller = new AbortController();
    const pending = new UniversalAIRouter().routeDetailed('hi', [], 'navbharat', undefined, undefined, false, controller.signal);
    await flush();
    expect.soft(first).toHaveBeenCalledOnce();
    expect.soft(received).toBeInstanceOf(AbortSignal);
    controller.abort(new Error('caller left'));
    // Allow a baseline missing-signal implementation to finish without a dangling test promise.
    release();
    const result = await pending;
    expect.soft(result.ok).toBe(false);
    expect.soft(received?.aborted).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM.consecutiveFailures).toBe(0);
    expect(getProviderStats().GLM.inFlightByUniverse['cancel-test']).toBe(0);
  });
  it.each([false, true])('preserves the quota-context abort when explicit caller signal is %s', async explicit => {
    let received: AbortSignal | undefined; let release!: () => void;
    const { fallback } = fixture(async (...args) => {
      received = args[5];
      await new Promise<void>((resolve, reject) => { release = resolve; received?.addEventListener('abort', () => reject(received!.reason), { once: true }); });
      return answer;
    });
    const quota = new AbortController();
    const caller = explicit ? new AbortController() : undefined;
    const pending = runWithFreeAnswerContext({ signal: quota.signal, assertActive: () => {} }, () =>
      new UniversalAIRouter().routeDetailed('hi', [], 'navbharat', undefined, undefined, false, caller?.signal));
    await flush(); quota.abort(new Error('quota expired')); release();
    expect((await pending).ok).toBe(false); expect(received?.aborted).toBe(true);
    expect(fallback).not.toHaveBeenCalled(); expect(getProviderStats().GLM.consecutiveFailures).toBe(0);
  });
  it('the 90-second route deadline aborts underlying work, not merely its observer', async () => {
    let received: AbortSignal | undefined;
    let release!: () => void;
    const { fallback } = fixture(async (...args) => {
      received = args[5];
      await new Promise<void>((resolve, reject) => { release = resolve; received?.addEventListener('abort', () => reject(received!.reason), { once: true }); });
      return answer;
    });
    const pending = new UniversalAIRouter().routeDetailed('hi');
    await flush(); await vi.advanceTimersByTimeAsync(90_000);
    const result = await pending;
    expect.soft(received?.aborted).toBe(true);
    expect.soft(result.ok).toBe(false);
    release(); await flush();
    expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM.inFlightByUniverse['cancel-test']).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not release physical occupancy when an uncooperative provider outlives the deadline', async () => {
    let release!: () => void;
    fixture(async () => { await new Promise<void>(resolve => { release = resolve; }); return answer; }, 'uncooperative-test');
    const pending = new UniversalAIRouter().routeDetailed('hi');
    await flush(); await vi.advanceTimersByTimeAsync(90_000);
    expect((await pending).ok).toBe(false);
    expect(getProviderStats().GLM.inFlightByUniverse['uncooperative-test']).toBe(1);
    release(); await flush();
    expect(getProviderStats().GLM.inFlightByUniverse['uncooperative-test']).toBe(0);
  });
  it('successful calls clear the route deadline instead of retaining a timer per answer', async () => {
    fixture(async () => answer);
    expect((await new UniversalAIRouter().routeDetailed('hi')).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a pre-aborted request starts no provider attempt', async () => {
    const { first, fallback } = fixture(async () => answer);
    const controller = new AbortController(); controller.abort();
    expect((await new UniversalAIRouter().routeDetailed('hi', [], 'navbharat', undefined, undefined, false, controller.signal)).ok).toBe(false);
    expect(first).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
  });
  it.each(['route', 'routeRaced'] as const)('%s abort during a health check does not walk later providers', async method => {
    let release!: (healthy: boolean) => void;
    const router = new AIRouter('health-cancel-test');
    const healthCheck = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const laterHealth = vi.fn(async () => true); const execute = vi.fn(async () => answer);
    router.registerProvider({ name: 'GLM', priority: 1, healthCheck, execute });
    router.registerProvider({ name: 'GROQ', priority: 2, healthCheck: laterHealth, execute });
    const controller = new AbortController();
    const pending = (method === 'route' ? router.route('hi', undefined, undefined, undefined, controller.signal)
      : router.routeRaced('hi', undefined, undefined, controller.signal)).catch(e => e);
    await flush(); controller.abort(new Error('caller left')); release(false);
    expect(await pending).toBeInstanceOf(Error); expect(laterHealth).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('raced nonstream sibling forwards cancellation and never enters last resort', async () => {
    let received: AbortSignal | undefined; let release!: () => void;
    const router = new AIRouter('cancel-race-test');
    const execute = vi.fn(async (...args: any[]) => { received = args[5]; await new Promise<void>((resolve, reject) => { release = resolve; received?.addEventListener('abort', () => reject(received!.reason), { once: true }); }); return answer; });
    const fallback = vi.fn(async () => answer);
    router.registerProvider({ name: 'GLM', priority: 1, execute, healthCheck: async () => true } as AIProvider);
    router.registerProvider({ name: 'GROQ', priority: 2, lastResort: true, execute: fallback, healthCheck: async () => true });
    const controller = new AbortController();
    const pending = router.routeRaced('hi', undefined, undefined, controller.signal).catch(e => e);
    await flush(); controller.abort(new Error('caller left')); release(); await pending;
    expect(received?.aborted).toBe(true); expect(fallback).not.toHaveBeenCalled();
    expect(getProviderStats().GLM.consecutiveFailures).toBe(0);
  });
});
