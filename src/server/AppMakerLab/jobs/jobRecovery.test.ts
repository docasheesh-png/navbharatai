import { describe, it, expect, beforeEach } from 'vitest';
import { isStaleInFlight, staleRecoveryLog, DEFAULT_STALE_MS, NON_TERMINAL_STATUSES } from './jobRecovery';
import { BuildJobManager, JobStatus, type BuildJob } from './BuildJobManager';
import type { JobStore } from './store/JobStore';

const NOW = 1_800_000_000_000; // fixed clock (ms)

function job(partial: Partial<BuildJob> & { id: string; status: JobStatus; updatedAt: Date }): BuildJob {
  return {
    prompt: 'build a todo app',
    progress: 0,
    logs: [],
    createdAt: new Date(NOW - 60 * 60 * 1000),
    ...partial,
  } as BuildJob;
}

describe('isStaleInFlight (pure staleness rule)', () => {
  it('flags a non-terminal job whose heartbeat is older than the threshold', () => {
    const j = job({ id: 'a', status: JobStatus.BUILDING, updatedAt: new Date(NOW - (DEFAULT_STALE_MS + 1000)) });
    expect(isStaleInFlight(j, NOW)).toBe(true);
  });

  it('does NOT flag a fresh non-terminal job (recent heartbeat)', () => {
    const j = job({ id: 'a', status: JobStatus.BUILDING, updatedAt: new Date(NOW - 1000) });
    expect(isStaleInFlight(j, NOW)).toBe(false);
  });

  it('never flags terminal jobs, even with an ancient heartbeat', () => {
    const old = new Date(NOW - 24 * 60 * 60 * 1000);
    expect(isStaleInFlight(job({ id: 'a', status: JobStatus.PREVIEW_READY, updatedAt: old }), NOW)).toBe(false);
    expect(isStaleInFlight(job({ id: 'b', status: JobStatus.FAILED, updatedAt: old }), NOW)).toBe(false);
  });

  it('flags every non-terminal status once stale, and treats the boundary as not-yet-stale', () => {
    for (const status of NON_TERMINAL_STATUSES) {
      const stale = job({ id: 's', status: status as JobStatus, updatedAt: new Date(NOW - (DEFAULT_STALE_MS + 1)) });
      expect(isStaleInFlight(stale, NOW)).toBe(true);
    }
    // exactly at the threshold is NOT stale (strictly greater-than)
    const atBoundary = job({ id: 'x', status: JobStatus.QUEUED, updatedAt: new Date(NOW - DEFAULT_STALE_MS) });
    expect(isStaleInFlight(atBoundary, NOW)).toBe(false);
  });

  it('is safe against an unreadable timestamp (never throws, never flags)', () => {
    const j = job({ id: 'a', status: JobStatus.BUILDING, updatedAt: 'not-a-date' as any });
    expect(isStaleInFlight(j, NOW)).toBe(false);
  });

  it('respects a custom threshold', () => {
    const j = job({ id: 'a', status: JobStatus.GENERATING, updatedAt: new Date(NOW - 5000) });
    expect(isStaleInFlight(j, NOW, 1000)).toBe(true);
    expect(isStaleInFlight(j, NOW, 10_000)).toBe(false);
  });
});

describe('staleRecoveryLog', () => {
  it('reports an honest minute count (floored at 1)', () => {
    expect(staleRecoveryLog(11 * 60 * 1000)).toContain('~11 min');
    expect(staleRecoveryLog(10)).toContain('~1 min');
  });
});

// In-memory JobStore for the recovery integration test.
class MemJobStore implements JobStore {
  jobs = new Map<string, BuildJob>();
  async saveJob(j: BuildJob) { this.jobs.set(j.id, j); }
  async getJob(id: string) { return this.jobs.get(id) ?? null; }
  async updateJobStatus(id: string, status: JobStatus, progress: number, log?: string) {
    const j = this.jobs.get(id); if (!j) return;
    j.status = status; j.progress = progress; if (log) j.logs.push(log); j.updatedAt = new Date();
  }
  async findJobByIdempotencyKey() { return null; }
  async listRecentJobs() { return Array.from(this.jobs.values()); }
}

describe('BuildJobManager.recoverStaleJobs (durable-recovery pass)', () => {
  let store: MemJobStore;
  beforeEach(() => { store = new MemJobStore(); BuildJobManager.useStore(store); });

  it('marks ONLY stale in-flight jobs FAILED, leaving fresh and terminal jobs untouched', async () => {
    store.jobs.set('stale', job({ id: 'stale', status: JobStatus.BUILDING, updatedAt: new Date(NOW - (DEFAULT_STALE_MS + 1000)) }));
    store.jobs.set('fresh', job({ id: 'fresh', status: JobStatus.GENERATING, updatedAt: new Date(NOW - 1000) }));
    store.jobs.set('done', job({ id: 'done', status: JobStatus.PREVIEW_READY, updatedAt: new Date(NOW - (DEFAULT_STALE_MS + 1000)) }));

    const recovered = await BuildJobManager.recoverStaleJobs({ nowMs: NOW });

    expect(recovered).toEqual(['stale']);
    expect(store.jobs.get('stale')!.status).toBe(JobStatus.FAILED);
    expect(store.jobs.get('stale')!.logs.some(l => l.includes('interrupted'))).toBe(true);
    expect(store.jobs.get('fresh')!.status).toBe(JobStatus.GENERATING);
    expect(store.jobs.get('done')!.status).toBe(JobStatus.PREVIEW_READY);
  });

  it('returns [] when there is nothing to recover', async () => {
    store.jobs.set('fresh', job({ id: 'fresh', status: JobStatus.BUILDING, updatedAt: new Date(NOW - 1000) }));
    expect(await BuildJobManager.recoverStaleJobs({ nowMs: NOW })).toEqual([]);
  });
});
