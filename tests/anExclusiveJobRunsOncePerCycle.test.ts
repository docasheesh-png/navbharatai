/**
 * AN EXCLUSIVE JOB RUNS ONCE PER CYCLE, HOWEVER MANY INSTANCES ARE UP (performance audit 2026-10-11, F14).
 *
 * Each instance schedules an `everyMs` job from its OWN boot time, so twenty instances are due at twenty
 * different moments across the interval. The claim's lease lasts 10 minutes; the uptime sweep and the monitor
 * alerts run every 15. So an instance whose turn came after the lease lapsed claimed it and ran the job again —
 * several runs per cycle. The tick now asks the durable run record first and joins the shared cadence.
 *
 * Simulated here with real `Scheduler`s, the real `leaseDecision`/`nextLease` rule and a shared in-memory store.
 */
import { describe, it, expect } from 'vitest';
import { Scheduler, type RunLog } from '../src/server/lib/ScheduledJobs';
import { leaseDecision, nextLease, DEFAULT_LEASE_TTL_MS, type JobLease } from '../src/server/lib/jobLease';

const MIN = 60_000;

function cluster(instances: number, opts: { withRunLog: boolean }) {
  const leases = new Map<string, JobLease>();
  const lastRuns = new Map<string, number>();
  let now = 0;
  let runs = 0;
  const runLog: RunLog = {
    lastRun: async (id) => lastRuns.get(id) ?? null,
    record: async (id, at) => { lastRuns.set(id, at); },
  };
  const schedulers = Array.from({ length: instances }, (_, i) => {
    const s = new Scheduler();
    const owner = `instance-${i}`;
    s.setClaim(async (jobId) => {
      if (leaseDecision(leases.get(jobId) ?? null, { owner, nowMs: now }) === 'skip') return false;
      leases.set(jobId, nextLease({ owner, nowMs: now, ttlMs: DEFAULT_LEASE_TTL_MS }));
      return true;
    });
    if (opts.withRunLog) s.setRunLog(runLog);
    // Staggered boots: instance i started i*45 seconds after the first.
    s.register({ id: 'site-uptime', exclusive: true, schedule: { kind: 'everyMs', ms: 15 * MIN }, handler: () => { runs++; } }, i * 45_000);
    return s;
  });
  return {
    async runFor(ms: number) {
      for (now = 0; now <= ms; now += MIN) for (const s of schedulers) await s.tick(now);
      return runs;
    },
  };
}

describe('an exclusive 15-minute job across 20 instances, for 3 hours', () => {
  it('🔒 runs once per cycle when the durable record is wired', async () => {
    const runs = await cluster(20, { withRunLog: true }).runFor(180 * MIN);
    // 180 minutes / 15 = 12 cycles; the first one may land at either edge.
    expect(runs).toBeGreaterThanOrEqual(11);
    expect(runs).toBeLessThanOrEqual(13);
  });

  it('(the failure it fixes) without the record, the lease alone lets it run more than once a cycle', async () => {
    const runs = await cluster(20, { withRunLog: false }).runFor(180 * MIN);
    expect(runs).toBeGreaterThan(13);
  });

  it('an unreadable record falls back to the claim — the job still runs', async () => {
    const s = new Scheduler();
    let ran = 0;
    s.setRunLog({ lastRun: async () => { throw new Error('down'); }, record: async () => {} });
    s.register({ id: 'j', exclusive: true, schedule: { kind: 'everyMs', ms: MIN }, handler: () => { ran++; } }, 0);
    await s.tick(MIN);
    expect(ran).toBe(1);
  });

  it('a job that is not exclusive never reads the record', async () => {
    const s = new Scheduler();
    let reads = 0;
    s.setRunLog({ lastRun: async () => { reads++; return 0; }, record: async () => {} });
    s.register({ id: 'warm', schedule: { kind: 'everyMs', ms: MIN }, handler: () => {} }, 0);
    await s.tick(MIN);
    expect(reads).toBe(0);
  });
});
