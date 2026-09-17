import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import {
  predictsBuildFailure,
  prodBuildOverrulesPredictions,
  overruledByRealBuildMessage,
} from '../src/server/AgentV3/buildFailurePrediction';

/**
 * 🔴 THE REPORT (build e706e068, 2026-09-17 — "Build a full-fledged school management system (ERP)",
 * free Weak engine, 26.8 minutes, 40 model calls).
 *
 * The timeline, in its own timestamps:
 *
 *   t+1251s  READINESS_BLOCKER  1 unresolved import(s) — the build will fail: App.tsx -> ./components/TransportRequest
 *   t+1251s  READINESS_BLOCKER  2 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)
 *   t+1440s  READINESS_BLOCKER  1 unresolved import(s) — the build will fail: App.tsx -> ./components/TransportRequest
 *   t+1440s  RENDER_RESCUE      the live preview renders cleanly (real-browser verified)
 *   t+1512s  PROD_BUILD_OK      The production build succeeded — this app is ready to publish and to package.
 *   t+1593s  RELEASE_GATE       RED — Not shippable — 3 build-breaking blocker(s)
 *   t+1593s  OUTCOME_RELEASE_GATE_RED → verdict corrected to NOT ok → "You have NOT been charged"
 *
 * TWO independent defects produced that "3":
 *   1. the SAME blocker was recorded twice, 189 seconds apart, and counted twice;
 *   2. a prediction that the build would fail was still counted 81 seconds after the build RAN and
 *      SUCCEEDED on the same tree.
 *
 * The honest count was ONE.
 */
const IMPORT_BLOCKER = '1 unresolved import(s) — the build will fail: App.tsx -> ./components/TransportRequest';
const FAKE_CODE_BLOCKER = '2 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)';

function diagWithTheRealTimeline() {
  const d = new BuildDiagnostics('e706e068');
  d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: IMPORT_BLOCKER, autoResolved: false, ts: 1251 });
  d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: FAKE_CODE_BLOCKER, autoResolved: false, ts: 1252 });
  // 189 seconds and many entries later — NOT back-to-back, so record()'s repeat-collapse cannot see it.
  d.record({ phase: 'tool', severity: 'warning', code: 'TOOL_ERROR', message: "path 'src/components/TransportRequest.tsx' does not exist", autoResolved: false, ts: 1298 });
  d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: IMPORT_BLOCKER, autoResolved: false, ts: 1440 });
  return d;
}

describe('the same blocker, observed twice, is one blocker', () => {
  it('🔴 the real report: three READINESS_BLOCKER records, but only TWO distinct defects', () => {
    const d = diagWithTheRealTimeline();
    expect(d.shippingIssueCount('error')).toBe(2);
  });

  it('every record stays on the timeline — only the COUNT is de-duplicated', () => {
    const d = diagWithTheRealTimeline();
    const blockers = d.report().issues.filter((i) => i.code === 'READINESS_BLOCKER');
    expect(blockers).toHaveLength(3); // nothing was deleted or hidden
  });

  it('two genuinely different blockers still count as two', () => {
    const d = new BuildDiagnostics('b');
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: 'blocker A', autoResolved: false, ts: 1 });
    d.record({ phase: 'tool', severity: 'warning', code: 'X', message: 'noise', autoResolved: false, ts: 2 });
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: 'blocker B', autoResolved: false, ts: 3 });
    expect(d.shippingIssueCount('error')).toBe(2);
  });

  it('the same message under a DIFFERENT code is still two findings', () => {
    const d = new BuildDiagnostics('b');
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: 'same words', autoResolved: false, ts: 1 });
    d.record({ phase: 'tool', severity: 'warning', code: 'Y', message: 'noise', autoResolved: false, ts: 2 });
    d.record({ phase: 'readiness', severity: 'error', code: 'OTHER_CODE', message: 'same words', autoResolved: false, ts: 3 });
    expect(d.shippingIssueCount('error')).toBe(2);
  });
});

