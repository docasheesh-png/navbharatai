// AgentV3 — THE RELEASE GATE: green, yellow, red, and the one everybody leaves out (Mission 10/10,
// Phase 5 · §23).
//
// THE DEFECT THIS EXISTS FOR, stated plainly: **this platform's most confident statement is made with
// the least evidence.**
//
// Every signal feeding the confidence number today is a STATIC analysis count — unresolved imports,
// security findings, dependency counts, env vars. There is not one input for "did the app actually
// run". So an app whose preview never came up, whose page-render check was therefore skipped, whose
// journeys never ran, and whose route smoke check no-opped — an app about which we know NOTHING — scores
// 100%, band HIGH, and says "I'm confident this build is solid."
//
// It is worse than a coincidence. Every runtime check in the engine is GATED ON A PREVIEW URL, so they
// all skip together, and they skip precisely when the app is most broken. The quiet report is not
// evidence of health; it is the shape failure takes. `PREVIEW_NEVER_CAME_UP` already says so in words —
// but the confidence number sitting next to it still said 100%.
//
// A four-state gate is the fix, and the fourth state is the whole point:
//
//   RED      something we checked actually failed
//   YELLOW   it runs, with real caveats
//   GREEN    it runs and the things we can prove, we proved
//   UNKNOWN  nothing failed and nothing was PROVEN — we cannot tell you this works
//
// UNKNOWN is not a softer green. It is the honest answer to "we did not look", and a system without it
// is forced to report absence of evidence as evidence of absence. **GREEN REQUIRES POSITIVE PROOF THAT
// THE APP RAN.** Static cleanliness can never earn it, no matter how clean.
//
// PURE. No I/O, no clock. Never throws.

/** How a single check came out. `not-run` is a first-class outcome, never folded into a pass. */
export type CheckOutcome = 'passed' | 'failed' | 'not-run';

/** A journey can additionally be reached-but-inconclusive, which is neither a pass nor a failure. */
export type JourneyOutcome = CheckOutcome | 'unreachable';

export interface RuntimeEvidence {
  /** Did the build itself report success? */
  buildOk: boolean;
  /** Did a live preview come up and render? */
  preview: CheckOutcome;
  /** Did the app's own page routes render in a real browser? */
  pages: CheckOutcome;
  /** Did a real user journey (fill a form, submit, reload) hold up? */
  journeys: JourneyOutcome;
  /** Did the project typecheck? */
  typecheck: CheckOutcome;
  /** Did the app's own test suite run, and pass? */
  tests: CheckOutcome;
}

export interface StaticFindings {
  /** Hard blockers — an unresolved import, a missing dependency. */
  blockers: number;
  /** High-severity security or privacy findings. */
  highSeverity: number;
  /** Everything else worth mentioning. */
  warnings: number;
}

/**
 * Quality measured in a real browser: accessibility problems found, and routes graded genuinely slow
 * (§17, §26).
 *
 * These were already measured and already printed — and had no bearing on the verdict, so an app with
 * twelve unlabelled buttons and a six-second LCP could still be called shippable-green. They now cost
 * green.
 *
 * THEY CAN NEVER MAKE A BUILD RED, and that limit is deliberate rather than lenient. A slow page still
 * renders and an unlabelled button still works, so calling either "not shippable" would be a false
 * alarm about a working app. The perf number in particular is taken inside a 2-vCPU sandbox on a cold
 * dev server, which is not the user's device on a production build — treating it as a blocking fact
 * would frighten people about an app that is fine.
 */
export interface QualitySignals {
  a11yIssues: number;
  slowRoutes: number;
}

export type GateState = 'green' | 'yellow' | 'red' | 'unknown';

export interface GateVerdict {
  state: GateState;
  /** One sentence, written for the person deciding whether to ship. */
  headline: string;
  /** What we actually demonstrated. Empty on UNKNOWN, by definition. */
  proven: string[];
  /** What we did NOT establish, and why it is missing rather than fine. */
  unproven: string[];
  /** What went wrong, when something did. */
  failures: string[];
}

const RUNTIME_LABEL: Record<keyof Omit<RuntimeEvidence, 'buildOk'>, string> = {
  preview: 'the app came up and rendered',
  pages: 'every page route rendered in a real browser',
  journeys: 'a real user journey held up (filled a form, submitted, reloaded)',
  typecheck: 'the project typechecks',
  tests: 'the app\'s own test suite passes',
};

/** Why a missing check is missing — so "not run" reads as a gap rather than as an absence of concern. */
const WHY_MISSING: Record<keyof Omit<RuntimeEvidence, 'buildOk'>, string> = {
  preview: 'no live preview was ever available, so nothing here was proven to RUN',
  pages: 'the page-render check needs a running app and was skipped',
  journeys: 'no user journey could be derived or run',
  typecheck: 'the typecheck did not run',
  tests: 'the app has no test suite that could be run here',
};

/**
 * The checks that, between them, constitute proof that the app RUNS.
 *
 * Typecheck and tests are deliberately NOT in this list. A project can typecheck perfectly and still
 * paint a blank screen — that is the entire reason the render checks exist, and letting a compiler
 * stand in for a browser is the substitution this gate is built to prevent.
 */
const RUNTIME_PROOF: Array<keyof Omit<RuntimeEvidence, 'buildOk'>> = ['preview', 'pages', 'journeys'];

