import { describe, it, expect } from 'vitest';
import { buildHealthFromDiagnostics } from './buildHealthCard';
import type { BuildDiagnosticsReport, BuildIssue } from './BuildDiagnostics';

// T1-health-card: derive an honest BuildHealth from the finished diagnostics. Pure.

const issue = (over: Partial<BuildIssue> = {}): BuildIssue => ({
  ts: 1, phase: 'build', severity: 'error', code: 'X', message: 'a problem', autoResolved: false, ...over,
});

const report = (problems: BuildIssue[]): BuildDiagnosticsReport => ({
  schema: 'navbharatai.v3.build-diagnostics/1',
  startedAt: 0,
  counts: { total: problems.length, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
  issues: problems,
  problems,
} as BuildDiagnosticsReport);

/** The one record that means "we opened the app in a real browser and it rendered". */
const PROVEN = issue({ code: 'OUTCOME_BUILD_SUCCESS', severity: 'info', message: 'Build outcome: BUILD_SUCCESS', autoResolved: true });

describe('buildHealthFromDiagnostics', () => {
  /**
   * 🔒 A PERFECT SCORE IS EARNED, NOT DEFAULTED (admin screenshot 2026-08-22).
   *
   * These four assertions used to expect 100/100 for a clean build with NO proof it ran, and that
   * expectation was the bug: the score starts at 100 and subtracts problems, so "nothing was found"
   * and "nothing was ever looked at" produce the same number. The card printed "READY · 100/100"
   * directly above the build's own text saying the app could not compile, over a preview that never
   * came up.
   */
  it('a clean build that was never SEEN RUNNING is capped below perfect, and says why', () => {
    const h = buildHealthFromDiagnostics(report([]), true);
    expect(h.score).toBe(85);
    expect(h.provenRunning).toBe(false);
    expect(h.warnings.join(' ')).toMatch(/not seen running/i);
    // Deliberately still READY: we did not see it work, and we did not see it fail either. Claiming
    // breakage would be the opposite lie.
    expect(h.ready).toBe(true);
  });

  it('a clean build PROVEN running earns the full 100, with no caveat line', () => {
    const h = buildHealthFromDiagnostics(report([PROVEN]), true);
    expect(h.score).toBe(100);
    expect(h.provenRunning).toBe(true);
    expect(h.warnings).toEqual([]);
  });

  it('an unresolved error is a blocker → not ready, score drops', () => {
    const h = buildHealthFromDiagnostics(report([issue({ message: 'tsc failed' })]), true);
    expect(h.ready).toBe(false);
    expect(h.blockers).toEqual(['tsc failed']);
    expect(h.score).toBe(75); // 100 - 25
  });

  // Deep-test 2026-07-18: the FINAL syntax re-verify records OUTCOME_SYNTAX_ERROR when the built app
  // doesn't parse (e.g. a duplicate `handleExportCSV` reintroduced by a late repair). That must flip the
  // card OFF "READY" even on an ok build — a "READY" app that won't compile is the exact dishonesty.
  it('an unresolved OUTCOME_SYNTAX_ERROR forces NOT READY (never "READY" for an app that won\'t compile)', () => {
    const h = buildHealthFromDiagnostics(report([
      issue({ code: 'OUTCOME_SYNTAX_ERROR', message: "1 file(s) do not parse — Identifier 'handleExportCSV' has already been declared", autoResolved: false }),
    ]), true);
    expect(h.ready).toBe(false);
    expect(h.blockers.join(' ')).toMatch(/handleExportCSV/);
  });

  // Deep-test 2026-07-18: a RUNTIME crash the parser can't see ("onLinkClick is not a function") — the
  // preview self-check records OUTCOME_PREVIEW_FAILED. That must also flip the card OFF "READY".
  it('an unresolved OUTCOME_PREVIEW_FAILED forces NOT READY (a crashing app is never "READY")', () => {
    const h = buildHealthFromDiagnostics(report([
      issue({ code: 'OUTCOME_PREVIEW_FAILED', message: 'The live preview did not render/run cleanly: console: onLinkClick is not a function', autoResolved: false }),
    ]), true);
    expect(h.ready).toBe(false);
    expect(h.blockers.join(' ')).toMatch(/onLinkClick/);
  });

  it('unresolved warnings lower the score but do not block readiness', () => {
    const h = buildHealthFromDiagnostics(report([
      PROVEN,
      issue({ severity: 'warning', message: 'no error boundary' }),
      issue({ severity: 'warning', message: 'missing alt text' }),
    ]), true);
    expect(h.ready).toBe(true);
    expect(h.warnings).toEqual(['no error boundary', 'missing alt text']);
    expect(h.score).toBe(88); // 100 - 6 - 6
  });

  it('a resolved (autoResolved) error is NOT counted as a current blocker', () => {
    const h = buildHealthFromDiagnostics(report([PROVEN, issue({ autoResolved: true, message: 'fixed itself' })]), true);
    expect(h.ready).toBe(true);
    expect(h.blockers).toEqual([]);
    expect(h.score).toBe(100);
  });

  it('a not-ok build is never ready even with no captured blocker', () => {
    const h = buildHealthFromDiagnostics(report([]), false);
    expect(h.ready).toBe(false);
    expect(h.score).toBe(45);
  });

  it('dedupes repeated messages and caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => issue({ severity: 'warning', message: `w${i % 3}` }));
    const h = buildHealthFromDiagnostics(report([PROVEN, ...many]), true);
    expect(h.warnings).toEqual(['w0', 'w1', 'w2']); // deduped
  });

  it('the unproven caveat never crowds out real warnings past the cap', () => {
    // It is prepended, so a build with a full list of real findings still shows them; the list is
    // capped afterwards. A caveat that hid actual problems would be a worse lie than the one it fixes.
    const many = Array.from({ length: 10 }, (_, i) => issue({ severity: 'warning', message: `w${i}` }));
    const h = buildHealthFromDiagnostics(report(many), true);
    expect(h.warnings[0]).toMatch(/not seen running/i);
    expect(h.warnings.length).toBeLessThanOrEqual(6);
    expect(h.warnings).toContain('w0');
  });

  it('a build with no report at all is UNPROVEN — the emptiest possible evidence is not perfection', () => {
    const h = buildHealthFromDiagnostics(undefined, true);
    expect(h.score).toBe(85);
    expect(h.provenRunning).toBe(false);
    expect(h.ready).toBe(true);
    const bad = buildHealthFromDiagnostics(undefined, false);
    expect(bad.ready).toBe(false);
  });
});
