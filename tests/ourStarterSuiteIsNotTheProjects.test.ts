// AUTOPSY 6bae5835 (2026-09-27): the release gate said "this project HAS a test suite, but it could not be
// run here" about the starter suite NavBharatAI had added eighteen seconds earlier and deliberately does
// not run. The sentence described the user's project; the truth was about ours.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { starterSuiteOnly, starterSuiteNote } from '../src/server/AgentV3/e2eAutoScaffold';
import { whyMissing } from '../src/server/AgentV3/releaseGate';

const OURS = new Set(['playwright.config.ts', 'e2e/smoke.spec.ts']);

describe('ours or theirs', () => {
  it('only our starter files ⇒ ours', () => {
    expect(starterSuiteOnly(['src/App.tsx', 'playwright.config.ts', 'e2e/smoke.spec.ts', 'node_modules/x/test/a.test.js'], OURS)).toBe(true);
  });
  it('🔒 any test file of the user’s own ⇒ theirs, always described as theirs', () => {
    expect(starterSuiteOnly(['playwright.config.ts', 'e2e/smoke.spec.ts', 'src/cart.test.ts'], OURS)).toBe(false);
    expect(starterSuiteOnly(['playwright.config.ts', 'e2e/smoke.spec.ts', 'e2e/checkout.spec.ts'], OURS)).toBe(false);
  });
  it('no test files at all ⇒ not a suite', () => {
    expect(starterSuiteOnly(['src/App.tsx'], OURS)).toBe(false);
  });
});

describe('the gate and the report say it plainly — wording only, never the verdict', () => {
  it('whyMissing names our starter suite', () => {
    const e = { buildOk: true, testSuitePresent: true, testSuiteIsOurStarter: true } as never;
    expect(whyMissing('tests', e)).toMatch(/starter one NavBharatAI added/);
    expect(whyMissing('tests', { buildOk: true, testSuitePresent: true } as never)).toMatch(/this project HAS a test suite/);
  });
  it('the report line says it was not run and nothing passed or failed', () => {
    expect(starterSuiteNote()).toMatch(/not run in this build/);
    expect(starterSuiteNote()).toMatch(/Nothing about it passed or failed/);
  });
  it('the route asks it where the vaccine finds a suite without its runner', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const ours = starterSuiteOnly(files, finishingPaths);');
    expect(route).toContain('if (ours) gateEvidence.testSuiteIsOurStarter = true;');
  });
});
