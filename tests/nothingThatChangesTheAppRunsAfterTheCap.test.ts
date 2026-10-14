import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { finishingPassMayRun, capStoppedTheRun, finishingPassesHeldNote, recordFinishingPassesHeld } from '../src/server/AgentV3/finishingPassesAtCap';

/**
 * Q-1069 (autopsy 398db9f3): after the 25-minute cap, 16 files were written into an app that could not be
 * re-opened ("nothing is known about whether they broke it"). The CLASS: a pass meant to be verified
 * afterwards runs when no verification is possible. Every pass that writes into the app on the finishing
 * path must ask `finishingPassMayRun(result)` first.
 */
describe('after the wall-clock cap, passes that change the app wait', () => {
  it('a capped run holds them; an ordinary or missing result does not', () => {
    expect(finishingPassMayRun({ timedOut: true })).toBe(false);
    expect(capStoppedTheRun({ timedOut: true })).toBe(true);
    expect(finishingPassMayRun({ timedOut: false })).toBe(true);
    expect(finishingPassMayRun({})).toBe(true);
    expect(finishingPassMayRun(null)).toBe(true);
  });

  it('the report line says what waited and why, and records at info', () => {
    expect(finishingPassesHeldNote(['a', 'b'])).toContain('a and b did not write into the app');
    const rows: Array<{ code: string; severity: string }> = [];
    recordFinishingPassesHeld({ record: (r) => { rows.push(r); } });
    expect(rows).toEqual([expect.objectContaining({ code: 'FINISHING_PASSES_HELD_AT_CAP', severity: 'info' })]);
  });

  it('the route gates BOTH finishing writers and records the hold', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/importSweepEnabled\(\) && finishingPassMayRun\(result\)/);
    expect(route).toMatch(/writtenFiles\.size > 0 && finishingPassMayRun\(result\)\) \{\s*await runInPass\('production-defaults'/);
    expect(route).toContain('recordFinishingPassesHeld(buildDiag);');
  });
});
