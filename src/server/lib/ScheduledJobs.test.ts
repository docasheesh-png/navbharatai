import { describe, it, expect, beforeEach } from 'vitest';
import { computeNextRun, Scheduler, type Schedule } from './ScheduledJobs';

const T10 = Date.UTC(2026, 0, 1, 10, 0, 0); // 2026-01-01 10:00:00 UTC
const DAY = 24 * 60 * 60 * 1000;

describe('computeNextRun (pure schedule math)', () => {
  it('everyMs adds the interval', () => {
    expect(computeNextRun({ kind: 'everyMs', ms: 5000 }, T10)).toBe(T10 + 5000);
  });
  it('everyMs floors a sub-1ms interval to at least 1ms', () => {
    expect(computeNextRun({ kind: 'everyMs', ms: 0 }, T10)).toBe(T10 + 1);
  });
  it('dailyAtUtc later today → today at that time', () => {
    expect(computeNextRun({ kind: 'dailyAtUtc', hour: 14, minute: 0 }, T10)).toBe(Date.UTC(2026, 0, 1, 14, 0, 0));
  });
  it('dailyAtUtc earlier today → tomorrow at that time', () => {
    expect(computeNextRun({ kind: 'dailyAtUtc', hour: 8, minute: 0 }, T10)).toBe(Date.UTC(2026, 0, 2, 8, 0, 0));
  });
  it('dailyAtUtc exactly now → tomorrow (strictly after)', () => {
    expect(computeNextRun({ kind: 'dailyAtUtc', hour: 10, minute: 0 }, T10)).toBe(T10 + DAY);
  });
});

describe('Scheduler', () => {
  let s: Scheduler;
  beforeEach(() => { s = new Scheduler(); });

  const daily: Schedule = { kind: 'dailyAtUtc', hour: 3, minute: 0 };

  it('register schedules the first run relative to now; not immediately due', () => {
    s.register({ id: 'a', schedule: { kind: 'everyMs', ms: 1000 }, handler: () => {} }, T10);
    expect(s.due(T10).length).toBe(0);           // nextRun is T10+1000, not due yet
    expect(s.due(T10 + 1000).map(j => j.id)).toEqual(['a']);
  });

  it('tick runs due jobs, increments runs, and reschedules', async () => {
    let ran = 0;
    s.register({ id: 'a', schedule: { kind: 'everyMs', ms: 1000 }, handler: () => { ran++; } }, T10);
    await s.tick(T10 + 1500);
    expect(ran).toBe(1);
    expect(s.list().find(j => j.id === 'a')!.runs).toBe(1);
    // rescheduled to T10+1500 + 1000 → not due again until then
    expect(s.due(T10 + 1500).length).toBe(0);
    expect(s.due(T10 + 2500).length).toBe(1);
  });

  it('a handler that throws is isolated — recorded, other jobs still run', async () => {
    let bRan = 0;
    s.register({ id: 'bad', schedule: { kind: 'everyMs', ms: 1 }, handler: () => { throw new Error('boom'); } }, T10);
    s.register({ id: 'good', schedule: { kind: 'everyMs', ms: 1 }, handler: () => { bRan++; } }, T10);
    await s.tick(T10 + 10);
    expect(bRan).toBe(1);
    expect(s.list().find(j => j.id === 'bad')!.lastError).toContain('boom');
  });

  it('disabled jobs never fire', async () => {
    let ran = 0;
    s.register({ id: 'a', schedule: { kind: 'everyMs', ms: 1 }, handler: () => { ran++; }, enabled: false }, T10);
    expect(s.due(T10 + 10)).toEqual([]);
    await s.tick(T10 + 10);
    expect(ran).toBe(0);
  });

  it('unregister removes a job', () => {
    s.register({ id: 'a', schedule: daily, handler: () => {} }, T10);
    s.unregister('a');
    expect(s.list()).toEqual([]);
  });

  it('await handlers before rescheduling (async handler)', async () => {
    const order: string[] = [];
    s.register({ id: 'a', schedule: { kind: 'everyMs', ms: 1 }, handler: async () => { order.push('start'); await Promise.resolve(); order.push('end'); } }, T10);
    await s.tick(T10 + 10);
    expect(order).toEqual(['start', 'end']);
  });
});
