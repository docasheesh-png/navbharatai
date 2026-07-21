import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateAvailabilityIntegration, AVAILABILITY_SERVICE_SOURCE } from './AvailabilityGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateAvailabilityIntegration (wiring)', () => {
  it('emits the availability service, routes and README', () => {
    const out = generateAvailabilityIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/availability/availabilityService.ts');
    expect(paths).toContain('server/availability/routes.ts');
    expect(paths).toContain('server/availability/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/availability/routes.ts']).toContain('export const availabilityRouter');
    expect(out.files['server/availability/routes.ts']).toContain('/open');
  });
});

// Materialize + execute the emitted domain logic — the overnight-span + exception rules are real business
// rules, verified against the actual emitted code.
describe('emitted AvailabilityService — weekly windows + overnight spans + exceptions (real logic)', () => {
  const artifact = join(here, `._availability_emitted_${process.pid}.ts`);
  writeFileSync(artifact, AVAILABILITY_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Window { open: string; close: string }
  type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
  interface Service {
    setWeekly(weekday: Weekday, windows: Window[]): void;
    setException(dateISO: string, windows: Window[]): void;
    isOpenAt(at: Date): boolean;
    nextOpenFrom(from: Date, horizonDays?: number): Date | null;
    weeklySchedule(): Array<{ weekday: Weekday; windows: Window[] }>;
  }
  interface Emitted { AvailabilityService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  // 2026-07-20 is a Monday (getUTCDay()===1). We use fixed UTC dates so tests are deterministic.
  it('resolves a simple same-day window (open only inside it)', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    svc.setWeekly(1, [{ open: '09:00', close: '17:00' }]); // Monday 9-5
    expect(svc.isOpenAt(new Date('2026-07-20T08:59:00Z'))).toBe(false); // before
    expect(svc.isOpenAt(new Date('2026-07-20T09:00:00Z'))).toBe(true);  // at open
    expect(svc.isOpenAt(new Date('2026-07-20T16:59:00Z'))).toBe(true);  // inside
    expect(svc.isOpenAt(new Date('2026-07-20T17:00:00Z'))).toBe(false); // at close (exclusive)
    expect(svc.isOpenAt(new Date('2026-07-21T10:00:00Z'))).toBe(false); // Tuesday, no hours set
  });

  it('THE INVARIANT: an OVERNIGHT window that crosses midnight is open late today AND early the next day', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    // Friday 22:00 -> 02:00 (Saturday). 2026-07-24 is a Friday, 2026-07-25 Saturday.
    svc.setWeekly(5, [{ open: '22:00', close: '02:00' }]);
    expect(svc.isOpenAt(new Date('2026-07-24T21:59:00Z'))).toBe(false); // before open
    expect(svc.isOpenAt(new Date('2026-07-24T22:00:00Z'))).toBe(true);  // open Friday night
    expect(svc.isOpenAt(new Date('2026-07-24T23:30:00Z'))).toBe(true);  // late Friday
    expect(svc.isOpenAt(new Date('2026-07-25T01:59:00Z'))).toBe(true);  // early Saturday — spillover
    expect(svc.isOpenAt(new Date('2026-07-25T02:00:00Z'))).toBe(false); // closes at 02:00
    expect(svc.isOpenAt(new Date('2026-07-25T12:00:00Z'))).toBe(false); // Saturday daytime, no Sat hours
  });

  it('supports multiple windows in a day (lunch break)', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    svc.setWeekly(1, [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '17:00' }]); // closed 12-1
    expect(svc.isOpenAt(new Date('2026-07-20T11:00:00Z'))).toBe(true);
    expect(svc.isOpenAt(new Date('2026-07-20T12:30:00Z'))).toBe(false); // lunch
    expect(svc.isOpenAt(new Date('2026-07-20T14:00:00Z'))).toBe(true);
  });

  it('a date EXCEPTION overrides the weekly schedule (holiday closed / special hours)', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    svc.setWeekly(1, [{ open: '09:00', close: '17:00' }]); // Mondays open
    svc.setException('2026-07-20', []);                    // this Monday: CLOSED (holiday)
    expect(svc.isOpenAt(new Date('2026-07-20T10:00:00Z'))).toBe(false);
    // next Monday still uses the weekly schedule
    expect(svc.isOpenAt(new Date('2026-07-27T10:00:00Z'))).toBe(true);
    // special hours on a normally-closed day
    svc.setException('2026-07-21', [{ open: '10:00', close: '14:00' }]); // Tuesday special
    expect(svc.isOpenAt(new Date('2026-07-21T11:00:00Z'))).toBe(true);
    expect(svc.isOpenAt(new Date('2026-07-21T15:00:00Z'))).toBe(false);
  });

  it('nextOpenFrom finds the next opening (and returns now if already open)', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    svc.setWeekly(1, [{ open: '09:00', close: '17:00' }]); // only Mondays
    // From Monday 08:00 → opens same day 09:00
    const n1 = svc.nextOpenFrom(new Date('2026-07-20T08:00:00Z'));
    expect(n1?.toISOString()).toBe('2026-07-20T09:00:00.000Z');
    // Already open → returns the from instant
    const already = new Date('2026-07-20T10:00:00Z');
    expect(svc.nextOpenFrom(already)?.toISOString()).toBe(already.toISOString());
    // From Tuesday → next open is the following Monday 09:00
    const n2 = svc.nextOpenFrom(new Date('2026-07-21T10:00:00Z'));
    expect(n2?.toISOString()).toBe('2026-07-27T09:00:00.000Z');
  });

  it('validates times and inputs', async () => {
    const { AvailabilityService } = await load();
    const svc = new AvailabilityService();
    expect(() => svc.setWeekly(1, [{ open: '25:00', close: '10:00' }])).toThrow(/out of range/);
    expect(() => svc.setWeekly(1, [{ open: '9:00', close: '10:00' }])).toThrow(/HH:MM/);
    expect(() => svc.setWeekly(1, [{ open: '10:00', close: '10:00' }])).toThrow(/zero-length/);
    expect(() => svc.setWeekly(9 as Weekday, [])).toThrow(/weekday must be 0..6/);
    expect(() => svc.setException('2026/07/20', [])).toThrow(/YYYY-MM-DD/);
  });
});
