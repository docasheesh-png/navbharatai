/**
 * THE BUILD DISCOUNT (admin 2026-09-25): *"agar admin discount = 0% (default) set kar to abhi jaise chal
 * raha hai, baise hi chale. agar admin discount = yy% fix kar de to, har build me likh kar aye … green
 * colour me likh kar aye, discount!!"* — set from a box in the admin panel.
 *
 * Three promises, each locked here:
 *   1. 0% (and anything unreadable) is today's bill, exactly.
 *   2. The discount comes out of our margin, never out of our cost — the bill never goes below what the
 *      build really cost us, and a bill already at cost gets nothing.
 *   3. The percentage the user is shown is the one they actually received.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeDiscountPct, applyBuildDiscount, buildDiscountLine, BuildDiscountStore,
  BUILD_DISCOUNT_MAX_PCT, BUILD_DISCOUNT_CACHE_MS,
} from '../src/server/lib/buildDiscount';
import { userCostBreakdown } from '../src/server/routes/agentv3';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the configured percentage', () => {
  it.each([
    [undefined, 0], [null, 0], ['', 0], ['  ', 0], ['abc', 0], [-5, 0], [0, 0], ['0%', 0],
    [20, 20], ['20', 20], ['20%', 20], [' 20 % ', 20], [12.4, 12], [12.6, 13],
    [90, BUILD_DISCOUNT_MAX_PCT], ['500%', BUILD_DISCOUNT_MAX_PCT], [Number.NaN, 0], [Infinity, 0],
  ])('%s → %s', (raw, want) => {
    expect(normalizeDiscountPct(raw)).toBe(want);
  });

  it('🔒 the ceiling is 50', () => {
    expect(BUILD_DISCOUNT_MAX_PCT).toBe(50);
  });
});

describe('applying it to a bill', () => {
  it('🔒 0% is today, exactly', () => {
    const d = applyBuildDiscount({ billedUsd: 1.8, floorUsd: 0.45, pct: 0 });
    expect(d.payUsd).toBe(1.8);
    expect(d.discountUsd).toBe(0);
    expect(d.pctApplied).toBe(0);
    expect(d.flooredAtCost).toBe(false);
  });

  it('20% off a bill with room in the margin', () => {
    const d = applyBuildDiscount({ billedUsd: 1.8, floorUsd: 0.45, pct: 20 });
    expect(d.listUsd).toBe(1.8);
    expect(d.payUsd).toBeCloseTo(1.44, 10);
    expect(d.discountUsd).toBeCloseTo(0.36, 10);
    expect(d.pctApplied).toBe(20);
    expect(d.flooredAtCost).toBe(false);
  });

  it('🔴 never below our real cost — the floor stops it short, and the SHOWN % is the applied one', () => {
    // A ₹100 bill that cost us ₹90: 20% would charge ₹80, a ₹10 loss. It stops at ₹90 = 10%.
    const d = applyBuildDiscount({ billedUsd: 1, floorUsd: 0.9, pct: 20 });
    expect(d.payUsd).toBeCloseTo(0.9, 10);
    expect(d.pctApplied).toBe(10);
    expect(d.pctConfigured).toBe(20);
    expect(d.flooredAtCost).toBe(true);
  });

  it('🔒 a bill already at cost (the preview waiver, a stopped build on its floor) gets nothing', () => {
    for (const floor of [1, 1.2]) {
      const d = applyBuildDiscount({ billedUsd: 1, floorUsd: floor, pct: 30 });
      expect(d.payUsd).toBe(1);
      expect(d.discountUsd).toBe(0);
      expect(d.pctApplied).toBe(0);
      expect(d.flooredAtCost).toBe(true);
    }
  });

  it('a free build stays free, and a nonsense input charges the bill unchanged', () => {
    expect(applyBuildDiscount({ billedUsd: 0, floorUsd: 0, pct: 30 }).payUsd).toBe(0);
    expect(applyBuildDiscount({ billedUsd: 2, floorUsd: Number.NaN, pct: 10 }).payUsd).toBeCloseTo(1.8, 10);
    expect(applyBuildDiscount({ billedUsd: Number.NaN, floorUsd: 0, pct: 10 }).payUsd).toBe(0);
  });

  it('the shown % is rounded DOWN, never overstating the saving', () => {
    // 1 → 0.874 is 12.6% off; the user is told 12%, not 13%.
    const d = applyBuildDiscount({ billedUsd: 1, floorUsd: 0.874, pct: 40 });
    expect(d.pctApplied).toBe(12);
  });

  it('🔒 over a grid of bills, costs and percentages: never above the bill, never below the cost', () => {
    for (const billed of [0.01, 0.2, 1, 3.7]) {
      for (const floorShare of [0, 0.1, 0.25, 0.6, 0.95, 1, 1.4]) {
        for (const pct of [0, 1, 10, 25, 50, 90]) {
          const floor = billed * floorShare;
          const d = applyBuildDiscount({ billedUsd: billed, floorUsd: floor, pct });
          expect(d.payUsd).toBeLessThanOrEqual(billed + 1e-12);
          expect(d.payUsd).toBeGreaterThanOrEqual(Math.min(billed, floor) - 1e-12);
          expect(d.listUsd - d.discountUsd).toBeCloseTo(d.payUsd, 10);
          expect(d.pctApplied).toBeLessThanOrEqual(Math.min(pct, BUILD_DISCOUNT_MAX_PCT));
        }
      }
    }
  });
});

describe('what the user sees', () => {
  const usage = { inputTokens: 1000, outputTokens: 200 };

  it('no discount ⇒ the three fields are 0 and the line is empty', () => {
    const b = userCostBreakdown(usage, 1.8, 'off', 87);
    expect([b.listInr, b.discountInr, b.discountPct]).toEqual([0, 0, 0]);
    expect(buildDiscountLine({ listInr: b.listInr, discountInr: b.discountInr, payInr: b.billedInr, pct: b.discountPct })).toBe('');
  });

  it('a discount carries the price before it, the saving and the % applied, in ₹', () => {
    const d = applyBuildDiscount({ billedUsd: 1.8, floorUsd: 0.45, pct: 20 });
    const b = userCostBreakdown(usage, d.payUsd, 'off', 87, null, d);
    expect(b.billedInr).toBeCloseTo(125.28, 2);
    expect(b.listInr).toBeCloseTo(156.6, 2);
    expect(b.discountInr).toBeCloseTo(31.32, 2);
    expect(b.discountPct).toBe(20);
    expect(buildDiscountLine({ listInr: b.listInr, discountInr: b.discountInr, payInr: b.billedInr, pct: b.discountPct }))
      .toBe('Build price ₹156.60 · Discount 20% (−₹31.32) · You pay ₹125.28');
  });

  it('🔒 White-Label: nothing in the breakdown or the line names a vendor or our cost', () => {
    const d = applyBuildDiscount({ billedUsd: 1.8, floorUsd: 0.45, pct: 20 });
    const b = userCostBreakdown(usage, d.payUsd, 'weak', 87, null, d);
    const all = JSON.stringify(b) + buildDiscountLine({ listInr: b.listInr, discountInr: b.discountInr, payInr: b.billedInr, pct: b.discountPct });
    expect(all).not.toMatch(/glm|kimi|claude|sonnet|opus|haiku|gemini|vertex|grok|anthropic|moonshot|nemotron/i);
    expect(b).not.toHaveProperty('realCostUsd');
    expect(b).not.toHaveProperty('floorUsd');
  });
});

describe('the stored setting', () => {
  const fakeDb = (doc: unknown, opts: { throwOnGet?: boolean; hang?: boolean } = {}) => {
    const set = vi.fn(async () => {});
    const get = vi.fn(async () => {
      if (opts.hang) return new Promise(() => {});
      if (opts.throwOnGet) throw new Error('unavailable');
      return { exists: doc !== undefined, data: () => doc };
    });
    const db = { collection: () => ({ doc: () => ({ get, set }) }) };
    return { db: db as never, get, set };
  };

  it('reads and normalizes the stored value, and caches it for a minute', async () => {
    const f = fakeDb({ pct: '25%', updatedAt: 5, updatedBy: 'admin' });
    const store = new BuildDiscountStore(() => f.db);
    expect((await store.read(1_000)).pct).toBe(25);
    await store.read(1_000 + BUILD_DISCOUNT_CACHE_MS - 1);
    expect(f.get).toHaveBeenCalledTimes(1);
    await store.read(1_000 + BUILD_DISCOUNT_CACHE_MS + 1);
    expect(f.get).toHaveBeenCalledTimes(2);
  });

  it('🔒 nothing stored, an unreadable value, a failed read, no database ⇒ 0% (the ordinary price)', async () => {
    expect((await new BuildDiscountStore(() => fakeDb(undefined).db).read()).pct).toBe(0);
    expect((await new BuildDiscountStore(() => fakeDb({ pct: 'lots' }).db).read()).pct).toBe(0);
    expect((await new BuildDiscountStore(() => fakeDb(undefined, { throwOnGet: true }).db).read()).pct).toBe(0);
    expect((await new BuildDiscountStore(() => null).read()).pct).toBe(0);
  });

  it('🔒 a read that hangs cannot hold a finished build: past its bound the answer is 0%', async () => {
    const store = new BuildDiscountStore(() => fakeDb(undefined, { hang: true }).db);
    expect((await store.readWithin(20)).pct).toBe(0);
  });

  it('a write stores the normalized value and is what the next read sees', async () => {
    const f = fakeDb({ pct: 0 });
    const store = new BuildDiscountStore(() => f.db);
    const saved = await store.write('30%', 'admin', 10);
    expect(saved.pct).toBe(30);
    expect(f.set).toHaveBeenCalledWith({ pct: 30, updatedAt: 10, updatedBy: 'admin' }, { merge: true });
    expect((await store.read(11)).pct).toBe(30);
  });
});

describe('REVERSION GUARDS — both settle paths apply it, last, with our cost as the floor', () => {
  const route = src('src/server/routes/agentv3.ts');

  it('the normal settle: after every zeroing rule, before the charge is recorded or debited', () => {
    const at = route.indexOf('floorUsd: decidedRealCostUsd + decidedSandboxUsd');
    const onboarding = route.indexOf("zeroBillReason = 'free onboarding build (new-user welcome credit)'");
    const recorded = route.indexOf('userCostStore.record(userId, effectiveBilledUsd)');
    const debited = route.indexOf('billedInr: effectiveBilledUsd * usdInrRate(),');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(onboarding);
    expect(recorded).toBeGreaterThan(at);
    expect(debited).toBeGreaterThan(at);
  });

  it('the time-capped finalizer applies the same rule before it records and debits', () => {
    const at = route.indexOf('floorUsd: decided.realCostUsd + decided.sandboxUsd');
    const setBilling = route.indexOf('billedUsd: Math.round(watchdogBilledUsd * 1_000_000) / 1_000_000');
    const debit = route.indexOf('billedInr: watchdogBilledUsd * usdInrRate(),');
    expect(at).toBeGreaterThan(0);
    expect(setBilling).toBeGreaterThan(at);
    expect(debit).toBeGreaterThan(at);
  });

  it('both paths hand the decision to the user-facing breakdown and the message', () => {
    expect(route).toContain('usdInrRate(), livePreviewCharge, buildDiscount);');
    expect(route).toContain('usdInrRate(), watchdogLivePreview, watchdogDiscount)');
    expect(route.match(/buildDiscountLine\(\{/g)?.length).toBe(2);
    expect(route.match(/buildDiscountStore\.readWithin\(\)/g)?.length).toBe(2);
  });

  it('the admin routes exist, behind the admin token', () => {
    const admin = src('src/server/routes/admin.ts');
    expect(admin).toContain("app.get('/api/admin/build-discount', verifyAdminToken");
    expect(admin).toContain("app.post('/api/admin/build-discount', verifyAdminToken");
  });

  it('the admin panel shows the card, and the build panel shows the line in green', () => {
    expect(src('src/components/AdminDashboard.tsx')).toContain('<BuildDiscountCard adminToken={adminToken} />');
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toMatch(/className="[^"]*text-success[^"]*" data-testid="build-discount-line"/);
  });
});
