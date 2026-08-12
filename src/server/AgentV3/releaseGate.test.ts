import { describe, it, expect } from 'vitest';
import {
  releaseGate, releaseGateSummary, runtimeProven,
  type RuntimeEvidence, type StaticFindings,
} from './releaseGate';
import { computeBuildConfidence, type BuildConfidenceInput } from './BuildConfidence';
import { isNeverRootCause } from './BuildDiagnostics';

/**
 * THE STATE EVERY GATE LEAVES OUT.
 *
 * Green, yellow and red are easy and everyone has them. UNKNOWN is the one that matters here, because
 * this platform's runtime checks are ALL gated on a preview URL — so when the preview never comes up
 * they skip together, and they skip precisely when the app is most broken. A quiet report is not
 * evidence of health; it is the shape failure takes.
 *
 * Every test below is really one assertion in different clothes: absence of evidence must never be
 * reported as evidence of absence.
 */

const nothing: RuntimeEvidence = {
  buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run',
};
const clean: StaticFindings = { blockers: 0, highSeverity: 0, warnings: 0 };
const ev = (o: Partial<RuntimeEvidence>): RuntimeEvidence => ({ ...nothing, ...o });

describe('UNKNOWN — we did not look, and we say so', () => {
  it('a perfectly clean build that never ran is UNKNOWN, not green', () => {
    // The whole point. Static cleanliness cannot earn green no matter how clean.
    const v = releaseGate(nothing, clean);
    expect(v.state).toBe('unknown');
    expect(v.headline).toContain('Cannot say whether this works');
  });

  it('UNKNOWN proves nothing, by definition', () => {
    expect(releaseGate(nothing, clean).proven).toEqual([]);
  });

  it('it names WHY each check is missing, so a gap does not read as a clean bill', () => {
    const v = releaseGate(nothing, clean);
    expect(v.unproven.join(' ')).toContain('no live preview was ever available');
    expect(v.unproven.join(' ')).toContain('needs a running app and was skipped');
  });

  it('a typecheck alone does not lift it out of UNKNOWN', () => {
    // A project can typecheck perfectly and paint a blank screen. Letting a compiler stand in for a
    // browser is the exact substitution this gate exists to prevent.
    expect(releaseGate(ev({ typecheck: 'passed', tests: 'passed' }), clean).state).toBe('unknown');
  });
});

describe('a stateless app (a game) is judged honestly, not "it does not save anything"', () => {
  // BENCHMARK #1/#2 (2026-08-12): a working game was reported YELLOW with "whether it actually SAVES
  // anything is untested" — a category error for something that saves nothing.
  const game = ev({ preview: 'passed', pages: 'passed', journeys: 'none-derivable', typecheck: 'passed' });

  it('renders + no data-entry flow → YELLOW, but the headline never implies a missing save', () => {
    const v = releaseGate(game, clean);
    expect(v.state).toBe('yellow'); // still not green — a journey was never proven
    expect(v.headline).not.toContain('SAVES anything');
    expect(v.headline).toContain('no data-entry flow');
    expect(v.headline).toContain('not machine-verified');
  });

  it('lists the missing journey as "not a defect", not as a gap', () => {
    expect(releaseGate(game, clean).unproven.join(' ')).toContain('not a defect');
  });

  it('"none-derivable" still CANNOT earn GREEN — rendering alone never does', () => {
    // The safety property: softening the wording must never promote a stateless app to shippable-green.
    expect(releaseGate(game, clean).state).not.toBe('green');
  });

  it('a real data app whose journey was not proven still gets the honest "SAVES" caveat', () => {
    const dataApp = ev({ preview: 'passed', pages: 'passed', journeys: 'not-run', typecheck: 'passed' });
    expect(releaseGate(dataApp, clean).headline).toContain('SAVES anything');
  });

  it('runtimeProven is unaffected — a game that rendered is still proven to RUN', () => {
    expect(runtimeProven(game)).toBe('passed');
  });
});

