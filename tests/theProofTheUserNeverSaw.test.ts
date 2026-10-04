import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  platformChecksProof, browserAlreadySaid, phoneOutcomeFromCode, MAX_PROOF_LINES,
  type PlatformChecks,
} from '../src/server/AgentV3/buildProofCard';
import { mergeUserProofs, type UserProof } from '../src/server/AgentV3/clickExplorer';
import { mobileLayoutVerdict } from '../src/server/AgentV3/mobileLayoutCheck';

/**
 * THE MOAT, PRINTED.
 *
 * NavBharatAI opens the finished app in a real browser, reloads it to check the data came back,
 * presses its controls on fresh loads, measures it at 390×844 with touch, runs the app's own test
 * suite and compiles it. **No other AI app builder collects that evidence**, so none of them can
 * show these sentences — and until this change the user saw at most two of them.
 *
 * Not because the rest was withheld: the card was emitted ~400 lines earlier in the route, BEFORE
 * `gateEvidence.tests` and `gateEvidence.preview` had answers. It is built beside `RELEASE_GATE` now,
 * off the same object the gate reads.
 */

const NOTHING: PlatformChecks = {
  preview: 'not-run', pages: 'not-run', typecheck: 'not-run', tests: 'not-run', phone: 'not-run',
};
const QUIET = { browserAlreadySaid: false };

describe('every check that really ran becomes a sentence the user can read', () => {
  it('a fully checked app shows all of it', () => {
    const p = platformChecksProof({
      preview: 'passed', pages: 'passed', typecheck: 'passed', tests: 'passed', phone: 'passed',
    }, QUIET);
    expect(p.ok).toBe(true);
    expect(p.headline).toBe('NavBharatAI checked your app');
    expect(p.steps).toHaveLength(5);
    expect(p.steps.join(' ')).toContain('real browser');
    expect(p.steps.join(' ')).toContain('Every screen');
    expect(p.steps.join(' ')).toContain('phone-sized screen');
    expect(p.steps.join(' ')).toContain('own tests');
    expect(p.steps.join(' ')).toContain('compiled with no errors');
  });

  // 🔒 THREE OUTCOMES, NEVER TWO. This is the rule the whole module exists to keep.
  it('a check that did not run says NOTHING — never a reassuring sentence about work that did not happen', () => {
    const p = platformChecksProof(NOTHING, QUIET);
    expect(p.headline).toBe('');
    expect(p.steps).toEqual([]);
  });

  it.each([
    ['preview', 'did not render'],
    ['pages', 'screens did not render'],
    ['typecheck', 'compiles with errors'],
    ['tests', 'did not pass'],
  ] as const)('a FAILED %s is said plainly, and the card is not green', (key, words) => {
    const p = platformChecksProof({ ...NOTHING, [key]: 'failed' } as PlatformChecks, QUIET);
    expect(p.ok).toBe(false);
    expect(p.headline).toContain('found a problem');
    expect(p.steps.join(' ')).toContain(words);
  });

  it('problems go FIRST — a user reads two lines and stops', () => {
    const p = platformChecksProof({
      preview: 'passed', pages: 'failed', typecheck: 'passed', tests: 'passed', phone: 'passed',
    }, QUIET);
    expect(p.ok).toBe(false);
    expect(p.steps[0]).toContain('did not render');
  });

  // 🔒 OUR OWN STARTER SUITE IS NOT "YOUR APP'S OWN TESTS" (autopsy 6bae5835, 2026-09-27 — the gate
  // said "this project HAS a test suite" about a suite the platform wrote 18 seconds earlier).
  it('the starter suite WE wrote is never called the user\'s own tests', () => {
    const passed = platformChecksProof({ ...NOTHING, tests: 'passed', testSuiteIsOurStarter: true }, QUIET);
    expect(passed.steps.join(' ')).not.toContain('own tests');
    expect(passed.headline).toBe('');
    const failed = platformChecksProof({ ...NOTHING, tests: 'failed', testSuiteIsOurStarter: true }, QUIET);
    expect(failed.steps.join(' ')).not.toContain('own tests');
    expect(failed.headline).toBe('');
  });

  it('the app\'s OWN suite is credited when it really is the app\'s', () => {
    const p = platformChecksProof({ ...NOTHING, tests: 'passed', testSuiteIsOurStarter: false }, QUIET);
    expect(p.steps.join(' ')).toContain('own tests');
  });

  // The journey and the explorer both headline "in a real browser", so repeating it is the same fact
  // twice on a card with room for a handful of lines.
  it('the render line stands down when the journey or the explorer already said it', () => {
    const quiet = platformChecksProof({ ...NOTHING, preview: 'passed' }, QUIET);
    expect(quiet.steps.join(' ')).toContain('real browser');
    const spoken = platformChecksProof({ ...NOTHING, preview: 'passed' }, { browserAlreadySaid: true });
    expect(spoken.headline).toBe('');
  });

  it('browserAlreadySaid reads a proof that really spoke, not one that exists', () => {
    expect(browserAlreadySaid(null, undefined)).toBe(false);
    expect(browserAlreadySaid({ ok: true, headline: '', steps: [] })).toBe(false);
    expect(browserAlreadySaid({ ok: true, headline: 'x', steps: [] })).toBe(false);
    expect(browserAlreadySaid({ ok: true, headline: 'x', steps: ['y'] })).toBe(true);
  });

  it('the card is capped so it stays readable on a phone', () => {
    const p = platformChecksProof({
      preview: 'failed', pages: 'failed', typecheck: 'failed', tests: 'failed', phone: 'failed',
    }, QUIET);
    expect(p.steps.length).toBeLessThanOrEqual(MAX_PROOF_LINES);
  });

  // 🔒 WHITE-LABEL LAW: no report codes, no tool names, no vendor names.
  it('not one sentence carries a code, a tool name or a vendor name', () => {
    const p = platformChecksProof({
      preview: 'passed', pages: 'passed', typecheck: 'passed', tests: 'passed', phone: 'passed',
    }, QUIET);
    const all = `${p.headline} ${p.steps.join(' ')}`;
    for (const banned of [
      'MOBILE_LAYOUT', 'RELEASE_GATE', 'gateEvidence', 'tsc', 'playwright', 'vitest', 'npm',
      'GLM', 'Kimi', 'Claude', 'Sonnet', 'Gemini', 'Grok', 'OpenAI',
    ]) expect(all, banned).not.toContain(banned);
  });
});

