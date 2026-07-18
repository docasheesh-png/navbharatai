import { describe, it, expect } from 'vitest';
import {
  TokenBucket, AimdConcurrency, isThrottleSignal, pacerEnabled, pacerConfigFromEnv, RateLimitPacer,
} from './RateLimitPacer';

describe('TokenBucket — paces requests to stay under the rate', () => {
  it('allows a burst up to the bucket size, then blocks until refill', () => {
    const b = new TokenBucket(2 /* per sec */, 3 /* burst */, 0);
    expect(b.tryTake(0)).toBe(true);  // 3 → 2
    expect(b.tryTake(0)).toBe(true);  // 2 → 1
    expect(b.tryTake(0)).toBe(true);  // 1 → 0
    expect(b.tryTake(0)).toBe(false); // empty
    expect(b.msUntilToken(0)).toBe(500); // 2/sec → 1 token in 500ms
  });

  it('refills over time and never exceeds the burst', () => {
    const b = new TokenBucket(2, 3, 0);
    for (let i = 0; i < 3; i++) b.tryTake(0);       // drain
    expect(b.tryTake(500)).toBe(true);              // +1 token at 500ms
    expect(b.tryTake(500)).toBe(false);
    // after a long idle, cap at burst (not unbounded)
    expect(b.msUntilToken(100000)).toBe(0);
    let taken = 0;
    for (let i = 0; i < 10; i++) if (b.tryTake(100000)) taken++;
    expect(taken).toBe(3); // capped at burst, not 10
  });
});

describe('AimdConcurrency — additive-increase / multiplicative-decrease', () => {
  it('halves on a throttle and never drops below the floor', () => {
    const a = new AimdConcurrency(2, 16, 16);
    expect(a.limit).toBe(16);
    a.onThrottle(); expect(a.limit).toBe(8);
    a.onThrottle(); expect(a.limit).toBe(4);
    a.onThrottle(); expect(a.limit).toBe(2);
    a.onThrottle(); expect(a.limit).toBe(2); // floor holds
  });

  it('recovers slowly on success (additive), never above the ceiling', () => {
    const a = new AimdConcurrency(2, 8, 2);
    // ~2 successes to add the first permit at limit 2
    a.onSuccess(); a.onSuccess();
    expect(a.limit).toBe(3);
    for (let i = 0; i < 200; i++) a.onSuccess();
    expect(a.limit).toBe(8); // capped at max
  });
});

describe('isThrottleSignal — recognises 429 / timeout / overload', () => {
  it('flags rate-limit + timeout classes', () => {
    expect(isThrottleSignal({ status: 429 })).toBe(true);
    expect(isThrottleSignal({ status: 529 })).toBe(true);
    expect(isThrottleSignal(new Error('Request timed out.'))).toBe(true);
    expect(isThrottleSignal(new Error('429 Too Many Requests'))).toBe(true);
    expect(isThrottleSignal(new Error('provider overloaded'))).toBe(true);
    expect(isThrottleSignal(new Error('ETIMEDOUT'))).toBe(true);
  });
  it('does NOT flag an ordinary application error', () => {
    expect(isThrottleSignal(new Error('tools: Tool names must be unique'))).toBe(false);
    expect(isThrottleSignal({ status: 400 })).toBe(false);
    expect(isThrottleSignal(null)).toBe(false);
  });
});

describe('pacer flag + config', () => {
  it('is OFF unless AGENTV3_RATE_PACER=on', () => {
    expect(pacerEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pacerEnabled({ AGENTV3_RATE_PACER: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(pacerEnabled({ AGENTV3_RATE_PACER: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('reads margin-safe defaults, overridable by env', () => {
    expect(pacerConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({ ratePerSec: 8, burst: 8, minConcurrency: 2, maxConcurrency: 8 });
    const c = pacerConfigFromEnv({ AGENTV3_PACER_RATE_PER_SEC: '3', AGENTV3_PACER_MAX_CONCURRENCY: '20' } as unknown as NodeJS.ProcessEnv);
    expect(c.ratePerSec).toBe(3);
    expect(c.maxConcurrency).toBe(20);
  });
});

describe('RateLimitPacer.run — paces + adapts, never changes the result', () => {
  const noWait = { now: () => 0, sleep: async () => {} }; // deterministic: no real timers

  it('returns the fn result unchanged on success and grows concurrency', async () => {
    const p = new RateLimitPacer({ ratePerSec: 1000, burst: 1000, minConcurrency: 2, maxConcurrency: 8 }, noWait);
    const r = await p.run(async () => 'built');
    expect(r).toBe('built');
  });

  it('re-throws the error unchanged and backs off concurrency on a throttle', async () => {
    const p = new RateLimitPacer({ ratePerSec: 1000, burst: 1000, minConcurrency: 1, maxConcurrency: 8 }, noWait);
    const before = p.concurrencyLimit;
    await expect(p.run(async () => { throw Object.assign(new Error('Request timed out.'), { status: undefined }); }))
      .rejects.toThrow('Request timed out.');
    expect(p.concurrencyLimit).toBeLessThanOrEqual(before); // shrank (or held at floor)
  });

  it('a NON-throttle error does not shrink concurrency (only real capacity signals do)', async () => {
    const p = new RateLimitPacer({ ratePerSec: 1000, burst: 1000, minConcurrency: 2, maxConcurrency: 8, }, noWait);
    // Drive concurrency up first.
    for (let i = 0; i < 20; i++) await p.run(async () => 1);
    const grown = p.concurrencyLimit;
    await expect(p.run(async () => { throw new Error('duplicate identifier'); })).rejects.toThrow('duplicate identifier');
    expect(p.concurrencyLimit).toBe(grown); // unchanged by a non-throttle error
  });
});
