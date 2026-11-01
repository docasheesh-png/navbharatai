import { afterEach, describe, expect, it, vi } from 'vitest';
import { proSandboxFee, proSandboxFeeFields, proSubtotalNotice } from '../src/server/AgentV3/proSandboxFee';
import { sandboxExpenseUsd, sandboxCost, sandboxBillingNote } from '../src/server/AgentV3/sandboxCost';
import { decideBuildBilledUsd, userCostBreakdown, livePreviewChargeLine } from '../src/server/routes/agentv3';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';
import { liveCostInr } from '../src/server/AgentV3/liveBuildCost';
afterEach(() => vi.unstubAllEnvs());
describe('all-Pro subtotal sandbox service fee', () => {
  it.each(['weak', 'off', 'mini', 'medium', 'max'])('replaces measured VM billing for %s', tier => {
    vi.stubEnv('AGENTV3_REALCOST_BILLING', 'on');
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', { inputTokens: 1000, outputTokens: 500 }, 'glm-4.7-flashx');
    const without = decideBuildBilledUsd(ledger, ledger.total(), tier, null, null, 0);
    const withExpense = decideBuildBilledUsd(ledger, ledger.total(), tier, null, null, 100);
    expect(withExpense.effectiveBilledUsd).toBe(without.effectiveBilledUsd);
    expect(withExpense.sandboxUsd).toBe(100);
    const discounted = applyBuildDiscount({ billedUsd: withExpense.effectiveBilledUsd, floorUsd: withExpense.realCostUsd, pct: 10 });
    const fee = proSandboxFee(discounted.payUsd);
    expect(fee.feeUsd).toBe(discounted.payUsd / 40);
    expect(liveCostInr({ charged: true, onboardingFreeBuildPossible: false, billedUsd: withExpense.effectiveBilledUsd,
      floorUsd: withExpense.realCostUsd, discountPct: 10, usdInr: 95 })).toBe(Math.round(fee.totalUsd * 9500) / 100);
  });
  it('applies after discount and floor, never as a circular percentage of the final total', () => {
    const subtotal = applyBuildDiscount({ billedUsd: 100, floorUsd: 20, pct: 10 }).payUsd;
    expect(proSandboxFee(subtotal)).toEqual({ subtotalUsd: 90, feeUsd: 2.25, totalUsd: 92.25 });
    expect(proSandboxFeeFields(proSandboxFee(90))).toEqual({ preSandboxSubtotalUsd: 90, sandboxFeeUsd: 2.25, sandboxFeePct: 2.5 });
    expect(proSandboxFee(applyBuildDiscount({ billedUsd: 100, floorUsd: 70, pct: 50 }).payUsd).totalUsd).toBe(71.75);
  });
  it.each([0, -1, NaN, Infinity, Number.MAX_VALUE])('zero/invalid/overflow subtotal cannot acquire a charge: %s', value => {
    expect(proSandboxFee(value)).toEqual({ subtotalUsd: 0, feeUsd: 0, totalUsd: 0 });
  });
  it('unknown Router One expense remains unbillable even with measured sandbox expense', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('ENGINE_R1', { inputTokens: 10000, outputTokens: 10000 }, 'deepseek-v4.1-flash');
    const bill = decideBuildBilledUsd(ledger, ledger.total(), 'weak', null, null, 5);
    expect(proSandboxFee(bill.effectiveBilledUsd).totalUsd).toBe(0);
    expect(bill.sandboxUsd).toBe(5);
  });
  it('keeps rate-priced expense internal even with the old billing flag off; no placeholder expense', () => {
    const env = { E2B_USD_PER_HOUR: '0.2', AGENTV3_BILL_SANDBOX: 'off' };
    const cost = sandboxCost(1800, env);
    expect(sandboxExpenseUsd(cost, env)).toBe(0.1);
    expect(sandboxExpenseUsd(cost, {})).toBe(0);
    expect(sandboxBillingNote(cost, env, 1800, true)).toContain('Internal expense only');
    expect(sandboxBillingNote(cost, env, 900, true)).toContain('$0.0500');
  });
  it('waiver copy distinguishes AI margin from the separately itemized fee', () => {
    const message = proSubtotalNotice('At cost — no service charge on top.');
    expect(message).toContain('no AI service margin on top');
    expect(message).toContain('sandbox service fee is 2.5%');
    expect(message).not.toContain('no service charge on top');
  });
  it('itemizes the fee without pretending it is VM seconds or stacking the legacy display', () => {
    const fee = proSandboxFee(100);
    const b = userCostBreakdown({ inputTokens: 0, outputTokens: 0 }, fee.totalUsd, 'weak', 1, { seconds: 3600, usd: 50 }, null, fee);
    expect(b).toMatchObject({ sandboxFeeInr: 2.5, sandboxFeePct: 2.5, preSandboxSubtotalInr: 100, livePreviewInr: 0, livePreviewSeconds: 0 });
    expect(livePreviewChargeLine(b)).toBe('Sandbox service fee (2.5% of subtotal): ₹2.50.');
  });
});
