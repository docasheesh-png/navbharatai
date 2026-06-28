import { describe, it, expect, beforeEach } from 'vitest';
import { BuildJobManager, JobStatus, type BuildJob } from './BuildJobManager';
import type { JobStore } from './store/JobStore';

/** Minimal in-memory JobStore for deterministic idempotency tests. */
class InMemoryJobStore implements JobStore {
  jobs = new Map<string, BuildJob>();
  async saveJob(job: BuildJob): Promise<void> { this.jobs.set(job.id, { ...job }); }
  async getJob(id: string): Promise<BuildJob | null> { return this.jobs.get(id) ?? null; }
  async updateJobStatus(id: string, status: JobStatus, progress: number, log?: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job not found');
    job.status = status; job.progress = progress; if (log) job.logs.push(log);
  }
  async findJobByIdempotencyKey(key: string): Promise<BuildJob | null> {
    if (!key) return null;
    const matches = [...this.jobs.values()].filter(j => j.idempotencyKey === key);
    matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return matches[0] ?? null;
  }
}

describe('BuildJobManager — idempotency (P1.4)', () => {
  let store: InMemoryJobStore;
  beforeEach(() => { store = new InMemoryJobStore(); BuildJobManager.useStore(store); });

  it('creates a job and persists it', async () => {
    const id = await BuildJobManager.createJob('build a todo app');
    const job = await BuildJobManager.getJob(id);
    expect(job?.prompt).toBe('build a todo app');
    expect(job?.status).toBe(JobStatus.QUEUED);
  });

  it('two un-keyed createJob calls produce DISTINCT job ids (no same-ms collision)', async () => {
    const a = await BuildJobManager.createJob('p1');
    const b = await BuildJobManager.createJob('p2');
    expect(a).not.toBe(b);
    expect(store.jobs.size).toBe(2);
  });

  it('same idempotency key → SAME job id, only ONE build created (no double-run)', async () => {
    const first = await BuildJobManager.createJob('build app', 'key-123');
    const second = await BuildJobManager.createJob('build app', 'key-123');
    expect(second).toBe(first);
    expect(store.jobs.size).toBe(1);
    const job = await BuildJobManager.getJob(first);
    expect(job?.idempotencyKey).toBe('key-123');
  });

  it('reuses an IN-FLIGHT keyed job regardless of its progress', async () => {
    const id = await BuildJobManager.createJob('build app', 'key-x');
    await BuildJobManager.updateStatus(id, JobStatus.BUILDING, 80);
    const again = await BuildJobManager.createJob('build app', 'key-x');
    expect(again).toBe(id);
    expect(store.jobs.size).toBe(1);
  });

  it('after a terminal FAILED job, the same key creates a NEW job (legit retry)', async () => {
    const first = await BuildJobManager.createJob('build app', 'key-retry');
    await BuildJobManager.updateStatus(first, JobStatus.FAILED, 0, 'boom');
    const second = await BuildJobManager.createJob('build app', 'key-retry');
    expect(second).not.toBe(first);
    expect(store.jobs.size).toBe(2);
  });

  it('different keys never collide', async () => {
    const a = await BuildJobManager.createJob('build app', 'key-a');
    const b = await BuildJobManager.createJob('build app', 'key-b');
    expect(a).not.toBe(b);
    expect(store.jobs.size).toBe(2);
  });

  describe('findExisting', () => {
    it('returns the in-flight job for a known key', async () => {
      const id = await BuildJobManager.createJob('build app', 'key-find');
      const found = await BuildJobManager.findExisting('key-find');
      expect(found?.id).toBe(id);
    });
    it('returns null for an unknown key', async () => {
      expect(await BuildJobManager.findExisting('nope')).toBeNull();
    });
    it('returns null once the keyed job has terminally FAILED', async () => {
      const id = await BuildJobManager.createJob('build app', 'key-f');
      await BuildJobManager.updateStatus(id, JobStatus.FAILED, 0);
      expect(await BuildJobManager.findExisting('key-f')).toBeNull();
    });
  });
});