describe('RED — something we checked is actually broken', () => {
  it('a failed build is red before anything else is considered', () => {
    expect(releaseGate(ev({ buildOk: false }), clean).state).toBe('red');
  });

  it('a journey that failed is red even though everything rendered', () => {
    // "It renders" and "it works" are different claims, and this is where they come apart.
    const v = releaseGate(ev({ preview: 'passed', pages: 'passed', journeys: 'failed' }), clean);
    expect(v.state).toBe('red');
    expect(v.failures.join(' ')).toContain('user journey');
  });

  it('a build-breaking blocker is red', () => {
    expect(releaseGate(ev({ preview: 'passed' }), { ...clean, blockers: 1 }).state).toBe('red');
  });

  it('a high-severity security finding is red', () => {
    expect(releaseGate(ev({ preview: 'passed', journeys: 'passed' }), { ...clean, highSeverity: 1 }).state).toBe('red');
  });

  it('red still reports what WAS proven — a failure does not erase the evidence', () => {
    const v = releaseGate(ev({ preview: 'passed', pages: 'passed', journeys: 'failed' }), clean);
    expect(v.proven.length).toBeGreaterThan(0);
  });
});

describe('YELLOW — it runs, with something worth knowing', () => {
  it('rendered but no journey proven is YELLOW, never green', () => {
    // An app that paints beautifully and saves nothing renders exactly as well as one that works.
    const v = releaseGate(ev({ preview: 'passed', pages: 'passed', journeys: 'not-run' }), clean);
    expect(v.state).toBe('yellow');
    expect(v.headline).toContain('whether it actually SAVES anything is untested');
  });

  it('a journey held up but warnings remain is YELLOW', () => {
    const v = releaseGate(ev({ preview: 'passed', pages: 'passed', journeys: 'passed' }), { ...clean, warnings: 3 });
    expect(v.state).toBe('yellow');
    expect(v.headline).toContain('3 thing(s) worth a look');
  });

  it('an UNREACHABLE journey is neither a pass nor a failure', () => {
    // A login wall is not a defect, and it is not proof either.
    const v = releaseGate(ev({ preview: 'passed', pages: 'passed', journeys: 'unreachable' }), clean);
    expect(v.state).toBe('yellow');
    expect(v.unproven.join(' ')).toContain('could not be reached');
    expect(v.failures).toEqual([]);
  });
});

describe('GREEN — earned, and only earned', () => {
  const green = ev({ preview: 'passed', pages: 'passed', journeys: 'passed', typecheck: 'passed' });

  it('needs the app to run AND a journey to hold up', () => {
    const v = releaseGate(green, clean);
    expect(v.state).toBe('green');
    expect(v.headline).toContain('a real user journey held up');
  });

  it('lists what was actually demonstrated', () => {
    expect(releaseGate(green, clean).proven.join(' ')).toContain('filled a form, submitted, reloaded');
  });

  it('one warning is enough to drop it to yellow', () => {
    expect(releaseGate(green, { ...clean, warnings: 1 }).state).toBe('yellow');
  });

  it('a preview that never rendered cannot be green even if a journey somehow passed', () => {
    expect(releaseGate(ev({ preview: 'not-run', journeys: 'passed' }), clean).state).not.toBe('green');
  });
});

/**
 * §17 / §26. Accessibility and performance were already measured in a real browser and already printed
 * in the report — and had no bearing on the verdict, so an app with twelve unlabelled buttons and a
 * six-second LCP could be called shippable-green.
 */
describe('accessibility and performance cost green — and can never cost more', () => {
  const ran = ev({ preview: 'passed', pages: 'passed', journeys: 'passed' });

  it('an otherwise-green build with accessibility problems is YELLOW', () => {
    const v = releaseGate(ran, clean, { a11yIssues: 12, slowRoutes: 0 });
    expect(v.state).toBe('yellow');
    expect(v.headline).toContain('12 accessibility problem(s)');
  });

  it('an otherwise-green build with slow pages is YELLOW', () => {
    const v = releaseGate(ran, clean, { a11yIssues: 0, slowRoutes: 2 });
    expect(v.state).toBe('yellow');
    expect(v.headline).toContain('2 page(s) measured as slow');
  });

  it('NEITHER can ever make a build RED', () => {
    // A slow page still renders and an unlabelled button still works. Calling either "not shippable"
    // would be a false alarm about a working app — and the perf number is measured inside a 2-vCPU
    // sandbox on a cold dev server, which is not anybody's real device.
    const v = releaseGate(ran, clean, { a11yIssues: 99, slowRoutes: 99 });
    expect(v.state).toBe('yellow');
    expect(v.failures).toEqual([]);
  });

  it('the slow-page wording says WHERE it was measured, so nobody reads it as a user\'s experience', () => {
    expect(releaseGate(ran, clean, { a11yIssues: 0, slowRoutes: 1 }).headline).toContain('preview sandbox');
  });

  it('clean quality still reaches green', () => {
    expect(releaseGate(ran, clean, { a11yIssues: 0, slowRoutes: 0 }).state).toBe('green');
  });

  it('omitting quality entirely is the same as clean — no caller is broken by the new argument', () => {
    expect(releaseGate(ran, clean).state).toBe('green');
  });

  it('quality caveats do not rescue a build that was never proven to run', () => {
    // UNKNOWN outranks a quality note: the point is that we have no idea, not that the a11y was fine.
    expect(releaseGate(nothing, clean, { a11yIssues: 0, slowRoutes: 0 }).state).toBe('unknown');
  });
});

