// SCHEDULED JOBS RUN EVEN WHEN NO INSTANCE IS AWAKE — AND STILL ONLY ONCE PER SLOT (Q-159, 2026-10-05).
//
// The scheduler ticks inside a live instance and Cloud Run scales to zero, so with no traffic the retention
// purge, the hosting bill, the plan reminders and the uptime probes did not run at all. The admin chose
// Cloud Scheduler: it calls `POST /api/internal/jobs/:id/run`. Two triggers for one job is a new way to run
// it twice, so every claim now names its SLOT, and the slot is kept in the lease document.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scheduler, lastSlotAtOrBefore, scheduler } from '../src/server/lib/ScheduledJobs';
import { claimJobRun, slotAlreadyClaimed, JOB_LEASE_COLLECTION, type JobLease } from '../src/server/lib/jobLease';
import { registerScheduledJobRoutes, schedulerSecretMatches } from '../src/server/routes/scheduledJobs';

const root = join(__dirname, '..');
const H = 60 * 60 * 1000;
const DAY = 24 * H;

describe('lastSlotAtOrBefore — the run every trigger agrees on', () => {
  it('a daily job: today\'s slot once its time has passed, yesterday\'s before it', () => {
    const base = Date.UTC(2026, 9, 5);
    const s = { kind: 'dailyAtUtc' as const, hour: 3, minute: 0 };
    expect(lastSlotAtOrBefore(s, base + 3 * H)).toBe(base + 3 * H);
    expect(lastSlotAtOrBefore(s, base + 3 * H + 5 * 60_000)).toBe(base + 3 * H);
    expect(lastSlotAtOrBefore(s, base + 2 * H)).toBe(base + 3 * H - DAY);
  });

  it('an interval job is aligned to the epoch, so instances booted at different times agree', () => {
    const s = { kind: 'everyMs' as const, ms: 15 * 60_000 };
    expect(lastSlotAtOrBefore(s, 15 * 60_000 * 7 + 1234)).toBe(15 * 60_000 * 7);
    expect(lastSlotAtOrBefore(s, 15 * 60_000 * 7 + 1234)).toBe(lastSlotAtOrBefore(s, 15 * 60_000 * 8 - 1));
  });
});

function fakeStore(initial: Record<string, JobLease> = {}) {
  const docs: Record<string, JobLease> = { ...initial };
  return {
    docs,
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
      get: async (ref: string) => ({ exists: ref in docs, data: () => docs[ref] }),
      set: (ref: string, value: Record<string, unknown>) => { docs[ref] = value as unknown as JobLease; },
    }),
  };
}

describe('one run per slot, whichever trigger comes first', () => {
  it('the tick ran the 03:00 slot; Cloud Scheduler at 03:30 (lease long expired) does not run it again', async () => {
    const store = fakeStore();
    const slot = Date.UTC(2026, 9, 5, 3);
    expect(await claimJobRun(store as any, { jobId: 'retention-purge', owner: 'warm', nowMs: slot, ttlMs: 60_000, slot })).toBe(true);
    expect(await claimJobRun(store as any, { jobId: 'retention-purge', owner: 'cold', nowMs: slot + 30 * 60_000, slot })).toBe(false);
    expect(store.docs[`${JOB_LEASE_COLLECTION}/retention-purge`].lastSlot).toBe(slot);
  });

  it('the next slot runs', async () => {
    const store = fakeStore();
    const slot = Date.UTC(2026, 9, 5, 3);
    await claimJobRun(store as any, { jobId: 'j', owner: 'a', nowMs: slot, ttlMs: 60_000, slot });
    expect(await claimJobRun(store as any, { jobId: 'j', owner: 'b', nowMs: slot + DAY, slot: slot + DAY })).toBe(true);
  });

  it('a claim without a slot keeps working as before, and keeps the recorded slot', async () => {
    const store = fakeStore({ [`${JOB_LEASE_COLLECTION}/j`]: { owner: 'x', expiresAt: 0, lastSlot: 42 } });
    expect(await claimJobRun(store as any, { jobId: 'j', owner: 'y', nowMs: 10 })).toBe(true);
    expect(store.docs[`${JOB_LEASE_COLLECTION}/j`].lastSlot).toBe(42);
    expect(slotAlreadyClaimed({ lastSlot: 42 }, undefined)).toBe(false);
    expect(slotAlreadyClaimed({ lastSlot: 42 }, 42)).toBe(true);
    expect(slotAlreadyClaimed({}, 42)).toBe(false);
  });

  it('the scheduler hands the slot to the claim for an exclusive job', async () => {
    const s = new Scheduler();
    const seen: Array<[string, number | undefined]> = [];
    s.setClaim(async (id, slot) => { seen.push([id, slot]); return true; });
    const now = Date.UTC(2026, 9, 5, 4, 10);
    s.register({ id: 'bill', exclusive: true, schedule: { kind: 'dailyAtUtc', hour: 4, minute: 0 }, handler: () => {} }, now);
    expect(await s.runNow('bill', now)).toBe(true);
    expect(seen).toEqual([['bill', Date.UTC(2026, 9, 5, 4, 0)]]);
  });
});

