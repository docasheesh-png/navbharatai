import { describe, it, expect } from 'vitest';
import { CircuitBreaker, getBreaker, allBreakerNames, resetAllBreakers } from './CircuitBreaker';

describe('CircuitBreaker (P1.3)', () => {
  const T0 = 1_000_000; // fixed virtual "now" base (deterministic, no real timers)

  describe('CLOSED → OPEN → HALF_OPEN → CLOSED lifecycle', () => {
    it('starts CLOSED and not blocking', () => {
      const b = new CircuitBreaker();
      expect(b.state(T0)).toBe('closed');
      expect(b.isBlocking(T0)).toBe(false);
    });

    it('a failure opens the breaker and blocks until the cooldown elapses', () => {
      const b = new CircuitBreaker();
      const until = b.recordFailure(10_000, T0);
      expect(until).toBe(T0 + 10_000);
      expect(b.state(T0)).toBe('open');
      expect(b.isBlocking(T0)).toBe(true);
      // 1ms before deadline → still open/blocking
      expect(b.isBlocking(T0 + 9_999)).toBe(true);
    });

    it('once the cooldown elapses it becomes HALF_OPEN (not blocking — allows a trial)', () => {
      const b = new CircuitBreaker();
      b.recordFailure(10_000, T0);
      expect(b.state(T0 + 10_000)).toBe('half_open');
      expect(b.isBlocking(T0 + 10_000)).toBe(false);
      expect(b.state(T0 + 50_000)).toBe('half_open');
    });

    it('a successful trial in HALF_OPEN closes the breaker and resets the streak', () => {
      const b = new CircuitBreaker();
      b.recordFailure(10_000, T0);
      b.recordSuccess();
      expect(b.state(T0 + 10_000)).toBe('closed');
      expect(b.isBlocking(T0 + 10_000)).toBe(false);
      expect(b.snapshot(T0).consecutiveFailures).toBe(0);
    });

    it('a failed trial in HALF_OPEN re-opens the breaker', () => {
      const b = new CircuitBreaker({ failureThreshold: 3 });
      b.recordFailure(10_000, T0);              // fail 1 → open
      const t1 = T0 + 10_000;                   // now half_open
      expect(b.state(t1)).toBe('half_open');
      b.recordFailure(10_000, t1);              // failed trial → fail 2, re-open
      expect(b.state(t1)).toBe('open');
      expect(b.isBlocking(t1)).toBe(true);
    });
  });

  describe('escalation (consecutive failures lengthen the cooldown, capped)', () => {
    it('below the threshold the cooldown equals exactly what the caller requests', () => {
      const b = new CircuitBreaker({ failureThreshold: 3 });
      expect(b.recordFailure(10_000, T0)).toBe(T0 + 10_000);          // fail 1
      expect(b.recordFailure(10_000, T0)).toBe(T0 + 10_000);          // fail 2 (still < threshold)
    });

    it('at/after the threshold the cooldown doubles per extra failure', () => {
      const b = new CircuitBreaker({ failureThreshold: 3, baseCooldownMs: 10_000, maxCooldownMs: 1_000_000 });
      b.recordFailure(10_000, T0); // 1
      b.recordFailure(10_000, T0); // 2
      expect(b.recordFailure(10_000, T0)).toBe(T0 + 20_000);  // 3 → over=1 → ×2
      expect(b.recordFailure(10_000, T0)).toBe(T0 + 40_000);  // 4 → over=2 → ×4
      expect(b.recordFailure(10_000, T0)).toBe(T0 + 80_000);  // 5 → over=3 → ×8
    });

    it('never exceeds maxCooldownMs', () => {
      const b = new CircuitBreaker({ failureThreshold: 1, baseCooldownMs: 100_000, maxCooldownMs: 150_000 });
      // threshold=1 → every failure escalates; the cap must hold.
      let until = T0;
      for (let i = 0; i < 10; i++) until = b.recordFailure(100_000, T0);
      expect(until - T0).toBe(150_000);
    });

    it('uses the configured base cooldown when none is supplied', () => {
      const b = new CircuitBreaker({ baseCooldownMs: 7_500 });
      expect(b.recordFailure(undefined, T0)).toBe(T0 + 7_500);
      expect(b.recordFailure(0, T0)).toBe(T0 + 7_500); // 0 is treated as "unspecified"
    });
  });

  describe('honorRemoteOpenUntil (cross-instance sync)', () => {
    it('adopts a later remote deadline and marks the provider as failing', () => {
      const b = new CircuitBreaker();
      b.honorRemoteOpenUntil(T0 + 30_000);
      expect(b.isBlocking(T0)).toBe(true);
      expect(b.snapshot(T0).consecutiveFailures).toBeGreaterThanOrEqual(1);
    });

    it('never shortens a longer local cooldown', () => {
      const b = new CircuitBreaker();
      b.recordFailure(60_000, T0);             // local open until T0+60s
      b.honorRemoteOpenUntil(T0 + 10_000);     // shorter remote → ignored
      expect(b.snapshot(T0).openedUntil).toBe(T0 + 60_000);
    });
  });

  describe('snapshot', () => {
    it('reflects state, deadline, and failure count', () => {
      const b = new CircuitBreaker();
      b.recordFailure(10_000, T0);
      const s = b.snapshot(T0);
      expect(s).toEqual({ state: 'open', openedUntil: T0 + 10_000, consecutiveFailures: 1 });
    });
  });

  describe('registry (getBreaker / allBreakerNames / resetAllBreakers)', () => {
    it('returns the same breaker instance per name and lists names', () => {
      resetAllBreakers();
      const a = getBreaker('GEMINI');
      const a2 = getBreaker('GEMINI');
      const c = getBreaker('GROK');
      expect(a).toBe(a2);
      expect(a).not.toBe(c);
      expect(allBreakerNames().sort()).toEqual(['GEMINI', 'GROK']);
      resetAllBreakers();
      expect(allBreakerNames()).toEqual([]);
    });
  });
});