describe('runtimeProven is one answer, shared', () => {
  it('passed when any render check passed', () => {
    expect(runtimeProven(ev({ pages: 'passed' }))).toBe('passed');
  });

  it('failed outranks passed — a broken page is not offset by a working one', () => {
    expect(runtimeProven(ev({ preview: 'passed', pages: 'failed' }))).toBe('failed');
  });

  it('unknown when nothing ran, and for junk input', () => {
    expect(runtimeProven(nothing)).toBe('unknown');
    expect(runtimeProven(null as unknown as RuntimeEvidence)).toBe('unknown');
  });

  it('a typecheck is not runtime proof', () => {
    expect(runtimeProven(ev({ typecheck: 'passed', tests: 'passed' }))).toBe('unknown');
  });
});

describe('the summary a person reads', () => {
  it('leads with the state and the reason', () => {
    expect(releaseGateSummary(releaseGate(nothing, clean))).toContain('Release gate: UNKNOWN');
  });

  it('separates what failed, what was proven, and what was never established', () => {
    const s = releaseGateSummary(releaseGate(ev({ preview: 'passed', journeys: 'failed' }), clean));
    expect(s).toContain('Failed:');
    expect(s).toContain('Proven:');
    expect(s).toContain('NOT established:');
  });

  it('survives junk without taking a build down', () => {
    expect(() => releaseGate(null as unknown as RuntimeEvidence, null as unknown as StaticFindings)).not.toThrow();
  });
});

/**
 * THE BUG THIS PHASE ACTUALLY FIXES.
 *
 * Confidence is a claim about whether the app WORKS. Every input it had was a claim about whether the
 * code READS well. So the number said 100% about an app nobody had ever seen run.
 */
describe('confidence can no longer be certain about an app nobody watched run', () => {
  const spotless: BuildConfidenceInput = {
    readinessScore: 100, ready: true,
    architecture: { unresolvedImports: 0, cycles: 0, layering: 0 },
    security: { high: 0, medium: 0, low: 0 },
    authenticity: 0,
    dependencies: { missing: 0, unused: 0 },
    envVarsMissing: 0,
    accessibility: { high: 0, medium: 0, low: 0 },
    compliance: { high: 0, medium: 0, low: 0 },
  };

  it('a spotless static analysis with NO runtime evidence is capped below "high"', () => {
    // Before this, the same input returned 100 / high / "I'm confident this build is solid" for an app
    // whose preview never came up.
    const c = computeBuildConfidence(spotless);
    expect(c.score).toBeLessThanOrEqual(74);
    expect(c.band).not.toBe('high');
  });

  it('the cap is EXPLAINED, not a silent deduction', () => {
    // A number that drops for no stated reason is the number nobody trusts.
    expect(computeBuildConfidence(spotless).negatives[0]).toContain('ever proven to RUN');
  });

  it('silence cannot buy confidence — omitting the field is the same as not knowing', () => {
    const omitted = computeBuildConfidence(spotless);
    const stated = computeBuildConfidence({ ...spotless, runtimeProven: 'unknown' });
    expect(omitted.score).toBe(stated.score);
  });

  it('proof of running RESTORES high confidence — the cap is not a blanket pessimism', () => {
    const c = computeBuildConfidence({ ...spotless, runtimeProven: 'passed' });
    expect(c.band).toBe('high');
    expect(c.score).toBe(100);
    expect(c.positives[0]).toContain('Proven to RUN');
  });

  it('a run we watched FAIL caps confidence lower still', () => {
    const c = computeBuildConfidence({ ...spotless, runtimeProven: 'failed' });
    expect(c.score).toBeLessThanOrEqual(40);
    expect(c.band).toBe('low');
    expect(c.negatives[0]).toContain('did NOT work');
  });
});

