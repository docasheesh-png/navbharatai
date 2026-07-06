import { describe, it, expect } from 'vitest';
import { flushDecision } from './DurableFlush';

describe('flushDecision (autopsy: a burst must never starve the durable save)', () => {
  const MAX = 6_000;

  it('never-flushed sentinel (lastFlushAt<=0) flushes immediately — durable from the very start', () => {
    expect(flushDecision(0, 100, MAX)).toBe('flush-now');
    expect(flushDecision(-1, 5, MAX)).toBe('flush-now');
  });

  it('a recent flush → debounce (coalesce a quiet burst)', () => {
    expect(flushDecision(10_000, 12_000, MAX)).toBe('debounce'); // only 2s since last flush
    expect(flushDecision(10_000, 15_999, MAX)).toBe('debounce'); // 5.999s — still under the cap
  });

  it('overdue (≥ maxWaitMs since last flush) → flush NOW, even mid-burst', () => {
    expect(flushDecision(10_000, 16_000, MAX)).toBe('flush-now'); // exactly at the cap
    expect(flushDecision(10_000, 20_000, MAX)).toBe('flush-now');
  });

  it('THE BUG: a continuous burst (event every 1s) still flushes within maxWaitMs', () => {
    // Simulate the resetting-debounce failure: an event every 1s never lets a 3s trailing debounce fire.
    // With the bounded decision, a flush is FORCED once the cap elapses — worst-case loss is bounded.
    // Start already-flushed (realistic epoch-ish) so this purely tests the max-wait forced flush.
    let lastFlush = 1_000_000;
    let flushes = 0;
    for (let t = 1_000_000; t <= 1_020_000; t += 1_000) {
      if (flushDecision(lastFlush, t, MAX) === 'flush-now') { flushes++; lastFlush = t; }
    }
    // Forced every 6s across 20s of a solid burst: t=1_006_000, 1_012_000, 1_018_000 → ≥ 3 flushes.
    expect(flushes).toBeGreaterThanOrEqual(3);
  });

  it('a non-positive cap means always flush (throttling disabled)', () => {
    expect(flushDecision(10_000, 10_000, 0)).toBe('flush-now');
    expect(flushDecision(10_000, 10_001, -1)).toBe('flush-now');
  });
});