describe('a real production build overrules a prediction that it would fail', () => {
  it('🔴 the real report: after PROD_BUILD_OK the count falls to the ONE honest blocker', () => {
    const d = diagWithTheRealTimeline();
    expect(d.shippingIssueCount('error')).toBe(2);

    const cleared = d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_OK', before: 1512 });

    expect(cleared).toBe(2); // both recordings of the forecast
    // What remains is the finding a successful build says NOTHING about: the placeholders.
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('the placeholder blocker is NEVER touched — a build compiles a placeholder happily', () => {
    const d = diagWithTheRealTimeline();
    d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_OK', before: 1512 });
    const fake = d.report().issues.find((i) => i.message === FAKE_CODE_BLOCKER);
    expect(fake?.autoResolved).toBe(false);
  });

  it('records ONE honest line naming both sides of the contradiction', () => {
    const d = diagWithTheRealTimeline();
    d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_OK', before: 1512 });
    const note = d.report().issues.find((i) => i.code === 'BUILD_PREDICTION_OVERRULED');
    expect(note).toBeTruthy();
    expect(note?.message).toContain('predicted');
    expect(note?.message).toContain('SUCCEEDED');
  });

  it('🔒 a FAILED production build clears nothing', () => {
    const d = diagWithTheRealTimeline();
    expect(d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_FAILED', before: 1512 })).toBe(0);
    expect(d.shippingIssueCount('error')).toBe(2);
  });

  it('🔒 an UNVERIFIED build clears nothing — an absence of proof is not proof', () => {
    const d = diagWithTheRealTimeline();
    expect(d.resolveBuildFailurePredictions({ ran: false, code: 'PROD_BUILD_UNVERIFIED', before: 1512 })).toBe(0);
    expect(d.resolveBuildFailurePredictions({ ran: false, code: 'PROD_BUILD_OK', before: 1512 })).toBe(0);
    expect(d.shippingIssueCount('error')).toBe(2);
  });

  it('🔒 a prediction recorded AFTER the build ran still stands', () => {
    const d = new BuildDiagnostics('b');
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: IMPORT_BLOCKER, autoResolved: false, ts: 9000 });
    expect(d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_OK', before: 1512 })).toBe(0);
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('never throws on junk', () => {
    const d = new BuildDiagnostics('b');
    expect(() => d.resolveBuildFailurePredictions({ ran: true, code: 'PROD_BUILD_OK', before: NaN })).not.toThrow();
  });
});

describe('predictsBuildFailure — matched on the CLAIM, narrow by design', () => {
  it('matches exactly the two sentences Readiness.ts composes about the build', () => {
    expect(predictsBuildFailure(IMPORT_BLOCKER)).toBe(true);
    expect(predictsBuildFailure('2 server-only Node builtin import(s) in front-end code — these break the browser build: a -> fs')).toBe(true);
  });

  it('does NOT match findings a successful build says nothing about', () => {
    expect(predictsBuildFailure(FAKE_CODE_BLOCKER)).toBe(false);
    expect(predictsBuildFailure('Secret leak: a real .env is not gitignored')).toBe(false);
    expect(predictsBuildFailure('1 high-severity security issue(s)')).toBe(false);
    expect(predictsBuildFailure('readiness score 30/100 is below the 50/100 bar')).toBe(false);
    expect(predictsBuildFailure('Runnability: no index.html')).toBe(false);
  });

  it('never throws on junk', () => {
    expect(predictsBuildFailure(null)).toBe(false);
    expect(predictsBuildFailure(undefined)).toBe(false);
    expect(predictsBuildFailure('')).toBe(false);
  });
});

describe('prodBuildOverrulesPredictions', () => {
  it('only an OK verdict that really ran', () => {
    expect(prodBuildOverrulesPredictions('PROD_BUILD_OK', true)).toBe(true);
    expect(prodBuildOverrulesPredictions('PROD_BUILD_OK', false)).toBe(false);
    expect(prodBuildOverrulesPredictions('PROD_BUILD_FAILED', true)).toBe(false);
    expect(prodBuildOverrulesPredictions('PROD_BUILD_UNVERIFIED', true)).toBe(false);
    expect(prodBuildOverrulesPredictions('SOMETHING_NEW', true)).toBe(false);
  });

  it('the message names a count', () => {
    expect(overruledByRealBuildMessage(2)).toContain('2 readiness finding(s)');
    expect(overruledByRealBuildMessage(0)).toContain('1 readiness finding(s)');
  });
});

/**
 * 🔒 REVERSION GUARD — the wiring, which is the half that rots silently. The behavioural tests above
 * exercise the pure logic; this asserts the route actually calls it at the one moment the measurement
 * exists. Proven by reversion.
 */
describe('the wiring — proven by reversion', () => {
  const ROUTE = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the route overrules predictions with the prod-build gate\'s OWN verdict', () => {
    expect(ROUTE).toContain('buildDiag.resolveBuildFailurePredictions({ ran, code: verdict.code');
  });
});
