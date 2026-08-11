import { describe, it, expect, afterAll } from 'vitest';

import { join } from 'node:path';
import { generateFitnessIntegration, FITNESS_SERVICE_SOURCE } from './FitnessGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateFitnessIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateFitnessIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/fitness/fitnessService.ts');
    expect(paths).toContain('server/fitness/routes.ts');
    expect(paths).toContain('server/fitness/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/fitness/routes.ts']).toContain('409');
    expect(out.files['server/fitness/routes.ts']).toContain('export const fitnessRouter');
  });
});

describe('emitted FitnessService — deterministic membership date-math + validity gate', () => {
  const emitted = emitModule('fitness', FITNESS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2024, 0, 15); // MIDNIGHT UTC — so same-day check-ins never cross the UTC date boundary

  interface Plan { id: string }
  interface Member { id: string; endAt: number; frozenAt: number | null }
  interface Service {
    addPlan(d: { name: string; days: number; price: number }): Plan;
    join(d: { name: string; phone: string; planId: string }, now?: number): Member;
    isActive(m: Member, at?: number): boolean;
    statusOf(m: Member, at?: number): string;
    renew(id: string, now?: number): Member;
    freeze(id: string, now?: number): Member;
    unfreeze(id: string, now?: number): Member;
    checkIn(id: string, now?: number): { id: string; day: string };
    checkInsFor(id: string): unknown[];
    get(id: string): Member | undefined;
  }
  interface Emitted { FitnessService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }
  async function seed() {
    const { FitnessService } = await load();
    const svc = new FitnessService();
    const plan = svc.addPlan({ name: 'Monthly', days: 30, price: 1000 });
    const m = svc.join({ name: 'Aarav', phone: '9999999999', planId: plan.id }, T0);
    return { svc, plan, m };
  }

  it('a fresh 30-day membership is active now, expired after 30 days', async () => {
    const { svc, m } = await seed();
    expect(svc.isActive(m, T0)).toBe(true);
    expect(svc.isActive(m, T0 + 29 * DAY)).toBe(true);
    expect(svc.isActive(m, T0 + 31 * DAY)).toBe(false);
    expect(svc.statusOf(m, T0 + 31 * DAY)).toBe('expired');
  });

  it('CHECK-IN requires an active membership — an expired one is rejected (409-class)', async () => {
    const { svc, m } = await seed();
    expect(svc.checkIn(m.id, T0).day).toBe(new Date(T0).toISOString().slice(0, 10));
    expect(() => svc.checkIn(m.id, T0 + 40 * DAY)).toThrow(/active membership/);
  });

  it('check-in is IDEMPOTENT per member per day', async () => {
    const { svc, m } = await seed();
    const a = svc.checkIn(m.id, T0 + 3600_000);      // 1am
    const b = svc.checkIn(m.id, T0 + 8 * 3600_000);  // 8am same day
    expect(a.id).toBe(b.id);
    expect(svc.checkInsFor(m.id).length).toBe(1);
  });

  it('RENEW extends from max(now, currentEnd) — an early renewal loses NO days', async () => {
    const { svc, m } = await seed();
    // renew on day 10 (still active) → end should be original end + 30 days, NOT now + 30
    svc.renew(m.id, T0 + 10 * DAY);
    expect(svc.get(m.id)!.endAt).toBe(T0 + 60 * DAY); // 30 (orig) + 30 (renew) from the original end
    // renew AFTER expiry → from now, not the stale end (no free retro days)
    const later = T0 + 100 * DAY;
    svc.renew(m.id, later);
    expect(svc.get(m.id)!.endAt).toBe(later + 30 * DAY);
  });

  it('FREEZE/UNFREEZE shifts the end date by exactly the frozen duration (no paid day lost)', async () => {
    const { svc, m } = await seed();
    const endBefore = svc.get(m.id)!.endAt;
    svc.freeze(m.id, T0 + 5 * DAY);
    expect(svc.statusOf(m, T0 + 6 * DAY)).toBe('frozen');
    expect(() => svc.checkIn(m.id, T0 + 6 * DAY)).toThrow(/active membership/); // frozen blocks check-in
    svc.unfreeze(m.id, T0 + 12 * DAY); // 7 days frozen
    expect(svc.get(m.id)!.endAt).toBe(endBefore + 7 * DAY);
    expect(svc.get(m.id)!.frozenAt).toBeNull();
  });

  it('double-freeze is rejected and unfreeze without a freeze is rejected', async () => {
    const { svc, m } = await seed();
    svc.freeze(m.id, T0);
    expect(() => svc.freeze(m.id, T0)).toThrow(/already frozen/);
    svc.unfreeze(m.id, T0 + DAY);
    expect(() => svc.unfreeze(m.id, T0 + 2 * DAY)).toThrow(/not frozen/);
  });
});