/**
 * Decide the release state. Pure.
 *
 * The ordering of the rules is the design: a failure outranks everything, then a build that did not
 * succeed, then blockers — and only after all of that do we ask whether we have any proof at all. An
 * implementation that checked "is it clean?" first would find a clean-looking nothing and call it green,
 * which is exactly the bug.
 */
export function releaseGate(
  evidence: RuntimeEvidence,
  findings: StaticFindings,
  quality: QualitySignals = { a11yIssues: 0, slowRoutes: 0 },
): GateVerdict {
  const ev = evidence ?? ({} as RuntimeEvidence);
  const f = findings ?? { blockers: 0, highSeverity: 0, warnings: 0 };
  const q = quality ?? { a11yIssues: 0, slowRoutes: 0 };
  const proven: string[] = [];
  const unproven: string[] = [];
  const failures: string[] = [];

  for (const key of Object.keys(RUNTIME_LABEL) as Array<keyof typeof RUNTIME_LABEL>) {
    const outcome = ev[key];
    if (outcome === 'passed') proven.push(RUNTIME_LABEL[key]);
    else if (outcome === 'failed') failures.push(`${RUNTIME_LABEL[key]} — this FAILED`);
    else if (outcome === 'unreachable') {
      // Reached but inconclusive. Neither a pass nor a defect, and it must be neither here too.
      unproven.push('a user journey was derived but could not be reached (a login wall or a route needing seeded data)');
    } else unproven.push(WHY_MISSING[key]);
  }

  if (f.blockers > 0) failures.push(`${f.blockers} build-breaking blocker(s)`);
  if (f.highSeverity > 0) failures.push(`${f.highSeverity} high-severity security/privacy finding(s)`);

  // RED — something we looked at is actually broken.
  if (!ev.buildOk) {
    return { state: 'red', headline: 'Not shippable — the build did not succeed.', proven, unproven, failures };
  }
  if (failures.length > 0) {
    return {
      state: 'red',
      headline: `Not shippable — ${failures[0]}.`,
      proven, unproven, failures,
    };
  }

  // UNKNOWN — nothing failed, and nothing was proven either. The most important state in this file.
  const runtimeProofs = RUNTIME_PROOF.filter((k) => ev[k] === 'passed');
  if (runtimeProofs.length === 0) {
    return {
      state: 'unknown',
      headline: 'Cannot say whether this works — nothing here was ever proven to RUN. '
        + 'The checks that would have told us all need a running app, and they all skipped.',
      proven, unproven, failures,
    };
  }

  // GREEN needs the app to have run AND a journey to have held up. Rendering is necessary and not
  // sufficient: an app that paints beautifully and saves nothing renders exactly as well as one that
  // works, which is why "it rendered" alone lands at yellow.
  const journeyProven = ev.journeys === 'passed';
  // Measured-in-a-browser quality costs green, but never more than that (see QualitySignals).
  const qualityCaveats: string[] = [];
  if (q.a11yIssues > 0) qualityCaveats.push(`${q.a11yIssues} accessibility problem(s) real users would hit`);
  if (q.slowRoutes > 0) qualityCaveats.push(`${q.slowRoutes} page(s) measured as slow in the preview sandbox`);

  if (journeyProven && f.warnings === 0 && qualityCaveats.length === 0 && ev.preview === 'passed') {
    return {
      state: 'green',
      headline: 'Shippable — it runs, and a real user journey held up end to end.',
      proven, unproven, failures,
    };
  }

  const caveat = [
    f.warnings > 0 ? `${f.warnings} thing(s) worth a look` : '',
    ...qualityCaveats,
  ].filter(Boolean).join(', ');
  return {
    state: 'yellow',
    headline: journeyProven
      ? `It runs and a user journey held up${caveat ? `, with ${caveat} before shipping` : ''}.`
      : `It runs and renders — but no user journey was proven, so whether it actually SAVES anything is untested${caveat ? ` (also: ${caveat})` : ''}.`,
    proven, unproven, failures,
  };
}

const STATE_WORD: Record<GateState, string> = {
  green: 'GREEN', yellow: 'YELLOW', red: 'RED', unknown: 'UNKNOWN',
};

/** The block that goes in the build report. Pure. */
export function releaseGateSummary(v: GateVerdict): string {
  const lines = [`Release gate: ${STATE_WORD[v.state]} — ${v.headline}`];
  if (v.failures.length) lines.push(`  Failed: ${v.failures.join('; ')}`);
  if (v.proven.length) lines.push(`  Proven: ${v.proven.join('; ')}`);
  if (v.unproven.length) lines.push(`  NOT established: ${v.unproven.join('; ')}`);
  return lines.join('\n');
}

/**
 * Is there positive proof the app ran?
 *
 * Exported because the confidence score needs the same answer, and two modules computing "did it run"
 * separately is how they end up disagreeing in the same report.
 */
export function runtimeProven(ev: RuntimeEvidence): 'passed' | 'failed' | 'unknown' {
  if (!ev) return 'unknown';
  if (RUNTIME_PROOF.some((k) => ev[k] === 'failed')) return 'failed';
  return RUNTIME_PROOF.some((k) => ev[k] === 'passed') ? 'passed' : 'unknown';
}
