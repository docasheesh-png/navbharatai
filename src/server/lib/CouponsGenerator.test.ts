import { describe, it, expect, afterAll } from 'vitest';

import { generateCouponsIntegration, COUPON_SERVICE_SOURCE } from './CouponsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateCouponsIntegration (wiring)', () => {
  it('emits the coupon service, routes and README', () => {
    const out = generateCouponsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/coupons/couponService.ts');
    expect(paths).toContain('server/coupons/routes.ts');
    expect(paths).toContain('server/coupons/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/coupons/routes.ts']).toContain('export const couponRouter');
    expect(out.files['server/coupons/routes.ts']).toContain('422');
  });
});

// Materialize + execute the emitted domain logic — the redemption caps + discount math are real business
// rules, verified against the actual emitted code.
describe('emitted CouponService — redemption caps + discount math (real logic)', () => {
  const emitted = emitModule('coupon', COUPON_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Coupon { code: string; type: string; value: number }
  interface Redemption { code: string; user: string; discount: number }
  interface Check { ok: boolean; discount?: number; reason?: string }
  interface Service {
    create(i: Record<string, unknown>, now?: Date): Coupon;
    get(code: string): Coupon | undefined;
    validate(code: string, user: string, orderAmount: number, now?: Date): Check;
    redeem(code: string, user: string, orderAmount: number, now?: Date): Redemption;
    stats(code: string): { code: string; total: number; remaining: number | null };
  }
  interface Emitted { CouponService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('computes percent (capped at order total) and fixed discounts correctly', async () => {
    const { CouponService } = await load();
    const svc = new CouponService();
    svc.create({ code: 'save10', type: 'percent', value: 10 });
    svc.create({ code: 'flat50', type: 'fixed', value: 50 });
    expect(svc.validate('SAVE10', 'u1', 1000).discount).toBe(100); // 10% of 1000
    // a fixed discount never exceeds the order total
    expect(svc.validate('flat50', 'u1', 30).discount).toBe(30);
    expect(svc.validate('flat50', 'u1', 200).discount).toBe(50);
    // code is case-insensitive
    expect(svc.get('SAVE10')?.code).toBe('SAVE10');
  });

  it('enforces the TOTAL redemption cap', async () => {
    const { CouponService } = await load();
    const svc = new CouponService();
    svc.create({ code: 'once', type: 'fixed', value: 10, maxRedemptions: 2 });
    svc.redeem('once', 'a', 100);
    svc.redeem('once', 'b', 100);
    expect(() => svc.redeem('once', 'c', 100)).toThrow(/redemption limit reached/);
    expect(svc.stats('once')).toEqual({ code: 'ONCE', total: 2, remaining: 0 });
  });

  it('enforces the PER-USER limit independently of the total cap', async () => {
    const { CouponService } = await load();
    const svc = new CouponService();
    svc.create({ code: 'peruser', type: 'fixed', value: 10, perUserLimit: 1 });
    svc.redeem('peruser', 'a', 100);
    expect(() => svc.redeem('peruser', 'a', 100)).toThrow(/per-user redemption limit/);
    // a different user can still redeem
    expect(svc.redeem('peruser', 'b', 100).user).toBe('b');
  });

  it('rejects inactive / expired coupons and orders below the minimum', async () => {
    const { CouponService } = await load();
    const svc = new CouponService();
    const T0 = new Date('2026-01-01T00:00:00.000Z');
    svc.create({ code: 'off', type: 'percent', value: 10, active: false });
    svc.create({ code: 'min100', type: 'fixed', value: 10, minOrder: 100 });
    svc.create({ code: 'exp', type: 'percent', value: 10, expiresAt: '2026-02-01T00:00:00.000Z' }, T0);
    expect(svc.validate('off', 'u1', 500)).toMatchObject({ ok: false, reason: 'coupon is not active' });
    expect(svc.validate('min100', 'u1', 50)).toMatchObject({ ok: false, reason: expect.stringMatching(/below the minimum/) });
    expect(svc.validate('min100', 'u1', 150).ok).toBe(true);
    // valid before expiry, rejected after
    expect(svc.validate('exp', 'u1', 100, new Date('2026-01-15T00:00:00.000Z')).ok).toBe(true);
    expect(svc.validate('exp', 'u1', 100, new Date('2026-03-01T00:00:00.000Z'))).toMatchObject({ ok: false, reason: 'coupon expired' });
    expect(() => svc.redeem('off', 'u1', 500)).toThrow(/not active/);
  });

  it('validates create input and unknown codes', async () => {
    const { CouponService } = await load();
    const svc = new CouponService();
    expect(() => svc.create({ code: '', type: 'percent', value: 10 })).toThrow(/code is required/);
    // @ts-expect-error bad type
    expect(() => svc.create({ code: 'x', type: 'bogus', value: 10 })).toThrow(/type must be/);
    expect(() => svc.create({ code: 'x', type: 'percent', value: 0 })).toThrow(/positive number/);
    expect(() => svc.create({ code: 'x', type: 'percent', value: 150 })).toThrow(/cannot exceed 100/);
    expect(svc.validate('nope', 'u1', 100)).toMatchObject({ ok: false, reason: 'unknown coupon' });
  });
});
