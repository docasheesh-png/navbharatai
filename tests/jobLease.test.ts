import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  leaseDecision, nextLease, claimJobRun, processOwnerId,
  DEFAULT_LEASE_TTL_MS, JOB_LEASE_COLLECTION, type JobLease,
} from '../src/server/lib/jobLease';
import { Scheduler } from '../src/server/lib/ScheduledJobs';

/**
 * ONE INSTANCE RUNS THE JOB (ROADMAP §12 #1).
 *
 * ⚠️ HONEST SCOPE, because the first telling of this overstated it. `ScheduledJobs` genuinely has no
 * leader election — every instance runs every registered job. But of the two jobs registered today,
 * `monitor-alerts` ALREADY protects itself with a Firestore transaction ("so several instances
 * sweeping at the same moment send ONE notification between them"), and `retention-purge` is switched
 * off. So there is no live duplicate-work bug right now.
 *
 * What makes this worth building is the NEXT job: the engine offers no protection by default, and the
 * very job the roadmap recommends switching on is the one that DELETES.
 */
describe('leaseDecision', () => {
  const now = 1_000_000;

  it('an unheld job is claimable', () => {
    expect(leaseDecision(null, { owner: 'a', nowMs: now })).toBe('claim');
    expect(leaseDecision(undefined, { owner: 'a', nowMs: now })).toBe('claim');
    expect(leaseDecision({ owner: '', expiresAt: now + 1000 }, { owner: 'a', nowMs: now })).toBe('claim');
  });

  it('a live lease held by SOMEONE ELSE is skipped — that is the whole point', () => {
    expect(leaseDecision({ owner: 'b', expiresAt: now + 60_000 }, { owner: 'a', nowMs: now })).toBe('skip');
  });

  it('🔒 an EXPIRED lease is claimable — one crashed instance must not cancel a job forever', () => {
    expect(leaseDecision({ owner: 'b', expiresAt: now - 1 }, { owner: 'a', nowMs: now })).toBe('claim');
    expect(leaseDecision({ owner: 'b', expiresAt: now }, { owner: 'a', nowMs: now })).toBe('claim');
  });

  it('🔒 a lease this instance ALREADY holds is claimable — a slow job must not lock itself out', () => {
    // Otherwise a job that overruns its lease never runs again, which is worse than duplication.
    expect(leaseDecision({ owner: 'a', expiresAt: now + 60_000 }, { owner: 'a', nowMs: now })).toBe('claim');
  });

  it('🔒 a corrupt expiry is treated as EXPIRED, never as held forever', () => {
    // The worst case of this choice is one duplicated run; the worst case of the other is a job that
    // can never run again.
    for (const bad of [NaN, undefined as unknown as number, 'soon' as unknown as number]) {
      expect(leaseDecision({ owner: 'b', expiresAt: bad } as JobLease, { owner: 'a', nowMs: now })).toBe('claim');
    }
  });

  it('the lease written carries the owner and a bounded expiry', () => {
    expect(nextLease({ owner: 'a', nowMs: now, ttlMs: 5000 })).toEqual({ owner: 'a', expiresAt: now + 5000 });
    expect(nextLease({ owner: 'a', nowMs: now, ttlMs: 0 }).expiresAt).toBe(now + DEFAULT_LEASE_TTL_MS);
    // Long enough to outlast a real job, short enough that a crash costs one cycle, not a day.
    expect(DEFAULT_LEASE_TTL_MS).toBeGreaterThanOrEqual(60_000);
    expect(DEFAULT_LEASE_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it('each process is its own claimant, stably within a run', () => {
    expect(processOwnerId()).toBe(processOwnerId());
    expect(processOwnerId()).toContain(String(process.pid));
  });
});

/** A minimal transactional store: one shared record, and real read-then-write inside a transaction. */
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

describe('claimJobRun', () => {
  it('🔒 the SECOND instance loses — two instances deciding at once must not both win', async () => {
    const store = fakeStore();
    const first = await claimJobRun(store as any, { jobId: 'purge', owner: 'inst-a', nowMs: 1000 });
    const second = await claimJobRun(store as any, { jobId: 'purge', owner: 'inst-b', nowMs: 1000 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(store.docs[`${JOB_LEASE_COLLECTION}/purge`].owner).toBe('inst-a');
  });

  it('a different job is never blocked by another job\'s lease', async () => {
    const store = fakeStore();
    expect(await claimJobRun(store as any, { jobId: 'a', owner: 'x', nowMs: 1 })).toBe(true);
    expect(await claimJobRun(store as any, { jobId: 'b', owner: 'y', nowMs: 1 })).toBe(true);
  });

  it('once the lease expires, the next instance takes over', async () => {
    const store = fakeStore();
    await claimJobRun(store as any, { jobId: 'p', owner: 'a', nowMs: 0, ttlMs: 1000 });
    expect(await claimJobRun(store as any, { jobId: 'p', owner: 'b', nowMs: 500 })).toBe(false);
    expect(await claimJobRun(store as any, { jobId: 'p', owner: 'b', nowMs: 1001 })).toBe(true);
  });

  it('🔒 AN UNREACHABLE STORE RUNS THE JOB — a hiccup must not cancel every scheduled job', async () => {
    // Failing closed would mean one database blip silently stops every job on the platform. Running a
    // purge twice is waste; a purge that never runs is a bill that never stops.
    expect(await claimJobRun(null, { jobId: 'p' })).toBe(true);
    const throwing = { collection: () => ({ doc: () => 'r' }), runTransaction: async () => { throw new Error('down'); } };
    expect(await claimJobRun(throwing as any, { jobId: 'p' })).toBe(true);
  });
});

describe('Scheduler — exclusive jobs, and everything else unchanged', () => {
  const job = (id: string, ran: string[], exclusive?: boolean) => ({
    id, exclusive, schedule: { kind: 'everyMs' as const, ms: 1000 }, handler: () => { ran.push(id); },
  });

  it('🔒 with NO claim wired, every job runs — exactly today\'s behaviour', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.register(job('a', ran, true), 0);
    await s.tick(5000);
    expect(ran).toEqual(['a']);
  });

  it('a losing instance does not run an exclusive job', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setClaim(async () => false);
    s.register(job('a', ran, true), 0);
    await s.tick(5000);
    expect(ran).toEqual([]);
    expect(s.list()[0].skipped).toBe(1);
    expect(s.list()[0].runs).toBe(0);
  });

  it('🔒 a NON-exclusive job is never claimed — per-instance work stays per-instance', async () => {
    const ran: string[] = [];
    let claims = 0;
    const s = new Scheduler();
    s.setClaim(async () => { claims++; return false; });
    s.register(job('local', ran), 0);
    await s.tick(5000);
    expect(ran).toEqual(['local']);
    expect(claims).toBe(0);
  });

  it('🔒 A LOSER STILL RESCHEDULES — otherwise it retries every tick and hammers the lease', async () => {
    // A deduplication mechanism that becomes its own load is not a fix.
    const s = new Scheduler();
    s.setClaim(async () => false);
    s.register(job('a', [], true), 0);
    await s.tick(5000);
    expect(s.list()[0].nextRun).toBeGreaterThan(5000);
  });

  it('a claim that throws lets the job run, and never breaks the tick', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setClaim(async () => { throw new Error('firestore down'); });
    s.register(job('a', ran, true), 0);
    await s.tick(5000);
    expect(ran).toEqual(['a']);
  });

  it('runNow honours the claim, so an off-schedule run is deduplicated too', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setClaim(async () => false);
    s.register(job('a', ran, true), 0);
    expect(await s.runNow('a')).toBe(false);
    expect(ran).toEqual([]);
    expect(s.list()[0].skipped).toBe(1);
  });

  it('runNow runs the winner, and reports that it ran', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setClaim(async () => true);
    s.register(job('a', ran, true), 0);
    expect(await s.runNow('a')).toBe(true);
    expect(ran).toEqual(['a']);
    expect(s.list()[0].runs).toBe(1);
  });

  it('🔒 runNow on an unknown or disabled job is FALSE — a typo never looks like a completed run', async () => {
    const s = new Scheduler();
    expect(await s.runNow('nope')).toBe(false);
    s.register({ ...job('off', []), enabled: false }, 0);
    expect(await s.runNow('off')).toBe(false);
  });

  it('runNow does NOT reschedule — an off-schedule run must not move the next due time', async () => {
    const s = new Scheduler();
    s.register(job('a', [], true), 0);
    const before = s.list()[0].nextRun;
    await s.runNow('a', 500);
    expect(s.list()[0].nextRun).toBe(before);
  });

  it('one job losing its claim never stops the others', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setClaim(async (id) => id !== 'blocked');
    s.register(job('blocked', ran, true), 0);
    s.register(job('free', ran, true), 0);
    await s.tick(5000);
    expect(ran).toEqual(['free']);
  });
});

