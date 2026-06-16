import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider, AIProviderResponse } from './ProviderTypes';

// cooldownUntil / inFlight / latencyAccum are module-level singleton Maps in
// AIRouter.ts, shared across every test unless the module is freshly
// re-imported. vi.resetModules() + a dynamic import in beforeEach guarantees
// each test starts from a clean slate.
let AIRouterClass: any;
let getProviderStats: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./AIRouter');
  AIRouterClass = mod.AIRouter;
  getProviderStats = mod.getProviderStats;
});

function makeProvider(name: AIProvider['name'], priority: number, overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name,
    priority,
    execute: vi.fn().mockResolvedValue({ content: 'ok', latencyMs: 1, provider: name, model: 'test' } as AIProviderResponse),
    healthCheck: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('AIRouter', () => {
  describe('registerProvider', () => {
    it('sorts providers by priority, earlier priority tried first', async () => {
      const router = new AIRouterClass();
      const low = makeProvider('GROK', 2);
      const high = makeProvider('GEMINI', 1);
      router.registerProvider(low);
      router.registerProvider(high);

      await router.route('hi');
      expect(high.execute).toHaveBeenCalled();
      expect(low.execute).not.toHaveBeenCalled();
    });
  });

  describe('route()', () => {
    it('returns the response from the first healthy provider', async () => {
      const router = new AIRouterClass();
      const p1 = makeProvider('GEMINI', 1);
      router.registerProvider(p1);

      const { response, telemetry } = await router.route('hello');
      expect(response.content).toBe('ok');
      expect(telemetry.provider).toBe('GEMINI');
      expect(telemetry.success).toBe(true);
    });

    it('skips a provider where healthCheck() returns false', async () => {
      const router = new AIRouterClass();
      const unhealthy = makeProvider('GEMINI', 1, { healthCheck: vi.fn().mockResolvedValue(false) });
      const healthy = makeProvider('GROK', 2);
      router.registerProvider(unhealthy);
      router.registerProvider(healthy);

      const { telemetry } = await router.route('hello');
      expect(unhealthy.execute).not.toHaveBeenCalled();
      expect(healthy.execute).toHaveBeenCalled();
      expect(telemetry.provider).toBe('GROK');
    });

    it('skips a provider on cooldown in pass 1 and retries it in pass 2', async () => {
      const router = new AIRouterClass();
      const execute = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ content: 'recovered', latencyMs: 1, provider: 'GEMINI', model: 'test' });
      const provider = makeProvider('GEMINI', 1, { execute });
      router.registerProvider(provider);

      // First call: pass 1 fails, sets cooldown; pass 2 (ignores cooldown) fails again.
      const first = await router.route('hello');
      expect(first.telemetry.success).toBe(false);
      expect(execute).toHaveBeenCalledTimes(2);

      // Second call: pass 1 must skip (still on cooldown) — no extra execute call —
      // then pass 2 retries regardless of cooldown and succeeds.
      const second = await router.route('hello');
      expect(second.response.content).toBe('recovered');
      expect(execute).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['429 Too Many Requests', 90],
      ['503 Service Unavailable', 45],
      ['Request timeout', 15],
      ['Unknown failure', 10],
    ])('sets a cooldown proportional to the error type (%s ~%ds base, ±20%% jitter)', async (msg, base) => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, { execute: vi.fn().mockRejectedValue(new Error(msg)) });
      router.registerProvider(provider);

      const before = Date.now();
      await router.route('hello');
      const stats = getProviderStats();
      const deltaSeconds = (stats.GEMINI.cooldownUntil - before) / 1000;

      expect(deltaSeconds).toBeGreaterThanOrEqual(base * 0.75);
      expect(deltaSeconds).toBeLessThanOrEqual(base * 1.25);
    });

    it('returns a graceful fallback message when all providers fail both passes', async () => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, { execute: vi.fn().mockRejectedValue(new Error('down')) });
      router.registerProvider(provider);

      const { response, telemetry } = await router.route('hello');
      expect(telemetry.success).toBe(false);
      expect(telemetry.provider).toBe('NONE');
      expect(response.content).toMatch(/temporarily busy/i);
    });

    it('releases the in-flight slot in the finally block even when execute() throws', async () => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, { execute: vi.fn().mockRejectedValue(new Error('down')) });
      router.registerProvider(provider);

      await router.route('hello');
      expect(getProviderStats().GEMINI.inFlight).toBe(0);
    });

    it('does not exceed MAX_IN_FLIGHT=8 concurrent slots for a single provider', async () => {
      const router = new AIRouterClass();
      let releaseAll: () => void = () => {};
      const pending = new Promise<AIProviderResponse>((resolve) => {
        releaseAll = () => resolve({ content: 'ok', latencyMs: 1, provider: 'GEMINI', model: 'test' });
      });
      const provider = makeProvider('GEMINI', 1, { execute: vi.fn().mockReturnValue(pending) });
      router.registerProvider(provider);

      // Fill all 8 concurrency slots with calls that never resolve yet.
      for (let i = 0; i < 8; i++) router.route('hello');
      // Let the microtask queue settle so acquireSlot() runs for each call.
      await new Promise((r) => setTimeout(r, 0));
      expect(getProviderStats().GEMINI.inFlight).toBe(8);

      // The 9th call must be skipped for capacity in both passes → graceful fallback.
      const ninth = await router.route('hello');
      expect(ninth.telemetry.success).toBe(false);
      expect(provider.execute).toHaveBeenCalledTimes(8);

      releaseAll();
    });
  });

  describe('routeStream()', () => {
    it('commits to the first provider that emits a chunk and discards the loser\'s chunks', async () => {
      const router = new AIRouterClass();
      const slow = makeProvider('GEMINI', 1, {
        executeStream: vi.fn().mockImplementation(async (_p: string, _s: string | undefined, onChunk: (t: string) => void) => {
          await new Promise((r) => setTimeout(r, 40));
          onChunk('slow-chunk');
          return 'slow-result';
        }),
      });
      const fast = makeProvider('GROK', 2, {
        executeStream: vi.fn().mockImplementation(async (_p: string, _s: string | undefined, onChunk: (t: string) => void) => {
          onChunk('fast-chunk');
          return 'fast-result';
        }),
      });
      router.registerProvider(slow);
      router.registerProvider(fast);

      const chunks: string[] = [];
      await router.routeStream('hello', undefined, (c: string) => chunks.push(c));

      expect(chunks).toContain('fast-chunk');
      expect(chunks).not.toContain('slow-chunk');
    });

    it('does not emit anything once the signal is already aborted', async () => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, { executeStream: vi.fn() });
      router.registerProvider(provider);

      const controller = new AbortController();
      controller.abort();

      const chunks: string[] = [];
      await router.routeStream('hello', undefined, (c: string) => chunks.push(c), controller.signal);

      expect(chunks).toHaveLength(0);
      expect(provider.executeStream).not.toHaveBeenCalled();
    });

    it('calls setCooldown (via getProviderStats) on a provider that throws during stream', async () => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, { executeStream: vi.fn().mockRejectedValue(new Error('stream-fail')) });
      router.registerProvider(provider);

      const before = Date.now();
      const chunks: string[] = [];
      await router.routeStream('hello', undefined, (c: string) => chunks.push(c));

      expect(getProviderStats().GEMINI.cooldownUntil).toBeGreaterThan(before);
      expect(chunks.join('')).toMatch(/busy/i);
    });
  });

  describe('generate()', () => {
    it('parses JSON from response.content', async () => {
      const router = new AIRouterClass();
      const provider = makeProvider('GEMINI', 1, {
        execute: vi.fn().mockResolvedValue({ content: '{"answer":42}', latencyMs: 1, provider: 'GEMINI', model: 'test' }),
      });
      router.registerProvider(provider);

      const result = await router.generate('hello', { type: 'OBJECT' });
      expect(result).toEqual({ answer: 42 });
    });
  });

  describe('getProviderStats()', () => {
    it('accumulates latency and error counts correctly', async () => {
      const router = new AIRouterClass();
      const execute = vi.fn()
        .mockResolvedValueOnce({ content: 'ok', latencyMs: 1, provider: 'GEMINI', model: 'test' })
        .mockRejectedValue(new Error('down'));
      const provider = makeProvider('GEMINI', 1, { execute });
      router.registerProvider(provider);

      await router.route('hello'); // succeeds — requestCount 1, errors 0
      const afterSuccess = getProviderStats().GEMINI;
      expect(afterSuccess.requestCount).toBe(1);
      expect(afterSuccess.errorCount).toBe(0);

      await router.route('hello'); // now always rejects — both passes fail
      const afterFailure = getProviderStats().GEMINI;
      expect(afterFailure.errorCount).toBeGreaterThanOrEqual(1);
      expect(afterFailure.requestCount).toBeGreaterThan(afterSuccess.requestCount);
    });
  });
});
