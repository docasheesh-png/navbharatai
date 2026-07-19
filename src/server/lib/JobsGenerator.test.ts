import { describe, it, expect } from 'vitest';
import { generateJobsIntegration, isJobsProvider } from './JobsGenerator';

describe('generateJobsIntegration — BullMQ (Redis)', () => {
  const c = generateJobsIntegration('bullmq');

  it('emits a server helper with enqueue + worker, and the REQUIRED BullMQ connection option', () => {
    const server = c.files['server/lib/jobs.ts'];
    expect(server).toContain("import { Queue, Worker } from 'bullmq'");
    expect(server).toContain("import IORedis from 'ioredis'");
    expect(server).toContain('maxRetriesPerRequest: null'); // required by BullMQ workers — the classic footgun
    expect(server).toContain('export async function enqueueJob(queue: string');
    expect(server).toContain('export function processJobs(queue: string');
    expect(server).toContain('new Worker(queue');
    expect(server).toContain('REDIS_URL');
  });

  it('declares REDIS_URL + bullmq & ioredis deps + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['REDIS_URL']);
    expect(c.dependencies).toEqual([
      { name: 'bullmq', version: '^5' },
      { name: 'ioredis', version: '^5' },
    ]);
    expect(c.files['.env.example']).toBe('REDIS_URL=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateJobsIntegration — pg-boss (Postgres)', () => {
  const c = generateJobsIntegration('pgboss');

  it('emits a server helper that starts once and uses send/work, pinned to a stable major', () => {
    const server = c.files['server/lib/jobs.ts'];
    expect(server).toContain("import PgBoss from 'pg-boss'");
    expect(server).toContain('boss.start()');
    expect(server).toContain('boss.send(queue, data)');
    expect(server).toContain('boss.work(queue');
    expect(server).toContain('DATABASE_URL');
    expect(c.dependencies).toEqual([{ name: 'pg-boss', version: '^9' }]);
    expect(c.envKeys).toEqual(['DATABASE_URL']);
  });

  it('shares a single start() promise so concurrent enqueues do not start pg-boss twice', () => {
    const server = c.files['server/lib/jobs.ts'];
    expect(server).toContain('let starting: Promise<void> | null = null');
    expect(server).toContain('if (!starting) starting = boss.start()');
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real values (blank RHS only) for both providers', () => {
    for (const p of ['bullmq', 'pgboss'] as const) {
      const env = generateJobsIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isJobsProvider accepts the two supported providers, rejects everything else', () => {
    expect(isJobsProvider('bullmq')).toBe(true);
    expect(isJobsProvider('pgboss')).toBe(true);
    expect(isJobsProvider('kafka')).toBe(false);
    expect(isJobsProvider(undefined)).toBe(false);
  });
});
