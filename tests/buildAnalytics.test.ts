import { describe, it, expect } from 'vitest';
import { aggregateBuildAnalytics, percentile, failureSignature } from '../src/server/AppMakerLab/jobs/BuildAnalytics';
import { JobStatus, type BuildJob } from '../src/server/AppMakerLab/jobs/BuildJobManager';

/**
 * P-BRE.8 — build analytics aggregation.
 */
function job(over: Partial<BuildJob>): BuildJob {
  return {
    id: 'j', prompt: 'p', status: JobStatus.PREVIEW_READY, progress: 100, logs: [],
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:10Z'),
    ...over,
  } as BuildJob;
}

describe('BuildAnalytics — percentile', () => {
  it('handles empty + computes nearest-rank p95', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    const vals = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(vals, 95)).toBe(95);
  });
});

describe('BuildAnalytics — failureSignature', () => {
  it('uses the last log line, normalized + length-capped', () => {
    const j = job({ status: JobStatus.FAILED, logs: ['step 1', 'Error: Cannot find module abc123def456789'] });
    const sig = failureSignature(j);
    expect(sig).toContain('Cannot find module');
    expect(sig).toContain('<id>'); // long hash/id collapsed
  });
  it('falls back to Unknown failure with no logs', () => {
    expect(failureSignature(job({ status: JobStatus.FAILED, logs: [] }))).toBe('Unknown failure');
  });
});

describe('BuildAnalytics — aggregateBuildAnalytics', () => {
  it('returns honest zeros for no jobs', () => {
    const a = aggregateBuildAnalytics([]);
    expect(a.totalJobs).toBe(0);
    expect(a.successRate).toBe(0);
    expect(a.avgDurationMs).toBe(0);
    expect(a.topFailureTypes).toEqual([]);
  });

  it('computes success/failure rate over terminal jobs only', () => {
    const jobs = [
      job({ status: JobStatus.PREVIEW_READY }),
      job({ status: JobStatus.PREVIEW_READY }),
      job({ status: JobStatus.FAILED, logs: ['boom'] }),
      job({ status: JobStatus.BUILDING }), // non-terminal → excluded from rates
    ];
    const a = aggregateBuildAnalytics(jobs);
    expect(a.totalJobs).toBe(4);
    expect(a.terminalJobs).toBe(3);
    expect(a.successRate).toBeCloseTo(2 / 3, 5);
    expect(a.failureRate).toBeCloseTo(1 / 3, 5);
    expect(a.byStatus[JobStatus.BUILDING]).toBe(1);
  });

  it('computes average + p95 duration from terminal jobs', () => {
    const mk = (secs: number) => job({
      status: JobStatus.PREVIEW_READY,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date(new Date('2026-01-01T00:00:00Z').getTime() + secs * 1000),
    });
    const a = aggregateBuildAnalytics([mk(10), mk(20), mk(30)]);
    expect(a.avgDurationMs).toBe(20000);
    expect(a.p95DurationMs).toBe(30000);
  });

  it('ranks the top failure types by count', () => {
    const jobs = [
      job({ status: JobStatus.FAILED, logs: ['Error: missing import'] }),
      job({ status: JobStatus.FAILED, logs: ['Error: missing import'] }),
      job({ status: JobStatus.FAILED, logs: ['Error: type mismatch'] }),
    ];
    const a = aggregateBuildAnalytics(jobs);
    expect(a.topFailureTypes[0]).toEqual({ type: 'Error: missing import', count: 2 });
    expect(a.topFailureTypes.length).toBe(2);
  });
});
