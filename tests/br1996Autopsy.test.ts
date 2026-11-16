// BR1996 autopsy: a free Weak build with the build discount on. The green line read
// "Build price · Discount · You pay", but the sandbox service fee was added AFTER the discount, so the
// price minus the discount did not reach the amount paid. Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBuildDiscount, buildDiscountLine, discountLineFeePart } from '../src/server/lib/buildDiscount';
import { proSandboxFee } from '../src/server/AgentV3/proSandboxFee';
import { userCostBreakdown, sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { foldPlanToBudget } from '../src/server/AgentV3/fileBudget';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const usage = { inputTokens: 1000, outputTokens: 200 };
const RATE = 90;

/** The settle's order: discount on the AI bill, then the fee on what is left. */
function settle(billedUsd: number, pct: number) {
  const d = applyBuildDiscount({ billedUsd, floorUsd: billedUsd / 10, pct });
  const fee = proSandboxFee(d.payUsd);
  const b = userCostBreakdown(usage, fee.totalUsd, 'weak', RATE, null, d, fee);
  return { d, fee, b };
}
const lineOf = (b: ReturnType<typeof userCostBreakdown>) => buildDiscountLine({
  listInr: b.listInr, discountInr: b.discountInr, payInr: b.billedInr, pct: b.discountPct, sandboxFeeInr: b.sandboxFeeInr,
});

describe('F1 — the discount line names the fee that was added after the discount', () => {
  it('🔴 the report\'s shape: price − discount alone does not reach "You pay"; with the fee it does', () => {
    const { b } = settle(0.0333, 10);
    expect(b.discountInr).toBeGreaterThan(0);
    expect(b.sandboxFeeInr).toBeGreaterThan(0);
    // Main's line: the two numbers on it do not add up to the third.
    expect(Math.abs(b.listInr - b.discountInr - b.billedInr)).toBeGreaterThanOrEqual(0.05);
    const line = lineOf(b);
    expect(line).toBe(
      `Build price ₹${b.listInr.toFixed(2)} · Discount 10% (−₹${b.discountInr.toFixed(2)}) · Sandbox service fee +₹${b.sandboxFeeInr!.toFixed(2)} · You pay ₹${b.billedInr.toFixed(2)}`,
    );
    // Every figure is the breakdown's own; they now reconcile within one paisa of rounding.
    expect(Math.abs(b.listInr - b.discountInr + b.sandboxFeeInr! - b.billedInr)).toBeLessThanOrEqual(0.011);
  });

  it('a larger bill reconciles too', () => {
    const { b } = settle(1.8, 20);
    expect(Math.abs(b.listInr - b.discountInr + b.sandboxFeeInr! - b.billedInr)).toBeLessThanOrEqual(0.011);
    expect(lineOf(b)).toContain(' · Sandbox service fee +₹');
  });

  it('🔒 no fee passed: byte-identical to main (the existing pin)', () => {
    expect(buildDiscountLine({ listInr: 156.6, discountInr: 31.32, payInr: 125.28, pct: 20 }))
      .toBe('Build price ₹156.60 · Discount 20% (−₹31.32) · You pay ₹125.28');
  });

  it('a zero, negative or unusable fee keeps main\'s line exactly', () => {
    const base = 'Build price ₹156.60 · Discount 20% (−₹31.32) · You pay ₹125.28';
    for (const fee of [0, -0.5, Number.NaN, Infinity, -Infinity, undefined, '0.07' as unknown as number, null as unknown as number]) {
      expect(buildDiscountLine({ listInr: 156.6, discountInr: 31.32, payInr: 125.28, pct: 20, sandboxFeeInr: fee }), String(fee)).toBe(base);
      expect(discountLineFeePart(fee)).toBe('');
    }
  });

  it('no discount ⇒ still no line, even with a fee', () => {
    expect(buildDiscountLine({ listInr: 0, discountInr: 0, payInr: 2.5, pct: 0, sandboxFeeInr: 0.06 })).toBe('');
    const fee = proSandboxFee(0.03);
    const b = userCostBreakdown(usage, fee.totalUsd, 'weak', RATE, null, null, fee);
    expect(lineOf(b)).toBe('');
  });

  it('a stop billed at the token floor carries no fee (proSandboxFee(0)), so its line is main\'s', () => {
    const d = applyBuildDiscount({ billedUsd: 0.05, floorUsd: 0.005, pct: 10 });
    const b = userCostBreakdown(usage, d.payUsd, 'weak', RATE, null, d, proSandboxFee(0));
    expect(b.sandboxFeeInr).toBe(0);
    expect(lineOf(b)).not.toContain('Sandbox service fee');
  });

  it('nothing charged changes: the bill is the same with or without the line', () => {
    const { b, fee } = settle(0.0333, 10);
    expect(b.billedInr).toBe(Math.round(fee.totalUsd * RATE * 100) / 100);
  });

  it('🔒 White-Label: the new part names no vendor and no cost of ours', () => {
    const { b } = settle(0.0333, 10);
    expect(lineOf(b)).not.toMatch(/e2b|glm|kimi|claude|sonnet|gemini|qwen|surplus|anthropic|real cost/i);
  });

  it('🔒 both route call sites pass the breakdown\'s fee; the panel line names it too', () => {
    const route = src('src/server/routes/agentv3.ts');
    expect(route.match(/buildDiscountLine\(\{/g)?.length).toBe(2);
    expect(route).toContain('pct: costBreakdown.discountPct, sandboxFeeInr: costBreakdown.sandboxFeeInr,');
    expect(route).toContain('pct: watchdogCostBreakdown.discountPct, sandboxFeeInr: watchdogCostBreakdown.sandboxFeeInr,');
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    const at = panel.indexOf('data-testid="build-discount-line"');
    const block = panel.slice(at, panel.indexOf('</div>', at));
    expect(block).toContain(' · Sandbox service fee +₹${state.costBreakdown.sandboxFeeInr.toFixed(2)}');
    expect(block).toContain('state.costBreakdown.sandboxFeeInr > 0');
    expect(block).toContain("(−₹{(state.costBreakdown?.discountInr ?? 0).toFixed(2)}){/* BR1996: the fee added after the discount */}{typeof state.costBreakdown?.sandboxFeeInr === 'number' && Number.isFinite(state.costBreakdown.sandboxFeeInr) && state.costBreakdown.sandboxFeeInr > 0 ? ");
    expect(block.indexOf('Sandbox service fee')).toBeLessThan(block.indexOf('You pay'));
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
