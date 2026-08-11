import { describe, it, expect, afterAll } from 'vitest';

import { generateSubscriptionIntegration, SUBSCRIPTION_SERVICE_SOURCE } from './SubscriptionGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateSubscriptionIntegration (wiring)', () => {
  it('emits the subscription service, routes and README', () => {
    const out = generateSubscriptionIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/subscriptions/subscriptionService.ts');
    expect(paths).toContain('server/subscriptions/routes.ts');
    expect(paths).toContain('server/subscriptions/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/subscriptions/routes.ts']).toContain('export const subscriptionRouter');
    expect(out.files['server/subscriptions/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the lifecycle state-machine + renewal math are real
// business rules, verified against the actual emitted code.
describe('emitted SubscriptionService — lifecycle + renewal (real logic)', () => {
  const emitted = emitModule('subscription', SUBSCRIPTION_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Status = 'active' | 'paused' | 'past_due' | 'cancelled';
  interface Plan { id: string }
  interface Sub { id: string; status: Status; renewalAt: string; planId: string }
  interface Service {
    definePlan(i: { id: string; name: string; priceCents: number; intervalDays: number }): Plan;
    subscribe(customer: string, planId: string, now?: Date): Sub;
    setStatus(id: string, to: Status, now?: Date): Sub;
    renew(id: string, now?: Date): Sub;
    isDue(id: string, now?: Date): boolean;
    isActive(id: string): boolean;
    list(f?: { status?: Status; customer?: string; planId?: string }): Sub[];
  }
  interface Emitted { SubscriptionService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  const T0 = new Date('2026-01-01T00:00:00.000Z');

  it('subscribe starts active with renewalAt = now + interval', async () => {
    const { SubscriptionService } = await load();
    const svc = new SubscriptionService();
    svc.definePlan({ id: 'pro', name: 'Pro', priceCents: 49900, intervalDays: 30 });
    const s = svc.subscribe('asha@x.com', 'pro', T0);
    expect(s.status).toBe('active');
    expect(s.renewalAt).toBe('2026-01-31T00:00:00.000Z'); // +30 days
    expect(svc.isActive(s.id)).toBe(true);
  });

  it('enforces the lifecycle state-machine (active↔paused, cancel, reactivate; invalid rejected)', async () => {
    const { SubscriptionService } = await load();
    const svc = new SubscriptionService();
    svc.definePlan({ id: 'p', name: 'P', priceCents: 100, intervalDays: 30 });
    const s = svc.subscribe('a', 'p', T0);
    expect(svc.setStatus(s.id, 'paused').status).toBe('paused');
    expect(svc.setStatus(s.id, 'active').status).toBe('active');
    // paused can't go straight to past_due
    svc.setStatus(s.id, 'paused');
    expect(() => svc.setStatus(s.id, 'past_due')).toThrow(/invalid status transition/);
    // cancel, then reactivate is allowed
    svc.setStatus(s.id, 'cancelled');
    expect(svc.setStatus(s.id, 'active').status).toBe('active');
  });

  it('renew advances renewalAt by the interval and reactivates; due detection works', async () => {
    const { SubscriptionService } = await load();
    const svc = new SubscriptionService();
    svc.definePlan({ id: 'p', name: 'P', priceCents: 100, intervalDays: 30 });
    const s = svc.subscribe('a', 'p', T0); // renewal 2026-01-31
    // At renewal time it is due.
    expect(svc.isDue(s.id, new Date('2026-01-31T00:00:00.000Z'))).toBe(true);
    expect(svc.isDue(s.id, new Date('2026-01-15T00:00:00.000Z'))).toBe(false);
    // Renew at the due date → next renewal +30 days, active.
    svc.setStatus(s.id, 'past_due');
    const r = svc.renew(s.id, new Date('2026-01-31T00:00:00.000Z'));
    expect(r.status).toBe('active');
    expect(r.renewalAt).toBe('2026-03-02T00:00:00.000Z'); // 2026-01-31 + 30 days
    // a cancelled subscription cannot renew / is never due
    svc.setStatus(s.id, 'cancelled');
    expect(() => svc.renew(s.id)).toThrow(/cannot renew a cancelled/);
    expect(svc.isDue(s.id, new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('validates input and unknown plan / subscription', async () => {
    const { SubscriptionService } = await load();
    const svc = new SubscriptionService();
    expect(() => svc.definePlan({ id: '', name: 'x', priceCents: 1, intervalDays: 30 })).toThrow(/plan id is required/);
    expect(() => svc.definePlan({ id: 'p', name: 'P', priceCents: 1, intervalDays: 0 })).toThrow(/intervalDays must be a positive number/);
    svc.definePlan({ id: 'p', name: 'P', priceCents: 1, intervalDays: 30 });
    expect(() => svc.subscribe('a', 'nope')).toThrow(/unknown plan/);
    expect(() => svc.subscribe('', 'p')).toThrow(/customer is required/);
    expect(() => svc.setStatus('nope', 'paused')).toThrow(/subscription not found/);
  });
});
