import { describe, it, expect, afterEach } from 'vitest';
import { decideCancelledBuildBill, renderedBeforeStop } from '../src/server/AgentV3/cancelledBuildBilling';
import { abortBuild, abortCauseOf, abortRequestedAtOf } from '../src/server/AgentV3/buildAbortCause';

// Owner 2026-10-18 (r6–r10 autopsy): a stop is charged full price only when the app was seen running
// BEFORE the stop was requested; otherwise at our cost.
const base = {
  abortCause: 'user-stop' as const, filesWritten: 10, appRendered: true,
  decidedBilledUsd: 1.0, realCostUsd: 0.3, sandboxUsd: 0.05,
};

afterEach(() => { delete process.env.AGENTV3_STOP_FULL_NEEDS_GREEN_FIRST; });

describe('a stop is full price only if the app ran first', () => {
  it('running before the stop request → full price', () => {
    const b = decideCancelledBuildBill({ ...base, appRenderedAt: 1000, stopRequestedAt: 2000 });
    expect(b.delivery).toBe('working-app');
    expect(b.billedUsd).toBe(1.0);
  });
  it('first seen running AFTER the stop request → at cost', () => {
    const b = decideCancelledBuildBill({ ...base, appRenderedAt: 3000, stopRequestedAt: 2000 });
    expect(b.delivery).toBe('running-not-before-stop');
    expect(b.billedUsd).toBeCloseTo(0.35, 6);
    expect(b.userMessage).not.toMatch(/half/i);
  });
  it('unknown render time (ledger-only proof) → at cost, never assumed first', () => {
    const b = decideCancelledBuildBill({ ...base, appRenderedAt: null, stopRequestedAt: 2000 });
    expect(b.billedUsd).toBeCloseTo(0.35, 6);
  });
  it('at cost never exceeds the decided bill', () => {
    const b = decideCancelledBuildBill({ ...base, realCostUsd: 5, appRenderedAt: 3000, stopRequestedAt: 2000 });
    expect(b.billedUsd).toBe(1.0);
  });
  it('AGENTV3_STOP_FULL_NEEDS_GREEN_FIRST=off restores rendered ⇒ full', () => {
    process.env.AGENTV3_STOP_FULL_NEEDS_GREEN_FIRST = 'off';
    expect(decideCancelledBuildBill({ ...base, appRenderedAt: 3000, stopRequestedAt: 2000 }).billedUsd).toBe(1.0);
  });
  it('renderedBeforeStop needs both times and strict order', () => {
    expect(renderedBeforeStop({ appRenderedAt: 1, stopRequestedAt: 2 })).toBe(true);
    expect(renderedBeforeStop({ appRenderedAt: 2, stopRequestedAt: 2 })).toBe(false);
    expect(renderedBeforeStop({ appRenderedAt: 1, stopRequestedAt: null })).toBe(false);
  });
});

describe('the abort records WHEN the stop was requested', () => {
  it('a typed stop carries the time of the message, not of the abort', () => {
    const c = new AbortController();
    abortBuild(c, 'user-stop', 12345);
    expect(abortCauseOf(c.signal)).toBe('user-stop');
    expect(abortRequestedAtOf(c.signal)).toBe(12345);
  });
  it('the Stop button defaults to now', () => {
    const c = new AbortController();
    const before = Date.now();
    abortBuild(c, 'user-stop');
    expect(abortRequestedAtOf(c.signal)!).toBeGreaterThanOrEqual(before);
  });
  it('an unrecorded abort has no request time', () => {
    const c = new AbortController(); c.abort();
    expect(abortRequestedAtOf(c.signal)).toBeNull();
  });
});