describe('the phone check\'s outcome is read from the code it really recorded', () => {
  it('maps the three codes, and anything else is "not run"', () => {
    expect(phoneOutcomeFromCode('MOBILE_LAYOUT_OK')).toBe('passed');
    expect(phoneOutcomeFromCode('MOBILE_LAYOUT_ISSUES')).toBe('failed');
    expect(phoneOutcomeFromCode('MOBILE_LAYOUT_NOT_RUN')).toBe('not-run');
    expect(phoneOutcomeFromCode(null)).toBe('not-run');
    expect(phoneOutcomeFromCode('SOMETHING_NEW')).toBe('not-run');
  });

  // ONE definition: asked of the REAL verdict function, so the card and the admin report cannot
  // disagree about what the phone check found. A copy of the code names here would drift.
  it('agrees with the real mobileLayoutVerdict on all three of its answers', () => {
    expect(phoneOutcomeFromCode(mobileLayoutVerdict({ ok: false, error: 'no result' } as never).code)).toBe('not-run');
    expect(phoneOutcomeFromCode(mobileLayoutVerdict({ ok: true, painted: true, overflow: 0, smallCount: 0 } as never).code)).toBe('passed');
    expect(phoneOutcomeFromCode(mobileLayoutVerdict({ ok: true, painted: true, overflow: 120, vw: 390, wide: [], smallCount: 0 } as never).code)).toBe('failed');
  });
});

describe('the card joins the journey and the explorer rather than replacing them', () => {
  const journey: UserProof = { ok: true, headline: 'NavBharatAI tested your app in a real browser', steps: ['Your note was saved and came back after a reload.'] };
  const explorer: UserProof = { ok: true, headline: 'NavBharatAI tested your app in a real browser', steps: ['Pressed 12 of your app\'s controls — none of them broke it.'] };

  it('every proof\'s steps are kept', () => {
    const checks = platformChecksProof({ ...NOTHING, tests: 'passed', phone: 'passed' }, { browserAlreadySaid: true });
    const card = mergeUserProofs(journey, explorer, checks);
    expect(card.ok).toBe(true);
    expect(card.steps).toHaveLength(4);
    expect(card.steps.join(' ')).toContain('came back after a reload');
    expect(card.steps.join(' ')).toContain('12 of your app');
    expect(card.steps.join(' ')).toContain('own tests');
    expect(card.steps.join(' ')).toContain('phone-sized');
  });

  it('one problem makes the whole card a problem', () => {
    const checks = platformChecksProof({ ...NOTHING, tests: 'failed' }, { browserAlreadySaid: true });
    const card = mergeUserProofs(journey, explorer, checks);
    expect(card.ok).toBe(false);
    expect(card.headline).toContain('problem');
  });

  it('a build where nothing could be checked shows no card at all', () => {
    const card = mergeUserProofs(null, null, platformChecksProof(NOTHING, QUIET));
    expect(card.headline).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WIRING — tsc cannot see a card emitted before its evidence exists, which is exactly what happened.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('the card is emitted where its evidence is final', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('still EXACTLY one emit — the build card has one slot', () => {
    expect((route.match(/emit\(\{ type: 'verified'/g) ?? []).length).toBe(1);
  });

  it('the emit comes AFTER the release gate reads the same evidence', () => {
    const gate = route.indexOf("code: 'RELEASE_GATE',");
    const emit = route.indexOf("emit({ type: 'verified'");
    expect(gate).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(gate);
  });

  it('…and AFTER the app\'s own test suite and the render proof have answers', () => {
    const emit = route.indexOf("emit({ type: 'verified'");
    for (const setter of ["gateEvidence.tests = 'passed'", "gateEvidence.preview = previewVerifiedRendered"]) {
      expect(route.indexOf(setter), setter).toBeGreaterThan(0);
      expect(route.indexOf(setter), setter).toBeLessThan(emit);
    }
  });

  it('it reads the gate\'s own evidence object, never a second copy', () => {
    expect(route).toContain('platformChecksProof({');
    expect(route).toContain('preview: gateEvidence.preview');
    expect(route).toContain('tests: gateEvidence.tests');
    expect(route).toContain('testSuiteIsOurStarter: gateEvidence.testSuiteIsOurStarter === true');
    expect(route).toContain('mergeUserProofs(journeyProof, exploreProof, checksProof)');
  });

  it('the phone check\'s verdict is kept rather than recorded and discarded', () => {
    expect(route).toContain('phoneProof = phoneOutcomeFromCode(verdict.code)');
    expect(route).toContain('phone: phoneProof');
  });
});
