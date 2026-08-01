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
    expect(s.patterns[0].label).toBe('Unresolved / missing imports');
    expect(s.patterns[0].count).toBe(3);
  });

  it('falls back to a normalised signature for an unknown cause (nothing dropped)', () => {
    const s = summarizeFailurePatterns([
      r(false, 'Weird novel failure #42 in "SomeModule.tsx" at 03:00'),
      r(false, 'Weird novel failure #99 in "OtherModule.tsx" at 04:00'),
    ]);
    // Both normalise to the same signature → grouped into one bucket of 2.
    expect(s.totalFailed).toBe(2);
    expect(s.patterns[0].count).toBe(2);
  });

  it('is robust to junk input', () => {
    expect(summarizeFailurePatterns(undefined as never).totalFailed).toBe(0);
    expect(summarizeFailurePatterns([]).patterns).toEqual([]);
    expect(summarizeFailurePatterns([r(false, '   ')]).totalFailed).toBe(0);
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
