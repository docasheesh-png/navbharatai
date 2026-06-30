import { describe, it, expect } from 'vitest';
import { recordRun, flakinessRate, isFlaky, loadHistory, serializeHistory } from '../src/lib/flakyTests';

/** P-TQA.8 — flaky test detection (pure). */

describe('recordRun', () => {
  it('appends outcomes and caps history at 20', () => {
    let h = {};
    for (let i = 0; i < 25; i++) h = recordRun(h, 't1', i % 2 === 0);
    expect(h['t1']).toHaveLength(20);
  });
  it('ignores empty test id and does not mutate input', () => {
    const orig = { t1: [true] };
    expect(recordRun(orig, '', true)).toBe(orig);
    recordRun(orig, 't1', false);
    expect(orig).toEqual({ t1: [true] });
  });
});

describe('flakinessRate', () => {
  it('is the fraction of failing runs', () => {
    expect(flakinessRate({ t: [true, false, true, false] }, 't')).toBe(0.5);
    expect(flakinessRate({ t: [true, true] }, 't')).toBe(0);
    expect(flakinessRate({}, 'missing')).toBe(0);
  });
});

describe('isFlaky', () => {
  it('flags a test that alternates pass/fail over enough runs', () => {
    const h = { t: [true, false, true, false, true] }; // 5 runs, 40% fail
    expect(isFlaky(h, 't')).toBe(true);
  });
  it('does NOT flag too-few runs, all-pass, or all-fail', () => {
    expect(isFlaky({ t: [true, false] }, 't')).toBe(false); // < 5 runs
    expect(isFlaky({ t: [true, true, true, true, true] }, 't')).toBe(false); // all pass
    expect(isFlaky({ t: [false, false, false, false, false] }, 't')).toBe(false); // all fail = broken, not flaky
  });
  it('does NOT flag a stable test with one blip below threshold', () => {
    const h = { t: [true, true, true, true, true, true, true, true, true, false] }; // 10% fail < 20%
    expect(isFlaky(h, 't')).toBe(false);
  });
});

describe('persistence round-trip', () => {
  it('round-trips and sanitises junk', () => {
    const h = { a: [true, false], b: [true] };
    expect(loadHistory(serializeHistory(h))).toEqual(h);
    expect(loadHistory(null)).toEqual({});
    expect(loadHistory('nope')).toEqual({});
    expect(loadHistory(JSON.stringify({ a: [true, 'x', false, 1] }))).toEqual({ a: [true, false] });
  });
});
