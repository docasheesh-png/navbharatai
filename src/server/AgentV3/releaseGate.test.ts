import { describe, it, expect } from 'vitest';
import {
  releaseGate, releaseGateSummary, runtimeProven,
  type RuntimeEvidence, type StaticFindings,
} from './releaseGate';
import { computeBuildConfidence, type BuildConfidenceInput } from './BuildConfidence';

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

  it('the evidence comes from the checks that really ran, not from defaults', () => {
    // A hardcoded 'passed' anywhere here would make the whole gate a decoration.
    expect(routes).toContain('gateEvidence');
    expect(routes).not.toContain("preview: 'passed', pages: 'passed', journeys: 'passed'");
  });
});
