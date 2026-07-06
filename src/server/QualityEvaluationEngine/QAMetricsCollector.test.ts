import { describe, it, expect } from 'vitest';
import { computeReliabilityMetrics } from './QAMetricsCollector';
import { BuildJob, JobStatus } from '../AppMakerLab/jobs/BuildJobManager';

// Minimal BuildJob factory — only the fields the collector reads.
function job(partial: Partial<BuildJob> & { status: JobStatus; createdAt: string; updatedAt: string }): BuildJob {
  return {
    id: partial.id || 'j',
    prompt: '',
    progress: 0,
    logs: [],
    ...partial,
    createdAt: new Date(partial.createdAt) as unknown as Date,
    updatedAt: new Date(partial.updatedAt) as unknown as Date,
  } as BuildJob;
}

const t = (s: string) => `2026-07-06T00:${s}:00.000Z`;

describe('computeReliabilityMetrics', () => {
  it('returns honest zeros for no jobs', () => {
    const m = computeReliabilityMetrics([]);
    expect(m).toEqual({
      mttdMs: 0, mttdSampleSize: 0, mttrMs: 0, mttrSampleSize: 0,
      recoveredFailures: 0, unresolvedFailures: 0, recoveryRate: 0, totalFailures: 0,
    });
  });

  it('MTTD = mean(failedAt - startedAt) over FAILED builds only', () => {
    const m = computeReliabilityMetrics([
      // failed after 2 min
      job({ status: JobStatus.FAILED, createdAt: t('00'), updatedAt: t('02') }),
      // failed after 4 min
      job({ status: JobStatus.FAILED, createdAt: t('10'), updatedAt: t('14') }),
      // a success must NOT influence MTTD
      job({ status: JobStatus.PREVIEW_READY, createdAt: t('20'), updatedAt: t('29') }),
    ]);
    expect(m.mttdSampleSize).toBe(2);
    expect(m.mttdMs).toBe(3 * 60_000); // mean(2min, 4min) = 3min
  });

  it('MTTR pairs a failure with the next success of the SAME app', () => {
    const m = computeReliabilityMetrics([
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('00'), updatedAt: t('05') }),
      job({ status: JobStatus.PREVIEW_READY, workspaceId: 'app-A', createdAt: t('06'), updatedAt: t('12') }),
    ]);
    expect(m.mttrSampleSize).toBe(1);
    expect(m.mttrMs).toBe(7 * 60_000); // 00:12 - 00:05 = 7min
    expect(m.recoveredFailures).toBe(1);
    expect(m.unresolvedFailures).toBe(0);
    expect(m.recoveryRate).toBe(1);
  });

  it('does NOT cross apps — app-B success cannot repair app-A failure', () => {
    const m = computeReliabilityMetrics([
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('00'), updatedAt: t('05') }),
      job({ status: JobStatus.PREVIEW_READY, workspaceId: 'app-B', createdAt: t('06'), updatedAt: t('12') }),
    ]);
    expect(m.recoveredFailures).toBe(0);
    expect(m.unresolvedFailures).toBe(1);
    expect(m.mttrSampleSize).toBe(0);
    expect(m.recoveryRate).toBe(0);
  });

  it('a failure with no later same-app success is unresolved (no invented repair time)', () => {
    const m = computeReliabilityMetrics([
      // success is BEFORE the failure → cannot be its repair
      job({ status: JobStatus.PREVIEW_READY, workspaceId: 'app-A', createdAt: t('00'), updatedAt: t('03') }),
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('05'), updatedAt: t('08') }),
    ]);
    expect(m.unresolvedFailures).toBe(1);
    expect(m.recoveredFailures).toBe(0);
    expect(m.mttrMs).toBe(0);
  });

  it('a failure with no workspaceId cannot be correlated → unresolved', () => {
    const m = computeReliabilityMetrics([
      job({ status: JobStatus.FAILED, createdAt: t('00'), updatedAt: t('05') }),
      job({ status: JobStatus.PREVIEW_READY, workspaceId: 'app-A', createdAt: t('06'), updatedAt: t('12') }),
    ]);
    expect(m.unresolvedFailures).toBe(1);
    expect(m.recoveredFailures).toBe(0);
  });

  it('consecutive failures each pair to the first subsequent success; recoveryRate is a fraction', () => {
    const m = computeReliabilityMetrics([
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('00'), updatedAt: t('02') }),
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('03'), updatedAt: t('05') }),
      job({ status: JobStatus.PREVIEW_READY, workspaceId: 'app-A', createdAt: t('06'), updatedAt: t('10') }),
      // a later lone failure that never recovers
      job({ status: JobStatus.FAILED, workspaceId: 'app-A', createdAt: t('20'), updatedAt: t('22') }),
    ]);
    expect(m.totalFailures).toBe(3);
    expect(m.recoveredFailures).toBe(2); // both early failures recover at 00:10
    expect(m.unresolvedFailures).toBe(1);
    expect(m.mttrSampleSize).toBe(2);
    expect(m.mttrMs).toBe(Math.round(((10 - 2) + (10 - 5)) / 2 * 60_000)); // mean(8min, 5min) = 6.5min
    expect(m.recoveryRate).toBeCloseTo(2 / 3, 5);
  });
});
