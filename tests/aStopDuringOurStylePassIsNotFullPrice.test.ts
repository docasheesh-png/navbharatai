import { describe, it, expect, afterEach } from 'vitest';
import { decideCancelledBuildBill, stopFellInWindow, closeStylePassWindow } from '../src/server/AgentV3/cancelledBuildBilling';

// Owner 2026-10-18 (r6–r10 autopsy): a stop during OUR style-floor pass, after the model finished, is never full price.
const ranFirst = {
  abortCause: 'user-stop' as const, filesWritten: 10, appRendered: true,
  appRenderedAt: 1000, stopRequestedAt: 2000,
  decidedBilledUsd: 1.0, realCostUsd: 0.3, sandboxUsd: 0.05,
};
afterEach(() => { delete process.env.AGENTV3_STYLE_PASS_STOP_AT_COST; });

describe('a stop during our style pass is not full price', () => {
  it('running before the stop, but stopped during our style pass → at cost', () => {
    const b = decideCancelledBuildBill({ ...ranFirst, stoppedDuringOurStylePass: true });
    expect(b.billedUsd).toBeCloseTo(0.35, 6);
    expect(b.reason).toMatch(/style-floor pass/);
  });
  it('not during our pass → the (g) rule: full price', () => {
    expect(decideCancelledBuildBill({ ...ranFirst, stoppedDuringOurStylePass: false }).billedUsd).toBe(1.0);
  });
  it('AGENTV3_STYLE_PASS_STOP_AT_COST=off restores full price', () => {
    process.env.AGENTV3_STYLE_PASS_STOP_AT_COST = 'off';
    expect(decideCancelledBuildBill({ ...ranFirst, stoppedDuringOurStylePass: true }).billedUsd).toBe(1.0);
  });
  it('the window: started, open or closed after the stop', () => {
    expect(stopFellInWindow(2000, 1500, null)).toBe(true);
    expect(stopFellInWindow(2000, 1500, 2500)).toBe(true);
    expect(stopFellInWindow(2000, 1500, 1800)).toBe(false);
    expect(stopFellInWindow(2000, 2500, null)).toBe(false);
    expect(stopFellInWindow(2000, null, null)).toBe(false);
    const w = { startedAt: 1, endedAt: null as number | null };
    closeStylePassWindow(w, 5); closeStylePassWindow(w, 9);
    expect(w.endedAt).toBe(5);
    const never = { startedAt: null, endedAt: null as number | null };
    closeStylePassWindow(never, 5);
    expect(never.endedAt).toBeNull();
  });
});