describe('🔒 the wiring — the job that DELETES is the one made exclusive', () => {
  const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');

  it('retention-purge is exclusive', () => {
    expect(server).toContain("id: 'retention-purge', exclusive: true");
  });

  it('the claim is wired from the real lease store', () => {
    expect(server).toContain('scheduler.setClaim((jobId) => claimJobRun(getServerDb() as any, { jobId }))');
  });

  it('🔒 THE BOOT RUN GOES THROUGH THE SCHEDULER — not straight to the handler', () => {
    // It used to be a bare `runPurge()`, which walked past the scheduler entirely: `exclusive`
    // protected the 03:00 run and did nothing for the boot run, so every instance purged on startup.
    expect(server).toContain("void scheduler.runNow('retention-purge')");
    expect(server).not.toMatch(/^\s*runPurge\(\); \/\/ once at boot/m);
  });

  it('🔒 the boot run WAITS for the claim to be wired, and happens even if wiring fails', () => {
    // Fired before setClaim lands, it would find no claim and run on every instance regardless — the
    // bug by another route. And a claim that cannot be wired must DELAY the purge, never cancel it.
    const at = server.indexOf("import('./src/server/lib/jobLease')");
    expect(server.slice(at, at + 1200)).toContain('.finally(() => { bootRun?.(); })');
  });

  it('🔒 a failure to wire the claim leaves every job running, rather than none', () => {
    const at = server.indexOf("import('./src/server/lib/jobLease')");
    expect(at).toBeGreaterThan(-1);
    expect(server.slice(at, at + 700)).toMatch(/catch\(\(\) => \{ \/\* no claim wired/);
  });
});
