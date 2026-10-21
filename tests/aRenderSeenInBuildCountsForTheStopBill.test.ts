import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideCancelledBuildBill, earliestRenderProof } from '../src/server/AgentV3/cancelledBuildBilling';

// Autopsy a75153ab (2026-10-21): the app rendered at 261 s (in-build green), the user stopped at 380 s, and the bill
// said "you stopped before the app was running" because only the post-answer clock reached billing.
const base = { abortCause: 'user-stop' as const, filesWritten: 20, appRendered: true, decidedBilledUsd: 1, realCostUsd: 0.2, sandboxUsd: 0.02 };

describe('the earliest render proof feeds the stop bill', () => {
  it('earliest valid time wins; junk is ignored', () => {
    expect(earliestRenderProof(5, 3, null, undefined, NaN, 0, -1)).toBe(3);
    expect(earliestRenderProof(null, undefined)).toBeNull();
  });
  it('the real case: in-build proof at +261 s, later pass after the stop → working-app, not "before it ran"', () => {
    const t0 = 1_000_000;
    const at = earliestRenderProof(t0 + 383_000, t0 + 261_000);
    const b = decideCancelledBuildBill({ ...base, appRenderedAt: at, stopRequestedAt: t0 + 380_000 });
    expect(b.delivery).toBe('working-app');
  });
  it('a render that truly came after the stop is still at cost', () => {
    const b = decideCancelledBuildBill({ ...base, appRenderedAt: earliestRenderProof(3000), stopRequestedAt: 2000 });
    expect(b.delivery).toBe('running-not-before-stop');
  });
  it('source guard: the in-build green producer and both billing points use the shared clock', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/billingCtx\.appFirstRenderedAt = earliestRenderProof\(billingCtx\.appFirstRenderedAt, inBuildGreenAt\)/);
    expect(src).toMatch(/appRenderedAt: earliestRenderProof\(appFirstRenderedAt, billingCtx\.appFirstRenderedAt\)/);
  });
});
