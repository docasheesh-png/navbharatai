import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider, AIProviderResponse } from './ProviderTypes';

// P2.3 — bulkhead isolation: each universe has its OWN in-flight pool. These tests use a
// fresh module per test (vi.resetModules) so the module-level inFlight map starts clean.
let AIRouterClass: any;
let getProviderStats: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./AIRouter');
  AIRouterClass = mod.AIRouter;
  getProviderStats = mod.getProviderStats;
});

/** A provider whose execute() never resolves — used to HOLD in-flight slots. */
function hangingProvider(name: AIProvider['name'], priority = 1): AIProvider {
  return {
    name,
    priority,
    execute: vi.fn().mockReturnValue(new Promise<AIProviderResponse>(() => {})), // never resolves
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AIRouter bulkhead isolation (P2.3)', () => {
  it('a FREE-universe spike that saturates a provider does NOT starve the PRO universe', async () => {
    const free = new AIRouterClass('free');
    const pro = new AIRouterClass('pro');
    free.registerProvider(hangingProvider('GEMINI', 1));
    pro.registerProvider(hangingProvider('GEMINI', 1));

    // Saturate FREE's GEMINI pool with 8 hanging requests (MAX_IN_FLIGHT).
    for (let i = 0; i < 8; i++) void free.route('hi');
    await flush();

    const afterFree = getProviderStats().GEMINI;
    expect(afterFree.inFlightByUniverse.free).toBe(8);     // FREE pool is full
    expect(afterFree.inFlightByUniverse.pro ?? 0).toBe(0); // PRO pool untouched

    // A 9th FREE request is rejected for capacity in BOTH passes → graceful fallback.
    const ninthFree = await free.route('hi');
    expect(ninthFree.telemetry.success).toBe(false);

    // PRO can STILL acquire a slot — its pool is isolated from FREE's saturation.
    void pro.route('hi');
    await flush();
    const afterPro = getProviderStats().GEMINI;
    expect(afterPro.inFlightByUniverse.pro).toBe(1);       // PRO got through
    expect(afterPro.inFlightByUniverse.free).toBe(8);      // FREE still capped at 8
  });

  it('getProviderStats aggregates inFlight across universes (total + per-universe)', async () => {
    const free = new AIRouterClass('free');
    const pro = new AIRouterClass('pro');
    free.registerProvider(hangingProvider('GROK', 1));
    pro.registerProvider(hangingProvider('GROK', 1));

    void free.route('a');
    void free.route('b');
    void pro.route('c');
    await flush();

    const stats = getProviderStats().GROK;
    expect(stats.inFlight).toBe(3); // 2 free + 1 pro
    expect(stats.inFlightByUniverse).toEqual({ free: 2, pro: 1 });
  });

  it('defaults to the "default" universe when none is given (back-compat)', async () => {
    const r = new AIRouterClass();
    r.registerProvider(hangingProvider('VERTEX', 1));
    void r.route('x');
    await flush();
    const stats = getProviderStats().VERTEX;
    expect(stats.inFlight).toBe(1);
    expect(stats.inFlightByUniverse.default).toBe(1);
  });
});