/** The wiring — a gate nobody reads is a gate that gates nothing. */
describe('it is actually wired into a build', () => {
  const routes = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
  ) as string;

  it('the gate is computed from the build\'s real evidence and recorded', () => {
    expect(routes).toContain('releaseGate(');
    expect(routes).toContain('RELEASE_GATE');
  });

  it('the browser-measured accessibility and performance counts reach the gate', () => {
    expect(routes).toContain('a11yIssueCount(pageResults)');
    expect(routes).toContain('slowRouteCount(pageResults)');
    expect(routes).toContain('gateQuality');
  });

  it('the evidence comes from the checks that really ran, not from defaults', () => {
    // A hardcoded 'passed' anywhere here would make the whole gate a decoration.
    expect(routes).toContain('gateEvidence');
    expect(routes).not.toContain("preview: 'passed', pages: 'passed', journeys: 'passed'");
  });
});

/**
 * THE FIRST REAL BUILD AFTER THIS GATE SHIPPED CAUGHT THREE DEFECTS IN IT (2026-08-12).
 *
 * The admin built a 3D game, watched it run, collected all ten coins and saw the win screen. The report
 * he got back led with:
 *
 *     Release gate: RED — Not shippable — the app's own test suite passes — this FAILED.
 *
 * Gibberish, wrong, and printed as the ROOT CAUSE of a successful build. All three are below.
 */
describe('the gate, as corrected by the first build that used it', () => {
  const ran = ev({ preview: 'passed', pages: 'passed', journeys: 'passed', typecheck: 'passed' });

  it('a failure reads as a failure — not the pass sentence with "this FAILED" bolted on', () => {
    const v = releaseGate(ev({ preview: 'failed' }), clean);
    expect(v.failures.join(' ')).toContain('did not come up');
    expect(v.failures.join(' ')).not.toContain('this FAILED');
    expect(v.failures.join(' ')).not.toContain('passes —');
  });

  it('A FAILING TEST SUITE DOES NOT MAKE A RUNNING APP "NOT SHIPPABLE"', () => {
    // The mirror of the green rule. Green cannot be earned by static cleanliness; RED cannot be earned
    // by static failure. The admin was playing the game while the report called it unshippable — and
    // that same report said the test result could not be told apart from a runner that never started.
    const v = releaseGate(ev({ preview: 'passed', journeys: 'passed', tests: 'failed' }), clean);
    expect(v.state).toBe('yellow');
    expect(v.headline).not.toContain('Not shippable');
  });

  it('but it is named LOUDLY, first among the caveats — not softened away', () => {
    const v = releaseGate(ev({ preview: 'passed', journeys: 'passed', tests: 'failed' }), { ...clean, warnings: 3 });
    expect(v.headline).toContain('test suite did not pass');
    // Ahead of the generic count of "things worth a look".
    expect(v.headline.indexOf('test suite')).toBeLessThan(v.headline.indexOf('thing(s)'));
  });

  it('a failing typecheck is the same shape — serious, but the app still runs', () => {
    const v = releaseGate(ev({ preview: 'passed', journeys: 'passed', typecheck: 'failed' }), clean);
    expect(v.state).toBe('yellow');
    expect(v.headline).toContain('does not typecheck');
  });

  it('and it can never be GREEN — a failing suite is not a clean build', () => {
    expect(releaseGate({ ...ran, tests: 'failed' }, clean).state).toBe('yellow');
    expect(releaseGate(ran, clean).state).toBe('green');
  });

  it('a failure that PROVES the app does not work is still RED', () => {
    // The distinction the whole fix rests on: these are about the app, not about our tooling.
    expect(releaseGate(ev({ preview: 'failed' }), clean).state).toBe('red');
    expect(releaseGate(ev({ preview: 'passed', pages: 'failed' }), clean).state).toBe('red');
    expect(releaseGate(ev({ preview: 'passed', journeys: 'failed' }), clean).state).toBe('red');
  });

  it('THE GATE CANNOT BE A ROOT CAUSE — it is a summary of other findings', () => {
    // It became the rootCause of a successful build, which is the same defect that was fixed for
    // PREVIEW_NOT_RENDERED and then reintroduced by a new code.
    expect(isNeverRootCause('RELEASE_GATE')).toBe(true);
  });

  it('a RED gate on a build that SUCCEEDED is recorded as a warning, not an error', () => {
    const routes = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
    ) as string;
    expect(routes).toContain("gate.state === 'red' && !result.ok ? 'error'");
  });
});
