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
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW: the first version promised "send a message and I'll continue from them"
// for every seed. For an untouched TEMPLATE that promise was false — the router reads the workspace as "only our
// starter" and builds the next message fresh. The way on is now named from the router's own test (`seedStateOf`),
// and §4 checks every sentence against what the next turn will actually do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { abortSummary, timedOutSummary, stalledModelSummary, seedKeptSentence, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { seedStateOf, holdsOnlyOurStarter, starterTemplates } from '../src/server/AgentV3/starterFragment';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { decideCancelledBuildBill, freeCancellationMessage } from '../src/server/AgentV3/cancelledBuildBilling';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { modelAuthoredPaths } from '../src/server/AgentV3/platformAuthored';

const FALSE_EMPTY = /Nothing had been written|nothing had been produced|before anything was produced|before it produced anything|exactly as it was/i;
const PROMISES_CONTINUE = /continue from/i;
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

  it('both sentences say the template is there and name the way on the router really takes', () => {
    expect(seedStateOf(template)).toBe('platform-template');
    const bill = decideCancelledBuildBill({ abortCause: 'user-stop', appRendered: false, decidedBilledUsd: 0.0068, filesWritten: template.size, preseededUnchanged: template.size });
    const summary = abortSummary('user-stop', { builtSomething: modelAuthoredPaths(template).length > 0, seed: seedStateOf(template) });
    const narration = freeCancellationMessage(bill.delivery);
    for (const line of [summary, narration]) {
      expect(line).not.toMatch(FALSE_EMPTY);
      expect(line).toMatch(/starting template is still in your workspace/);
      expect(line).toMatch(/send your request again/);
      expect(line).not.toMatch(PROMISES_CONTINUE);
    }
  });

  it('🔒 every cause that can end a seeded build says the same true thing, per seed', () => {
    for (const seed of ['platform-template', 'kept-seed'] as const) {
      for (const cause of CAUSES) {
        const line = abortSummary(cause, { builtSomething: false, seed, minutes: 30 });
        expect(line, `${cause}/${seed}`).not.toMatch(FALSE_EMPTY);
      }
      for (const line of [timedOutSummary(30, { seed }), stalledModelSummary(3, { seed })]) {
        expect(line).not.toMatch(FALSE_EMPTY);
        expect(line).toContain(seedKeptSentence(seed));
      }
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
    expect(abortSummary('user-stop', { builtSomething: true, seed: 'platform-template' })).toMatch(/Your files so far are saved/);
    expect(timedOutSummary(30, { builtSomething: true, seed: 'kept-seed' })).toMatch(/Your files so far are saved/);
  });
});

describe('3 · 🔒 one source per sentence, wired from the route', () => {
  const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the runner hands the third state to every ending and keeps no inline copy of a stop sentence', () => {
    expect(runner).toContain('seed: builtSomething ? null : this.opts.seedState?.() ?? null');
    expect(runner).toContain('timedOutSummary(minutes, ending)');
    expect(runner).toContain('stalledModelSummary(minutes, ending)');
    expect(runner).not.toMatch(/Nothing was lost/);
  });

  it('the route tells the runner what it seeded, read with the router\'s own test', () => {
    expect(route).toContain('seedState: () => seedStateOf(writtenFiles),');
  });

  it('the session cost-cap stop says what is there too (a game kit is not "no files")', () => {
    const at = route.indexOf('reached the $${capUsd.toFixed(0)} cap.');
    expect(route.slice(at, at + 400)).toContain('const seed = seedStateOf(writtenFiles);');
  });
});

describe('4 · 🔒 every sentence agrees with what the NEXT message will actually do', () => {
  // The durable workspace after the stop: our framework starter plus what this build wrote.
  const starter = starterTemplates()[0]!;
  const FIXTURES: Array<[string, Map<string, string>]> = [
    ['the report\'s AI-image template', new Map(Object.entries(goldenScaffoldFiles(GOLDEN_SCAFFOLDS.find((g) => g.id === 'ai-image')!)))],
    ['a page the user pasted', new Map([['index.html', '<!doctype html><html><body><h1>My bakery</h1></body></html>']])],
    ['a game kit', new Map([...recipeFilePool()].slice(0, 6).map(([p, f]) => [p, f.content] as [string, string]))],
  ];

  it.each(FIXTURES)('%s', (_name, written) => {
    const seed = seedStateOf(written)!;
    // The router's reading of the workspace on the next message (agentv3.ts, DURABLE_HOLDS_ONLY_STARTER).
    const nextTurnBuildsFresh = holdsOnlyOurStarter({ ...starter, ...Object.fromEntries(written) });
    expect(seed === 'platform-template').toBe(nextTurnBuildsFresh);
    const lines = [
      abortSummary('user-stop', { builtSomething: false, seed }),
      timedOutSummary(30, { seed }),
      stalledModelSummary(3, { seed }),
    ];
    for (const line of lines) {
      expect(PROMISES_CONTINUE.test(line), line).toBe(!nextTurnBuildsFresh);
      expect(line).not.toMatch(FALSE_EMPTY);
    }
  });
});
