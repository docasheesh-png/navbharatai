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

describe('buildHealthFromDiagnostics', () => {
  it('a clean ok build is ready with score 100 and no blockers/warnings', () => {
    const h = buildHealthFromDiagnostics(report([]), true);
    expect(h).toEqual({ score: 100, ready: true, blockers: [], warnings: [] });
  });

  it('an unresolved error is a blocker → not ready, score drops', () => {
    const h = buildHealthFromDiagnostics(report([issue({ message: 'tsc failed' })]), true);
    expect(h.ready).toBe(false);
    expect(h.blockers).toEqual(['tsc failed']);
    expect(h.score).toBe(75); // 100 - 25
  });

  it('unresolved warnings lower the score but do not block readiness', () => {
    const h = buildHealthFromDiagnostics(report([
      issue({ severity: 'warning', message: 'no error boundary' }),
      issue({ severity: 'warning', message: 'missing alt text' }),
    ]), true);
    expect(h.ready).toBe(true);
    expect(h.warnings).toEqual(['no error boundary', 'missing alt text']);
    expect(h.score).toBe(88); // 100 - 6 - 6
  });

  it('a resolved (autoResolved) error is NOT counted as a current blocker', () => {
    const h = buildHealthFromDiagnostics(report([issue({ autoResolved: true, message: 'fixed itself' })]), true);
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
    const h = buildHealthFromDiagnostics(report(many), true);
    expect(h.warnings).toEqual(['w0', 'w1', 'w2']); // deduped
  });

  it('tolerates a missing diagnostics report', () => {
    const h = buildHealthFromDiagnostics(undefined, true);
    expect(h).toEqual({ score: 100, ready: true, blockers: [], warnings: [] });
    const bad = buildHealthFromDiagnostics(undefined, false);
    expect(bad.ready).toBe(false);
  });
});
