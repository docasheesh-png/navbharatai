import { describe, it, expect } from 'vitest';
import { summarizeFailurePatterns, summarizeBuildTimes, type FailureAnalyticsInput } from './buildReportAnalytics';

const r = (ok: boolean | null, rootCause: string | null, appLabel?: string): FailureAnalyticsInput => ({ ok, rootCause, appLabel });

describe('summarizeFailurePatterns — data-driven failure signal', () => {
  it('counts only FAILED builds with a rootCause and buckets by known category', () => {
    const reports: FailureAnalyticsInput[] = [
      r(false, '1 React Rules-of-Hooks violation(s) (crash at runtime): useMemo@src/hooks/useChartData.ts:86', 'Finance app'),
      r(false, '2 React Rules-of-Hooks violation(s) (crash at runtime): useEffect@src/x.tsx:10', 'Notes app'),
      r(false, 'Build exceeded the 1740s wall-clock cap and was stopped.', 'Big app'),
      r(true, 'ignored — this build succeeded', 'Good app'),   // not counted (ok)
      r(false, null, 'No cause'),                               // not counted (no rootCause)
    ];
    const s = summarizeFailurePatterns(reports);
    expect(s.totalReports).toBe(5);
    expect(s.totalFailed).toBe(3);
    const hooks = s.patterns.find((p) => p.label === 'React Rules-of-Hooks violation');
    expect(hooks?.count).toBe(2);               // both hooks failures grouped despite different files/numbers
    expect(hooks?.apps).toContain('Finance app');
    expect(s.patterns.some((p) => /wall-clock/i.test(p.label))).toBe(true);
  });

  it('sorts by frequency (most common failure first)', () => {
    const reports: FailureAnalyticsInput[] = [
      r(false, 'Cannot find module ./x — unresolved import'),
      r(false, 'unresolved import: ./y'),
      r(false, 'unresolved import: ./z'),
      r(false, 'Syntax error: handleExportCSV has already been declared'),
    ];
    const s = summarizeFailurePatterns(reports);
    expect(s.patterns[0].key).toBe('dependency-error');
    expect(s.patterns[0].count).toBe(3);
  });

  it('an unknown cause is a STABLE "Other" whose raw sentence rides in the sample (nothing dropped)', () => {
    const s = summarizeFailurePatterns([
      r(false, 'Weird novel failure #42 in "SomeModule.tsx" at 03:00'),
      r(false, 'Weird novel failure #99 in "OtherModule.tsx" at 04:00'),
    ]);
    expect(s.totalFailed).toBe(2);
    expect(s.patterns[0].count).toBe(2);
    expect(s.patterns[0].key).toBe('other');
    expect(s.patterns[0].label).not.toContain('Weird novel failure');
    expect(s.patterns[0].sample).toContain('Weird novel failure #42');
  });

  it('is robust to junk input', () => {
    expect(summarizeFailurePatterns(undefined as never).totalFailed).toBe(0);
    expect(summarizeFailurePatterns([]).patterns).toEqual([]);
    expect(summarizeFailurePatterns([r(false, '   ')]).totalFailed).toBe(0);
  });
});

/**
 * 🔴 THE ADMIN'S CARD, 2026-09-17 — "4 failed of 51 report(s)", four rows at 25% each, three of them
 * one build's own sentence. A pattern panel whose rows are raw sentences cannot say "this recurs".
 */
describe('the "Top failure patterns" card never shows a raw sentence as a pattern', () => {
  const CARD = [
    r(false, '🔍 I analyzed your project — no files were changed. Overview:\nStack: React + Vite\n3 files', 'Analysis turn'),
    r(false, 'Error: nothing is listening on that port — the dev server did not come up', 'Sandbox app'),
    r(false, 'The GLM rung answered inside its clock and produced nothing, because our own output ceiling was spent before the answer began — "starved".', 'Starved app'),
    r(false, "Tool call failed: edit_file: old_string not found in src/App.tsx. The string you supplied does not appear in the file.", 'Edit-miss app'),
  ];

  it('the four rows classify to STABLE labels, and the sentence survives only as the sample', () => {
    const s = summarizeFailurePatterns(CARD);
    expect(s.totalFailed).toBe(4);
    const keys = s.patterns.map((p) => p.key).sort();
    expect(keys).toEqual(['empty-build', 'preview-failed', 'provider-starved', 'tool-call-failed']);
    for (const p of s.patterns) {
      expect(p.label).not.toMatch(/^🔍|^The GLM rung|^Tool call failed/);
      expect(p.label.length).toBeLessThan(90);
    }
    expect(s.patterns.find((p) => p.key === 'empty-build')?.sample).toContain('no files were changed');
  });

  it('🔴 the build\'s own OUTCOME code beats the sentence — a filed report that carries it is named by it', () => {
    // The report meta now projects the code (AdminBuildReportStore). Text alone would say "tool call
    // failed"; the build itself recorded that it produced nothing, and that is the failure.
    const s = summarizeFailurePatterns([{
      ...CARD[3], outcomeCode: 'OUTCOME_EMPTY_BUILD', outcomeSeverity: 'error',
    }]);
    expect(s.patterns[0].key).toBe('empty-build');
    expect(s.patterns[0].label).toBe('No files were produced');
  });

  it('a successful advisory-capped build is never a failure row, whatever its rootCause says', () => {
    const s = summarizeFailurePatterns([{
      ok: true, rootCause: 'Build outcome: STOPPED — the app was built; the post-build advisory pass was cut short by its 2-minute cap.',
      outcomeCode: 'OUTCOME_STOPPED', outcomeSeverity: 'warning',
    }]);
    expect(s.totalFailed).toBe(0);
  });

  it('🔒 REVERSION GUARD: the retired classifier and its bare-word "port" rule are gone', () => {
    // `/port/` matched "report", "import", "support" and "export" — an unresolved-import failure was a
    // "sandbox" one. A bare common word is not a pattern.
    const s = summarizeFailurePatterns([r(false, 'unresolved import: ./support/report')]);
    expect(s.patterns[0].key).toBe('dependency-error');
  });
});

describe('summarizeBuildTimes — the speed signal (M6-S6.1)', () => {
  const b = (ms: number | null, appLabel?: string): FailureAnalyticsInput => ({ ok: true, rootCause: null, appLabel, buildMs: ms });

  it('computes avg, median and the slowest builds', () => {
    const s = summarizeBuildTimes([
      b(60_000, 'Fast app'),
      b(120_000, 'Medium app'),
      b(600_000, 'Slow app'),
    ]);
    expect(s.counted).toBe(3);
    expect(s.avgMs).toBe(260_000);
    expect(s.medianMs).toBe(120_000);
    expect(s.slowest[0]).toEqual({ app: 'Slow app', ms: 600_000 });
  });

  it('ignores builds without a usable duration', () => {
    const s = summarizeBuildTimes([b(null), b(0), b(-5), b(90_000, 'Real'), { ok: true, rootCause: null } as FailureAnalyticsInput]);
    expect(s.counted).toBe(1);
    expect(s.avgMs).toBe(90_000);
    expect(s.slowest[0].app).toBe('Real');
  });

  it('is robust to empty / junk input', () => {
    expect(summarizeBuildTimes([]).counted).toBe(0);
    expect(summarizeBuildTimes(undefined as never).avgMs).toBe(0);
    expect(summarizeBuildTimes([]).slowest).toEqual([]);
  });
});
