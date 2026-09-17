import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { releaseGate, whyMissing, type RuntimeEvidence, type StaticFindings } from '../src/server/AgentV3/releaseGate';

/**
 * 🔴 ONE SENTENCE THAT DISPROVES ITSELF (autopsy 8b3dca5c, 2026-09-17), verbatim from the report:
 *
 *     Release gate: RED — Not shippable — 1 build-breaking blocker(s).
 *       Failed: 1 build-breaking blocker(s)
 *       Proven: the app came up and rendered; the project typechecks
 *       NOT established: the page-render check NEEDS A RUNNING APP AND WAS SKIPPED; …
 *                        the app HAS NO TEST SUITE that could be run here
 *
 * The app had come up, rendered and been screenshotted — the gate's own `proven` list says so on the
 * line above. And the same report, seven seconds later:
 *
 *     TEST_SUITE_UNVERIFIED — "This project has a Playwright test suite but `@playwright/test` is not
 *     installed here, so it was NOT run."
 *
 * 🔑 THE CLASS: `WHY_MISSING` phrases every reason as an ABSOLUTE claim about the project — "there
 * was never a preview", "there is no running app", "the app has no test suite" — while the gate
 * routinely holds evidence that contradicts it. The `preview` instance was found on 2026-08-27 and
 * fixed with an inline `else if`. Its two siblings were never hunted. This closes them, and moves the
 * reasoning into ONE function so a fourth is added there rather than hidden as a fourth branch.
 *
 * 🔒 It can never change a verdict: every branch returns a string that lands in `unproven`.
 */

const clean: StaticFindings = { blockers: 0, highSeverity: 0, warnings: 0 };
const ev = (over: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run',
  typecheck: 'not-run', tests: 'not-run', ...over,
});

describe('🔴 the page-render caveat cannot claim there is no running app when the app ran', () => {
  it("the real report's combination: preview PASSED, pages not run", () => {
    const v = releaseGate(ev({ preview: 'passed', typecheck: 'passed' }), clean);
    const said = v.unproven.join(' ');
    expect(v.proven.join(' ')).toContain('the app came up and rendered');
    expect(said).not.toContain('needs a running app');
    expect(said).toContain('its individual page routes were never render-checked');
  });

  it('a published preview URL is enough, even when the render was never confirmed', () => {
    const said = releaseGate(ev({ previewUrlPublished: true }), clean).unproven.join(' ');
    expect(said).not.toContain('needs a running app');
    expect(said).toContain('page routes were never render-checked');
  });

  it('🔒 when NOTHING came up, the original wording still stands — this narrows, it does not soften', () => {
    const said = releaseGate(ev(), clean).unproven.join(' ');
    expect(said).toContain('no live preview was ever available');
    expect(said).toContain('the page-render check needs a running app and was skipped');
  });

  it('🔒 a preview that genuinely FAILED is not evidence the app ran', () => {
    const said = releaseGate(ev({ preview: 'failed' }), clean).unproven.join(' ');
    expect(said).toContain('needs a running app and was skipped');
  });
});

describe('🔴 the test caveat cannot say the project has no suite when it has one', () => {
  it("the real report's combination: a suite on disk whose runner is not installed", () => {
    const said = releaseGate(ev({ preview: 'passed', testSuitePresent: true }), clean).unproven.join(' ');
    expect(said).not.toContain('has no test suite');
    expect(said).toContain('HAS a test suite, but it could not be run here');
  });

  it('🔒 with no suite, the original wording still stands', () => {
    const said = releaseGate(ev({ preview: 'passed' }), clean).unproven.join(' ');
    expect(said).toContain('the app has no test suite that could be run here');
  });

  it('🔒 an omitted flag is not a false one — it keeps today\'s wording exactly', () => {
    const e = ev({ preview: 'passed' });
    delete (e as Partial<RuntimeEvidence>).testSuitePresent;
    expect(releaseGate(e, clean).unproven.join(' ')).toContain('has no test suite');
  });
});

describe('🔒 explaining a gap more accurately is never partial credit', () => {
  const both = ev({ preview: 'passed', previewUrlPublished: true, testSuitePresent: true, typecheck: 'passed' });

  it('the state and the headline are identical with and without the explanatory flags', () => {
    const bare = releaseGate(ev({ preview: 'passed', typecheck: 'passed' }), clean);
    const rich = releaseGate(both, clean);
    expect(rich.state).toBe(bare.state);
    expect(rich.headline).toBe(bare.headline);
    expect(rich.proven).toEqual(bare.proven);
    expect(rich.failures).toEqual(bare.failures);
    // Only the WORDING of the unproven list differs, and it is the same LENGTH: nothing moved out of it.
    expect(rich.unproven).toHaveLength(bare.unproven.length);
    expect(rich.unproven).not.toEqual(bare.unproven);
  });

  it('a build with real blockers is still RED, however well its gaps are explained', () => {
    expect(releaseGate(both, { blockers: 1, highSeverity: 0, warnings: 0 }).state).toBe('red');
  });
});

describe('whyMissing — the one place the reasoning lives', () => {
  it('falls back to the absolute wording for every key it has no evidence about', () => {
    const none = ev();
    expect(whyMissing('preview', none)).toContain('no live preview was ever available');
    expect(whyMissing('pages', none)).toContain('needs a running app');
    expect(whyMissing('journeys', none)).toContain('no user journey could be derived');
    expect(whyMissing('typecheck', none)).toContain('the typecheck did not run');
    expect(whyMissing('tests', none)).toContain('has no test suite');
  });

  it('never throws, even handed nothing at all', () => {
    expect(() => whyMissing('pages', undefined as unknown as RuntimeEvidence)).not.toThrow();
    expect(whyMissing('pages', undefined as unknown as RuntimeEvidence)).toContain('needs a running app');
  });
});

/**
 * 🔒 REVERSION GUARD — the wiring. `testSuitePresent` is useless unless something sets it, and the
 * one place that knows is the vaccine pass, which is where `TEST_SUITE_UNVERIFIED` is already recorded.
 */
describe('the wiring — proven by reversion', () => {
  const route = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the vaccine pass tells the gate a suite exists — in both branches that know it does', () => {
    expect(route).toContain('if (plan) gateEvidence.testSuitePresent = true;');
    // …and in the branch where no RUNNABLE plan was found but the suite is on disk anyway.
    const at = route.indexOf('suitePresentButRunnerMissing(files, pkgRaw)');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 400)).toContain('gateEvidence.testSuitePresent = true;');
  });

  it('the gate asks the one function, not a chain of special cases', () => {
    const gate = readFileSync(fileURLToPath(new URL('../src/server/AgentV3/releaseGate.ts', import.meta.url)), 'utf8');
    expect(gate).toContain('unproven.push(whyMissing(key, ev));');
    // The inline preview branch moved INTO whyMissing — it must not also survive outside it.
    expect(gate).not.toContain("} else if (key === 'preview' && ev.previewUrlPublished) {");
  });
});
