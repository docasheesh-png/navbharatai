/**
 * Q-159: the plan sweep (renewal reminders), the daily hosting bill and the cleanups ran only while a Cloud Run
 * instance happened to be awake — `--min-instances 0` — so with no traffic a reminder could be hours late. The
 * admin chose Cloud Scheduler (2026-10-05). It calls a secret-checked tick; the tick runs every exclusive job
 * that is due by the DURABLE record of its last run, which every instance writes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { Scheduler, type RunLog } from '../src/server/lib/ScheduledJobs';
import { tickAuth, firestoreRunLog, JOB_RUNS_COLLECTION, type RunLogStore } from '../src/server/lib/schedulerTick';

const H = 60 * 60_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 5, 0, 0, 0);

function memLog(seed: Record<string, number> = {}): RunLog & { data: Record<string, number> } {
  const data = { ...seed };
  return { data, async lastRun(id) { return id in data ? data[id] : null; }, async record(id, at) { data[id] = at; } };
}

describe('the tick is secret-checked', () => {
  it('unset or short ⇒ not configured; wrong ⇒ denied; right ⇒ ok', () => {
    expect(tickAuth(undefined, 'x')).toBe('not-configured');
    expect(tickAuth('short', 'short')).toBe('not-configured');
    expect(tickAuth('a-long-enough-secret', 'a-long-enough-secrex')).toBe('denied');
    expect(tickAuth('a-long-enough-secret', undefined)).toBe('denied');
    expect(tickAuth('a-long-enough-secret', 'a-long-enough-secret')).toBe('ok');
  });
});

describe('catch-up decides from the durable record, not from an instance that just woke', () => {
  const daily = (id: string, ran: string[]) => ({ id, exclusive: true, schedule: { kind: 'dailyAtUtc' as const, hour: 4, minute: 0 }, handler: () => { ran.push(id); } });

  it('a daily job that no instance ran at 04:00 runs on the next tick — even on an instance that woke at 04:05', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setRunLog(memLog({ bill: T0 - DAY + 4 * H }));   // yesterday 04:00
    s.register(daily('bill', ran), T0 + 4 * H + 5 * 60_000); // woke at 04:05 today: in memory, next run is TOMORROW
    expect(s.due(T0 + 4 * H + 5 * 60_000)).toEqual([]);      // the in-process loop would have skipped today
    const r = await s.catchUp(T0 + 4 * H + 5 * 60_000);
    expect(r.ran).toEqual(['bill']);
    expect(ran).toEqual(['bill']);
  });

  it('a job another instance already ran today is not run again', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setRunLog(memLog({ bill: T0 + 4 * H }));          // ran at 04:00 today
    s.register(daily('bill', ran), T0);
    const r = await s.catchUp(T0 + 4 * H + 10 * 60_000);
    expect(r.notDue).toEqual(['bill']);
    expect(ran).toEqual([]);
  });

  it('first sight seeds the clock and runs nothing — no bill at a random hour', async () => {
    const ran: string[] = [];
    const log = memLog();
    const s = new Scheduler();
    s.setRunLog(log);
    s.register(daily('bill', ran), T0);
    const r = await s.catchUp(T0 + 15 * H);
    expect(r.seeded).toEqual(['bill']);
    expect(ran).toEqual([]);
    expect(log.data.bill).toBe(T0 + 15 * H);
    expect((await s.catchUp(T0 + DAY + 4 * H + 60_000)).ran).toEqual(['bill']); // then on its schedule
  });

  it('an unreadable record leaves the job alone; no record wired ⇒ unknown', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.register(daily('bill', ran), T0);
    expect((await s.catchUp(T0 + DAY)).unknown).toEqual(['bill']);
    s.setRunLog({ lastRun: async () => { throw new Error('down'); }, record: async () => {} });
    expect((await s.catchUp(T0 + DAY)).unknown).toEqual(['bill']);
    expect(ran).toEqual([]);
  });

  it('the lease still decides: an instance that loses the claim reports it, and does not run', async () => {
    const ran: string[] = [];
    const s = new Scheduler();
    s.setRunLog(memLog({ bill: T0 - DAY }));
    s.setClaim(async () => false);
    s.register(daily('bill', ran), T0);
    expect((await s.catchUp(T0 + 5 * H)).heldElsewhere).toEqual(['bill']);
    expect(ran).toEqual([]);
  });

  it('per-instance jobs are left to the in-process loop', async () => {
    const s = new Scheduler();
    s.setRunLog(memLog());
    s.register({ id: 'fx', schedule: { kind: 'everyMs', ms: H }, handler: () => {} }, T0);
    const r = await s.catchUp(T0 + DAY);
    expect([...r.ran, ...r.notDue, ...r.seeded, ...r.unknown, ...r.heldElsewhere]).toEqual([]);
  });

  it('every in-process run of an exclusive job is recorded, so the tick knows about it', async () => {
    const log = memLog();
    const s = new Scheduler();
    s.setRunLog(log);
    s.register({ id: 'sweep', exclusive: true, schedule: { kind: 'everyMs', ms: H }, handler: () => {} }, T0);
    await s.tick(T0 + H);
    expect(log.data.sweep).toBe(T0 + H);
  });
});

describe('the durable record and the wiring', () => {
  it('reads and writes job_runs/{id}.lastRunAt', async () => {
    const docs: Record<string, Record<string, unknown>> = {};
    const store: RunLogStore = { collection: (name) => ({ doc: (id) => ({
      get: async () => ({ exists: `${name}/${id}` in docs, data: () => docs[`${name}/${id}`] }),
      set: async (v) => { docs[`${name}/${id}`] = { ...(docs[`${name}/${id}`] ?? {}), ...v }; },
    }) }) };
    const log = firestoreRunLog(store)!;
    expect(await log.lastRun('bill')).toBeNull();
    await log.record('bill', 123);
    expect(docs[`${JOB_RUNS_COLLECTION}/bill`]).toMatchObject({ lastRunAt: 123 });
    expect(await log.lastRun('bill')).toBe(123);
    expect(firestoreRunLog(null)).toBeNull();
  });

  it('every instance wires the record at boot, and the tick route is secret-checked', () => {
    const health = readFileSync('src/server/routes/health.ts', 'utf8');
    expect(health).toContain('scheduler.setRunLog(firestoreRunLog(');
    expect(health).toContain("app.post('/api/internal/scheduler-tick'");
    expect(health).toContain('tickAuth(process.env.SCHEDULER_TICK_SECRET, req.headers[SCHEDULER_TICK_HEADER])');
  });

  it('the plan sweep is a scheduler job, not a private timer', () => {
    const sweep = readFileSync('src/server/lib/hostingPlanSweep.ts', 'utf8');
    expect(sweep).toContain('scheduler.register({');
    expect(sweep).toContain('exclusive: true');
    expect(sweep).not.toMatch(/setInterval\(/);
  });
});
