// 🔴 A RENDERED APP IS CHECKED FOR "DONE" AT ONCE — NOT ON THE NEXT 10TH STEP (failedbr #2470, 99771bc7, 2026-11-18).
//
// "Business Game": the architect delegated the board to a frontend agent and took only 8 steps in all, so the done
// check (every 10th step, from step 8) never ran. The app rendered in a real browser at 218 s; the architect then
// started four reviewers in parallel, the live line said "your app is already running — I'm finishing it", and the
// user pressed Stop at 263 s: READY_BEFORE_END "never judged finished", gate RED. A step is not a unit of progress
// when one step is a whole delegated build — the render is the evidence the warm-up waits for.
// Reversion: drop the `renderedUnchecked` line from shouldCheckDone and the first block fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldCheckDone, doneSignalConfig } from '../src/server/AgentV3/doneSignal';

const cfg = doneSignalConfig({} as NodeJS.ProcessEnv);
const base = { cfg, toolUses: 12, alreadySignalled: false, wroteThisRun: true };

describe('the render opens the check', () => {
  it('the #2470 shape: step 4 of a delegating architect, app on screen ⇒ check now', () => {
    expect(shouldCheckDone({ ...base, step: 4, renderedUnchecked: true })).toBe(true);
    expect(shouldCheckDone({ ...base, step: 7, renderedUnchecked: true })).toBe(true);
  });
  it('without a render the step cadence is unchanged (warm-up and every 10th step)', () => {
    expect(shouldCheckDone({ ...base, step: 4 })).toBe(false);
    expect(shouldCheckDone({ ...base, step: 7, renderedUnchecked: false })).toBe(false);
    expect(shouldCheckDone({ ...base, step: 10 })).toBe(true);
  });
  it('every older guard still wins over a render', () => {
    const r = { ...base, step: 4, renderedUnchecked: true };
    expect(shouldCheckDone({ ...r, alreadySignalled: true })).toBe(false);
    expect(shouldCheckDone({ ...r, editingExistingApp: true })).toBe(false);
    expect(shouldCheckDone({ ...r, projectModule: 'payments' })).toBe(false);
    expect(shouldCheckDone({ ...r, wroteThisRun: false })).toBe(false);
    expect(shouldCheckDone({ ...r, lastStepFailed: true })).toBe(false);
    expect(shouldCheckDone({ ...r, toolUses: 0 })).toBe(false);
    expect(shouldCheckDone({ ...r, cfg: { ...cfg, enabled: false } })).toBe(false);
  });
});

describe('the wiring (source, comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const runner = strip(readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8'));
  const route = strip(readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8'));
  it('both shouldCheckDone calls in the runner pass the render fact, and a check records when it ran', () => {
    const calls = runner.split("\n").filter((l) => l.includes("shouldCheckDone({"));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain('renderedUnchecked');
    expect(runner).toMatch(/renderedUnchecked = renderedAt > 0 && doneLastCheckedAt < renderedAt/);
    expect(runner).toMatch(/doneLastCheckedAt = Date\.now\(\)/);
  });
  it("the route hands the runner THIS turn's render time (the one set only when this turn wrote), as a getter", () => {
    expect(route).toMatch(/appRenderedAt: \(\) => etaAppRenderedAt/);
  });
});
