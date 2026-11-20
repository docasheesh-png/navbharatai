// 🔴 A READY APP IS DELIVERED, NOT POLISHED INTO THE TIME CAP (failedbr #2318, 19ae5fbb, 2026-11-12).
//
// "ROYAL ELECTRICAL SERVICES": the app rendered at 1011 s and the readiness check judged it finished (100/100, step 70).
// At 1340 s — 89% of the window, after the user had been told "Time is short — wrapping up so you get a working app" —
// the style hand-back sent it back for a missing empty state and one accessibility fix. The 25-minute cap cut it off,
// and a ready app ended "STOPPED — not converging".
// Reversion: make polishHandBackAllowed return true always and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { polishHandBackAllowed, budgetStage } from '../src/server/AgentV3/buildBudgetSteer';

describe('polish stops where wrapping up starts', () => {
  it('#2318: after "wrapping" (75%) or "final" (90%) no polish hand-back starts', () => {
    expect(polishHandBackAllowed(new Set(['half', 'wrapping']))).toBe(false);
    expect(polishHandBackAllowed(new Set(['half', 'wrapping', 'final']))).toBe(false);
    expect(budgetStage(1340_000, 1500_000)).toBe('wrapping'); // the report's moment
  });
  it('before wrapping up it is allowed, exactly as before', () => {
    expect(polishHandBackAllowed(new Set())).toBe(true);
    expect(polishHandBackAllowed(new Set(['half']))).toBe(true);
    expect(polishHandBackAllowed(undefined)).toBe(true);
  });
  it('both style hand-back sites in the runner ask it, and a stand-down is reported', () => {
    const runner = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toMatch(/const polishAllowed = polishHandBackAllowed\(events\.budgetStagesSaid\);/);
    expect(runner).toMatch(/readiness\.ready && styleResumes === 0 && polishAllowed && !this\.opts\.focusedRepair/);
    expect(runner).toMatch(/if \(decision\.resume && polishHandBackAllowed\(events\.budgetStagesSaid\)\) \{/);
    expect(runner).toMatch(/code: 'STYLE_RESUME_STOOD_DOWN'/);
  });
});