describe('POST /api/internal/jobs/:id/run', () => {
  const app = express();
  registerScheduledJobRoutes(app);
  let server: ReturnType<typeof app.listen>;
  let ran = 0;
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (id: string, secret?: string) =>
    fetch(`${base()}/api/internal/jobs/${id}/run`, { method: 'POST', headers: secret ? { 'x-scheduler-secret': secret } : {} });

  beforeAll(() => {
    server = app.listen(0);
    scheduler.register({ id: 'q159-test-job', exclusive: true, schedule: { kind: 'everyMs', ms: 60_000 }, handler: () => { ran++; } });
    scheduler.register({ id: 'q159-per-instance', schedule: { kind: 'everyMs', ms: 60_000 }, handler: () => {} });
  });
  afterAll(() => {
    server.close();
    scheduler.unregister('q159-test-job');
    scheduler.unregister('q159-per-instance');
    delete process.env.SCHEDULED_JOBS_SECRET;
  });

  it('without the key set, it says so and runs nothing', async () => {
    delete process.env.SCHEDULED_JOBS_SECRET;
    const r = await post('q159-test-job', 'anything');
    expect(r.status).toBe(503);
    expect(ran).toBe(0);
  });

  it('a wrong or missing secret is refused', async () => {
    process.env.SCHEDULED_JOBS_SECRET = 's3cret-value-for-the-test';
    expect((await post('q159-test-job')).status).toBe(401);
    expect((await post('q159-test-job', 's3cret-value-for-the-tesT')).status).toBe(401);
    expect(ran).toBe(0);
  });

  it('the right secret runs a one-instance job', async () => {
    process.env.SCHEDULED_JOBS_SECRET = 's3cret-value-for-the-test';
    const r = await post('q159-test-job', 's3cret-value-for-the-test');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: 'q159-test-job', ran: true });
    expect(ran).toBe(1);
  });

  it('a per-instance job or an unknown name is not runnable from outside', async () => {
    process.env.SCHEDULED_JOBS_SECRET = 's3cret-value-for-the-test';
    expect((await post('q159-per-instance', 's3cret-value-for-the-test')).status).toBe(404);
    expect((await post('nope', 's3cret-value-for-the-test')).status).toBe(404);
  });

  it('the secret compare is exact and constant-time', () => {
    expect(schedulerSecretMatches('abc', 'abc')).toBe(true);
    expect(schedulerSecretMatches('abc', 'abcd')).toBe(false);
    expect(schedulerSecretMatches('', '')).toBe(false);
    expect(schedulerSecretMatches('abc', undefined)).toBe(false);
  });
});

describe('the wiring', () => {
  it('the route is registered, and the plan sweep is a one-instance scheduler job — no private timer', () => {
    expect(readFileSync(join(root, 'server.ts'), 'utf8')).toContain('registerScheduledJobRoutes(app);');
    const sweep = readFileSync(join(root, 'src/server/lib/hostingPlanSweep.ts'), 'utf8');
    expect(sweep).toMatch(/scheduler\.register\(\{\s*id: HOSTING_PLAN_SWEEP_JOB,\s*exclusive: true/);
    expect(sweep).not.toMatch(/setInterval\(/);
  });
});
