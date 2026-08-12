// AgentV3 — Calibrated Build Confidence + explainability (Layer 74 "Sahyog").
//
// The partnership move: instead of the agent declaring success by vibes, it states
// an HONEST, CALIBRATED confidence ("I'm 72% confident — here's why") derived only
// from the real evaluate signals across all eight dimensions (readiness,
// architecture, security, authenticity, dependencies, env-vars, accessibility,
// trust/compliance). Same inputs → same number (deterministic), and every point of
// confidence lost is explained with a concrete reason the user can act on. This is
// what makes the tool a trustworthy partner rather than an over-confident black box.

export interface SeverityTally {
  high: number;
  medium: number;
  low: number;
}

export interface BuildConfidenceInput {
  /** Deployment-readiness score (0–100) and gate from assessReadiness. */
  readinessScore: number;
  ready: boolean;
  architecture: { unresolvedImports: number; cycles: number; layering: number };
  security: SeverityTally;
  /** Count of fake/incomplete/placeholder findings (authenticity gate). */
  authenticity: number;
  dependencies: { missing: number; unused: number };
  /** Count of code-referenced env vars missing from .env.example. */
  envVarsMissing: number;
  accessibility: SeverityTally;
  compliance: SeverityTally;
  /**
   * Whether the app was actually observed to RUN — see releaseGate.runtimeProven().
   *
   * Every other field on this interface is a static analysis count, and that was a real honesty defect:
   * an app whose preview never came up, whose page-render check was therefore skipped and whose
   * journeys never ran — an app about which we knew NOTHING — scored 100% and said "I'm confident this
   * build is solid." Every runtime check is gated on a preview URL, so they all skip together, and they
   * skip precisely when the app is most broken. A quiet report is the shape failure takes.
   *
   * Optional, and 'unknown' when omitted, because a caller with no runtime information must not be able
   * to claim high confidence by simply not mentioning it. Silence caps confidence; it never earns it.
   */
  runtimeProven?: 'passed' | 'failed' | 'unknown';
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface BuildConfidence {
  /** 0–100, calibrated across all eight evaluate dimensions. */
  score: number;
  band: ConfidenceBand;
  /** Clean gates that earned confidence (for the "here's why" explanation). */
  positives: string[];
  /** Concrete issues that lowered confidence, highest-impact first. */
  negatives: string[];
}

// Per-defect confidence penalties (points). Heavier than readiness for the things
// that erode TRUST the most: build-breakers, security/privacy, and fake code.
const W = {
  unresolvedImport: 20, // build won't run
  depMissing: 15,       // build won't install/run
  securityHigh: 20,
  securityMedium: 6,
  securityLow: 1,
  complianceHigh: 15,
  complianceMedium: 5,
  complianceLow: 1,
  authenticity: 10,     // fake/placeholder code breaks the "real features only" promise
  a11yHigh: 6,
  a11yMedium: 3,
  a11yLow: 1,
  envMissing: 6,
  cycle: 3,
  layering: 2,
  depUnused: 1,
} as const;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Compute a calibrated 0–100 confidence with an explanation. Hard ceilings apply
 * so confidence can NEVER read high while a build-breaker or high-severity
 * security/privacy issue is present — those are dealbreakers regardless of score.
 */
export function computeBuildConfidence(i: BuildConfidenceInput): BuildConfidence {
  let score = 100;
  const negatives: { text: string; weight: number }[] = [];

  const drop = (cond: boolean, weight: number, text: string) => {
    if (cond) {
      score -= weight;
      negatives.push({ text, weight });
    }
  };

  drop(i.architecture.unresolvedImports > 0, W.unresolvedImport * i.architecture.unresolvedImports,
    `${i.architecture.unresolvedImports} unresolved import(s) will break the build`);
  drop(i.dependencies.missing > 0, W.depMissing * i.dependencies.missing,
    `${i.dependencies.missing} missing dependency(ies) not in package.json`);

  const secCount = i.security.high + i.security.medium + i.security.low;
  drop(secCount > 0, W.securityHigh * i.security.high + W.securityMedium * i.security.medium + W.securityLow * i.security.low,
    `${describeTally(i.security)} security issue(s)`);

  const compCount = i.compliance.high + i.compliance.medium + i.compliance.low;
  drop(compCount > 0, W.complianceHigh * i.compliance.high + W.complianceMedium * i.compliance.medium + W.complianceLow * i.compliance.low,
    `${describeTally(i.compliance)} privacy/compliance issue(s)`);

  drop(i.authenticity > 0, W.authenticity * i.authenticity,
    `${i.authenticity} incomplete/placeholder code finding(s)`);

  const a11yCount = i.accessibility.high + i.accessibility.medium + i.accessibility.low;
  drop(a11yCount > 0, W.a11yHigh * i.accessibility.high + W.a11yMedium * i.accessibility.medium + W.a11yLow * i.accessibility.low,
    `${describeTally(i.accessibility)} accessibility issue(s)`);

  drop(i.envVarsMissing > 0, W.envMissing * i.envVarsMissing,
    `${i.envVarsMissing} undocumented env var(s) — the app may not run for the user`);
  drop(i.architecture.cycles > 0, W.cycle * i.architecture.cycles, `${i.architecture.cycles} import cycle(s)`);
  drop(i.architecture.layering > 0, W.layering * i.architecture.layering, `${i.architecture.layering} layering violation(s)`);
  drop(i.dependencies.unused > 0, W.depUnused * i.dependencies.unused, `${i.dependencies.unused} unused dependency(ies)`);

  // Hard ceilings — calibration guardrails.
  const buildBreaker = i.architecture.unresolvedImports > 0 || i.dependencies.missing > 0;
  const hardBlock = i.security.high > 0 || i.compliance.high > 0 || !i.ready;
  if (buildBreaker) score = Math.min(score, 35);
  else if (hardBlock) score = Math.min(score, 60);

  // THE CEILING THAT WAS MISSING. Confidence is a claim about whether the app WORKS, and every input
  // above is a claim about whether the code READS well. Without any evidence that it ran, the honest
  // upper bound is "reasonably confident, review before shipping" — never "I'm confident this build is
  // solid". A run we watched FAIL caps it lower still.
  const runtime = i.runtimeProven ?? 'unknown';
  if (runtime === 'failed') score = Math.min(score, 40);
  else if (runtime === 'unknown') score = Math.min(score, 74);

  score = clamp(score);
  const band: ConfidenceBand = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low';

  // Positives — clean gates, in user-meaningful order.
  const positives: string[] = [];
  if (runtime === 'passed') positives.push('Proven to RUN — it came up and rendered in a real browser');
  if (!buildBreaker) positives.push('No build-breakers (imports & dependencies resolve)');
  if (secCount === 0) positives.push('No security issues');
  if (compCount === 0) positives.push('Launch-safe: no privacy/compliance blockers');
  if (i.authenticity === 0) positives.push('No fake/placeholder code');
  if (a11yCount === 0) positives.push('Accessible (no a11y issues)');
  if (i.envVarsMissing === 0) positives.push('Environment fully documented');
  if (i.architecture.cycles === 0 && i.architecture.layering === 0) positives.push('Clean architecture');

  const negSorted = negatives.sort((a, b) => b.weight - a.weight).map((n) => n.text);
  // Named as a gap in evidence, not as a defect in the app — because that is what it is, and because a
  // number that quietly drops with no stated reason is the thing nobody trusts.
  if (runtime === 'unknown') {
    negSorted.unshift('Nothing here was ever proven to RUN — no preview, so the render and journey checks all skipped');
  } else if (runtime === 'failed') {
    negSorted.unshift('The app was run and it did NOT work');
  }
  return { score, band, positives, negatives: negSorted };
}

function describeTally(t: SeverityTally): string {
  return (['high', 'medium', 'low'] as const)
    .filter((s) => t[s] > 0)
    .map((s) => `${t[s]} ${s}`)
    .join(' / ');
}

const STANCE: Record<ConfidenceBand, string> = {
  high: "I'm confident this build is solid.",
  medium: "I'm reasonably confident, but review the points below before shipping.",
  low: "I'm not confident yet — there are significant gaps to fix.",
};
const BAND_WORD: Record<ConfidenceBand, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** The honest, explained confidence block for the evaluate report ("here's why"). */
export function buildConfidenceSummary(c: BuildConfidence): string {
  const head = `Build confidence: ${c.score}% (${BAND_WORD[c.band]}) — ${STANCE[c.band]} Here's why:`;
  const pos = c.positives.slice(0, 5).map((p) => `  ✓ ${p}`);
  const neg = c.negatives.slice(0, 8).map((n) => `  ⚠ ${n} (lowered confidence)`);
  const body = neg.length === 0 ? ['  ✓ Every check is clean.', ...pos] : [...neg, ...pos];
  return [head, ...body].join('\n');
}
