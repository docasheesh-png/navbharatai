// BR1996 autopsy: a free Weak build with the build discount on. The green line read
// "Build price · Discount · You pay", but the settle adds to the bill after the discount, so the price
// minus the discount did not reach the amount paid. Owner rule t362u: users see only the total charged;
// how a bill is composed is admin-only. So a line that would not add up drops the worksheet and shows
// only the discount and the total. Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBuildDiscount, buildDiscountLine } from '../src/server/lib/buildDiscount';
import { buildDiscountLine as libLine, discountWorksheetReconciles } from '../src/lib/buildDiscountLine';
import { proSandboxFee } from '../src/server/AgentV3/proSandboxFee';
import { userCostBreakdown, sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { foldPlanToBudget } from '../src/server/AgentV3/fileBudget';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const usage = { inputTokens: 1000, outputTokens: 200 };
const RATE = 90;
const PINNED = 'Build price ₹156.60 · Discount 20% (−₹31.32) · You pay ₹125.28';

/** The settle's order: discount on the AI bill, then the fee on what is left. */
function settle(billedUsd: number, pct: number) {
  const d = applyBuildDiscount({ billedUsd, floorUsd: billedUsd / 10, pct });
  const fee = proSandboxFee(d.payUsd);
  const b = userCostBreakdown(usage, fee.totalUsd, 'weak', RATE, null, d, fee);
  return { d, fee, b };
}
const lineOf = (b: ReturnType<typeof userCostBreakdown>) => buildDiscountLine({
  listInr: b.listInr, discountInr: b.discountInr, payInr: b.billedInr, pct: b.discountPct,
});
const FEE_WORDS = /fee|sandbox|service|rate|2\.5|subtotal|margin|cost|markup/i;

describe('F1 — a line that would not add up shows only the discount and the total', () => {
  it('🔴 the report\'s shape: price − discount ≠ You pay ⇒ "Discount … · You pay …" only', () => {
    const { b } = settle(0.0333, 10);
    expect(b.sandboxFeeInr).toBeGreaterThan(0);
    expect(Math.abs(b.listInr - b.discountInr - b.billedInr)).toBeGreaterThanOrEqual(0.05);
    const line = lineOf(b);
    expect(line).toBe(`Discount 10% (−₹${b.discountInr.toFixed(2)}) · You pay ₹${b.billedInr.toFixed(2)}`);
    expect(line).not.toContain('Build price');
  });

  it('🔒 t362u: the line never names the fee, a rate or how the bill is composed', () => {
    for (const [usd, pct] of [[0.0333, 10], [1.8, 20], [12, 50]] as const) {
      expect(lineOf(settle(usd, pct).b), `${usd}/${pct}`).not.toMatch(FEE_WORDS);
    }
    expect(PINNED.replace('Build price', '')).not.toMatch(FEE_WORDS);
  });

  it('a larger bill with a fee also drops the worksheet, and the total is the billed amount', () => {
    const { b, fee } = settle(1.8, 20);
    expect(lineOf(b)).toBe(`Discount 20% (−₹${b.discountInr.toFixed(2)}) · You pay ₹${b.billedInr.toFixed(2)}`);
    expect(b.billedInr).toBe(Math.round(fee.totalUsd * RATE * 100) / 100);
  });

  it('🔒 a reconciling line is byte-identical to main (the existing pin)', () => {
    expect(buildDiscountLine({ listInr: 156.6, discountInr: 31.32, payInr: 125.28, pct: 20 })).toBe(PINNED);
  });

  it('no fee at all: the real breakdown keeps main\'s full line', () => {
    const d = applyBuildDiscount({ billedUsd: 1.8, floorUsd: 0.45, pct: 20 });
    const b = userCostBreakdown(usage, d.payUsd, 'off', 87, null, d);
    expect(lineOf(b)).toBe(PINNED);
  });

  it('a zero fee (a token-floor stop) keeps main\'s full line', () => {
    const d = applyBuildDiscount({ billedUsd: 0.05, floorUsd: 0.005, pct: 10 });
    const b = userCostBreakdown(usage, d.payUsd, 'weak', RATE, null, d, proSandboxFee(0));
    expect(b.sandboxFeeInr).toBe(0);
    expect(lineOf(b)).toMatch(/^Build price ₹/);
  });

  it('one paisa of independent rounding still reconciles (full line)', () => {
    expect(buildDiscountLine({ listInr: 10.01, discountInr: 1.0, payInr: 9.0, pct: 10 }))
      .toBe('Build price ₹10.01 · Discount 10% (−₹1.00) · You pay ₹9.00');
    expect(buildDiscountLine({ listInr: 9.99, discountInr: 1.0, payInr: 9.0, pct: 10 }))
      .toBe('Build price ₹9.99 · Discount 10% (−₹1.00) · You pay ₹9.00');
  });

  it('two paise apart, in either direction, drops the worksheet', () => {
    expect(buildDiscountLine({ listInr: 10.02, discountInr: 1.0, payInr: 9.0, pct: 10 })).toBe('Discount 10% (−₹1.00) · You pay ₹9.00');
    expect(buildDiscountLine({ listInr: 9.98, discountInr: 1.0, payInr: 9.0, pct: 10 })).toBe('Discount 10% (−₹1.00) · You pay ₹9.00');
  });

  it('NaN or unusable figures keep main\'s form (fail-safe: unclear keeps main)', () => {
    const main = (d: { listInr: number; discountInr: number; payInr: number; pct: number }) =>
      `Build price ₹${d.listInr.toFixed(2)} · Discount ${d.pct}% (−₹${d.discountInr.toFixed(2)}) · You pay ₹${d.payInr.toFixed(2)}`;
    for (const d of [
      { listInr: Number.NaN, discountInr: 1, payInr: 9, pct: 10 },
      { listInr: 10, discountInr: 1, payInr: Number.NaN, pct: 10 },
      { listInr: Infinity, discountInr: 1, payInr: 9, pct: 10 },
    ]) {
      expect(discountWorksheetReconciles(d)).toBe(true);
      expect(buildDiscountLine(d)).toBe(main(d));
    }
  });

  it('no discount ⇒ no line, as on main', () => {
    expect(buildDiscountLine({ listInr: 0, discountInr: 0, payInr: 2.5, pct: 0 })).toBe('');
    expect(buildDiscountLine({ listInr: 3, discountInr: 0.3, payInr: 2.7, pct: 0 })).toBe('');
    expect(buildDiscountLine({ listInr: 3, discountInr: Number.NaN, payInr: 2.7, pct: 10 })).toBe('');
    const fee = proSandboxFee(0.03);
    expect(lineOf(userCostBreakdown(usage, fee.totalUsd, 'weak', RATE, null, null, fee))).toBe('');
  });

  it('🔒 the server line is the shared client-safe one', () => {
    expect(buildDiscountLine).toBe(libLine);
    expect(src('src/lib/buildDiscountLine.ts')).not.toMatch(/from ['"][^'"]*server/);
  });

  it('🔒 both settle paths call it with no fee field; the panel renders the same function', () => {
    const route = src('src/server/routes/agentv3.ts');
    expect(route.match(/buildDiscountLine\(\{/g)?.length).toBe(2);
    expect(route).not.toMatch(/buildDiscountLine\(\{[^}]*sandboxFee/);
    expect(route).toContain('payInr: costBreakdown.billedInr, pct: costBreakdown.discountPct,\n      })');
    expect(route).toContain('payInr: watchdogCostBreakdown.billedInr, pct: watchdogCostBreakdown.discountPct,\n        })');
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain("import { buildDiscountLine } from '../../lib/buildDiscountLine';");
    const at = panel.indexOf('data-testid="build-discount-line"');
    const block = panel.slice(at, panel.indexOf('</div>', at));
    expect(block).toContain('{buildDiscountLine({ listInr: state.costBreakdown?.listInr ?? 0, discountInr: state.costBreakdown?.discountInr ?? 0, payInr: state.costBreakdown?.billedInr ?? 0, pct: state.costBreakdown?.discountPct ?? 0 })}');
    expect(block).not.toMatch(/sandboxFee|Build price ₹\{/);
  });

  it('🔒 out of scope and unchanged: the fold\'s own fee line (queued as Q-2711)', () => {
    expect(src('src/components/agentv3/AgentV3Panel.tsx')).toContain('Sandbox service fee (2.5% of subtotal): ₹{state.costBreakdown.sandboxFeeInr.toFixed(2)}');
  });
});

describe('E — already closed on main (the report predates these)', () => {
  it('E1 (BR1952 #4124): package.json and tsconfig.json keep their own files when a plan is folded', () => {
    const files = [
      'src/App.tsx', 'src/main.tsx', 'index.html', 'package.json', 'tsconfig.json', 'vite.config.ts',
      'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts',
    ].map((path) => ({ path, purpose: 'x' }));
    const out = foldPlanToBudget(files, { maxFiles: 10, label: 'simple' });
    const paths = out.files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('tsconfig.json');
    expect(out.folded).not.toContain('package.json');
  });

  it('E2 (BR1952 #4124): the text-only fast lane is skipped when workspace setup failed', () => {
    expect(src('src/server/routes/agentv3.ts')).toContain('const fastLaneWouldRun = !sandboxUnavailable && ');
  });

  it('E3 (BR1961 #4146): a failed setup no longer tells the user to start the build again', () => {
    const note = sandboxUnavailableNotice();
    expect(note).toContain("You don't need to start the build again.");
    expect(note).not.toMatch(/can't create files|try building again/i);
    expect(note).not.toMatch(/e2b|rate limit|concurrent/i);
  });
});
