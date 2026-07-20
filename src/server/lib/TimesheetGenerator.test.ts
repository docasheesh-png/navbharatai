import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateTimesheetIntegration, TIMESHEET_SERVICE_SOURCE } from './TimesheetGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateTimesheetIntegration (wiring)', () => {
  it('emits the timesheet service, routes and README', () => {
    const out = generateTimesheetIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/timesheet/timesheetService.ts');
    expect(paths).toContain('server/timesheet/routes.ts');
    expect(paths).toContain('server/timesheet/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/timesheet/routes.ts']).toContain('export const timesheetRouter');
    expect(out.files['server/timesheet/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the single-open-session + duration rules are real business
// rules, verified against the actual emitted code.
describe('emitted Timesheet — single open session + exact duration (real logic)', () => {
  const artifact = join(here, `._timesheet_emitted_${process.pid}.ts`);
  writeFileSync(artifact, TIMESHEET_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface TimeEntry { id: string; user: string; project: string; startedAt: string; endedAt: string | null; durationMs: number }
  interface Service {
    openEntry(user: string): TimeEntry | undefined;
    clockIn(user: string, input?: { project?: string; note?: string }, now?: Date): TimeEntry;
    clockOut(user: string, now?: Date): TimeEntry;
    get(id: string): TimeEntry | undefined;
    addManual(user: string, input: { project?: string; note?: string; startedAt: string; endedAt: string }): TimeEntry;
    remove(id: string): boolean;
    list(user: string, filter?: { project?: string }): TimeEntry[];
    totalMs(user: string, filter?: { project?: string }): number;
  }
  interface Emitted { Timesheet: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  const T = (iso: string) => new Date(iso);

  it('clockIn/clockOut computes an exact duration and closes the entry', async () => {
    const { Timesheet } = await load();
    const svc = new Timesheet();
    const e = svc.clockIn('u1', { project: 'p1' }, T('2026-01-01T09:00:00.000Z'));
    expect(e.endedAt).toBeNull();
    expect(svc.openEntry('u1')?.id).toBe(e.id);
    const done = svc.clockOut('u1', T('2026-01-01T10:30:00.000Z'));
    expect(done.endedAt).toBe('2026-01-01T10:30:00.000Z');
    expect(done.durationMs).toBe(90 * 60 * 1000); // 90 minutes
    expect(svc.openEntry('u1')).toBeUndefined(); // no longer running
  });

  it('enforces AT MOST ONE open entry per user', async () => {
    const { Timesheet } = await load();
    const svc = new Timesheet();
    svc.clockIn('u1', {}, T('2026-01-01T09:00:00.000Z'));
    // a second clock-in while running is rejected
    expect(() => svc.clockIn('u1', {}, T('2026-01-01T09:05:00.000Z'))).toThrow(/already has a running/);
    // a different user can clock in independently
    expect(svc.clockIn('u2', {}, T('2026-01-01T09:05:00.000Z')).user).toBe('u2');
    // after clocking out, the user can clock in again
    svc.clockOut('u1', T('2026-01-01T10:00:00.000Z'));
    expect(svc.clockIn('u1', {}, T('2026-01-01T11:00:00.000Z')).endedAt).toBeNull();
  });

  it('clockOut with nothing running is rejected', async () => {
    const { Timesheet } = await load();
    const svc = new Timesheet();
    expect(() => svc.clockOut('u1')).toThrow(/no running time entry/);
    expect(() => svc.clockIn('', {})).toThrow(/user is required/);
  });

  it('totalMs sums CLOSED entries only, scoped by project', async () => {
    const { Timesheet } = await load();
    const svc = new Timesheet();
    svc.addManual('u1', { project: 'p1', startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T10:00:00.000Z' }); // 60m p1
    svc.addManual('u1', { project: 'p2', startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:30:00.000Z' }); // 30m p2
    svc.clockIn('u1', { project: 'p1' }, T('2026-01-01T12:00:00.000Z')); // OPEN — excluded from totals
    expect(svc.totalMs('u1')).toBe(90 * 60 * 1000); // 60 + 30, the open entry excluded
    expect(svc.totalMs('u1', { project: 'p1' })).toBe(60 * 60 * 1000);
    expect(svc.list('u1').length).toBe(3);
    expect(svc.list('u1', { project: 'p2' }).length).toBe(1);
  });

  it('addManual validates the date range; remove works', async () => {
    const { Timesheet } = await load();
    const svc = new Timesheet();
    expect(() => svc.addManual('u1', { startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T09:00:00.000Z' })).toThrow(/before startedAt/);
    expect(() => svc.addManual('u1', { startedAt: 'bogus', endedAt: 'bogus' })).toThrow(/valid dates/);
    const e = svc.addManual('u1', { startedAt: '2026-01-01T09:00:00.000Z', endedAt: '2026-01-01T09:30:00.000Z' });
    expect(svc.remove(e.id)).toBe(true);
    expect(svc.remove(e.id)).toBe(false);
  });
});
