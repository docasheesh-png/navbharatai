// AUTOPSY 303e8a6f (2026-10-12), item J — the user stopped at 36 s. The tested AI-image template (14 files) had been
// seeded at 11 s, saved durably and opened in the preview. Then two sentences, both false:
//   "Stopped, as you asked. Nothing had been written yet, so nothing was lost."
//   "🛡️ You stopped this build before anything was produced, so it is FREE — no charge. Your workspace is exactly as it was."
// The workspace held our 11-file starter before the build and the 14-file AI-image app after it.
//
// The CLASS: an ending describes the workspace with a yes/no ("did the model write anything") when the question has
// THREE answers — the build's own work, only what the platform seeded (a template, a game kit, a pasted page), or
// nothing. Autopsy 2b0a3ed5 moved the template from "your files are saved" to the other side of the yes/no, which
// traded one false sentence for another; 120eb52f split only the edit case. Each sentence now has a third state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { abortSummary, timedOutSummary, stalledModelSummary, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { decideCancelledBuildBill, freeCancellationMessage } from '../src/server/AgentV3/cancelledBuildBilling';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { modelAuthoredPaths } from '../src/server/AgentV3/platformAuthored';

const FALSE_EMPTY = /Nothing had been written|nothing had been produced|before anything was produced|before it produced anything|exactly as it was/i;
const CAUSES: AbortCause[] = ['user-stop', 'watchdog', 'advisory-cap', 'deploy-drain', 'lock-reclaimed', 'reaper', 'cost-cap', 'futile', 'unknown'];

describe('1 · the report\'s stop: our template in the workspace, nothing of the build\'s own', () => {
  const template = new Map(Object.entries(goldenScaffoldFiles(GOLDEN_SCAFFOLDS.find((g) => g.id === 'ai-image')!)));

  it('the bill is still free, and its state is "seed-only", not "nothing"', () => {
    expect(template.size).toBeGreaterThan(10);
    expect(modelAuthoredPaths(template)).toEqual([]); // the route's own definition: none of it is the model's
    const bill = decideCancelledBuildBill({ abortCause: 'user-stop', appRendered: false, decidedBilledUsd: 0.0068, filesWritten: template.size, preseededUnchanged: template.size });
    expect(bill.billedUsd).toBe(0);
    expect(bill.delivery).toBe('seed-only');
  });

  it('both sentences the user reads say the starting files are there, and how to go on', () => {
    const bill = decideCancelledBuildBill({ abortCause: 'user-stop', appRendered: false, decidedBilledUsd: 0.0068, filesWritten: template.size, preseededUnchanged: template.size });
    const summary = abortSummary('user-stop', { builtSomething: modelAuthoredPaths(template).length > 0, seededOnly: template.size > 0 });
    const narration = freeCancellationMessage(bill.delivery);
    for (const line of [summary, narration]) {
      expect(line).not.toMatch(FALSE_EMPTY);
      expect(line).toMatch(/starting files/);
      expect(line).toMatch(/continue/i);
    }
  });

  it('🔒 every cause that can end a seeded build says the same true thing', () => {
    for (const cause of CAUSES) {
      const line = abortSummary(cause, { builtSomething: false, seededOnly: true, minutes: 30 });
      expect(line, cause).not.toMatch(FALSE_EMPTY);
    }
    for (const line of [timedOutSummary(30, { seededOnly: true }), stalledModelSummary(3, { seededOnly: true })]) {
      expect(line).not.toMatch(FALSE_EMPTY);
      expect(line).toMatch(/starting files/);
    }
  });
});

describe('2 · the other two states are unchanged', () => {
  it('nothing written at all still says nothing was written', () => {
    expect(abortSummary('user-stop', { builtSomething: false })).toBe('Stopped, as you asked. Nothing had been written yet, so nothing was lost.');
    expect(decideCancelledBuildBill({ abortCause: 'user-stop', appRendered: false, decidedBilledUsd: 0.01, filesWritten: 0 }).delivery).toBe('nothing');
    expect(freeCancellationMessage('nothing')).toMatch(/exactly as it was/);
  });

  it('the build\'s own work still says it is saved — the seed clause never overrides it', () => {
    expect(abortSummary('user-stop', { builtSomething: true, seededOnly: true })).toMatch(/Your files so far are saved/);
    expect(timedOutSummary(30, { builtSomething: true, seededOnly: true })).toMatch(/Your files so far are saved/);
  });
});

describe('3 · 🔒 one source per sentence, wired from the route', () => {
  const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the runner hands the third state to every ending and keeps no inline copy of a stop sentence', () => {
    expect(runner).toContain('seededOnly: !builtSomething && this.opts.hasSeededFiles?.() === true');
    expect(runner).toContain('timedOutSummary(minutes, ending)');
    expect(runner).toContain('stalledModelSummary(minutes, ending)');
    expect(runner).not.toMatch(/Nothing was lost/);
  });

  it('the route tells the runner what it seeded', () => {
    expect(route).toContain('hasSeededFiles: () => writtenFiles.size > 0,');
  });
});
