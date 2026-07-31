import { describe, it, expect, afterEach } from 'vitest';
import { decideBuildBilledUsd, type BillingLedgerView } from '../src/server/routes/agentv3';
import { billedAmountUsd, powerToTier } from '../src/server/AgentV3/pricing';
import { realProviderCostUsd, tieredMarkupUsd } from '../src/server/AgentV3/providerRates';

/**
 * decideBuildBilledUsd is THE single billing decision for a build (Fix 65 + Fix 67) — the one function
 * BOTH exit paths (the normal settle AND the wall-clock/advisory finalizer) call, so they can never bill
 * differently. It was the only guard in the money path with no direct unit test; this locks its decision
 * table forever (the worst past incidents — a failed build billed ₹811, an overran build billed the wrong
 * ₹250 — were exactly this function's branches going wrong).
 */

// A structural mock of the per-provider ledger (matches BillingLedgerView).
function mockLedger(
  entries: Array<{ provider: string; model?: string; usage: { inputTokens: number; outputTokens: number } }>,
): BillingLedgerView {
  const byProvider: Record<string, { inputTokens: number; outputTokens: number }> = {};
  let ti = 0, to = 0;
  for (const e of entries) {
    byProvider[e.provider] ??= { inputTokens: 0, outputTokens: 0 };
    byProvider[e.provider].inputTokens += e.usage.inputTokens;
    byProvider[e.provider].outputTokens += e.usage.outputTokens;
    ti += e.usage.inputTokens; to += e.usage.outputTokens;
  }
  return { entries: () => entries, byProvider: () => byProvider, total: () => ({ inputTokens: ti, outputTokens: to }) };
}

const ENV_KEYS = ['AGENTV3_REALCOST_BILLING', 'AGENTV3_PER_TIER_BILLING', 'AGENTV3_COST_ROUTING'] as const;
const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function setEnv(patch: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('decideBuildBilledUsd — the single billing decision', () => {
  it('OPUS tiers keep real Opus × 2 (the flat amount), regardless of the real-cost switch', () => {
    const ledger = mockLedger([{ provider: 'claude', model: 'opus', usage: { inputTokens: 10_000, outputTokens: 4_000 } }]);
    const sink = { inputTokens: 10_000, outputTokens: 4_000 };
    for (const realcost of ['on', 'off']) {
      setEnv({ AGENTV3_REALCOST_BILLING: realcost });
      const r = decideBuildBilledUsd(ledger, sink, 'medium', null, null); // 'medium' = Powerful = Opus
      expect(powerToTier('medium')).toBe('opus');
      expect(r.isOpusTier).toBe(true);
      expect(r.effectiveBilledUsd).toBe(billedAmountUsd(sink, 'medium'));
    }
  });

  it('NON-Opus + real-cost ON (the default): bills tieredMarkup(real provider cost)', () => {
    setEnv({ AGENTV3_REALCOST_BILLING: 'on' });
    const entries = [
      { provider: 'glm', model: 'glm-5.2', usage: { inputTokens: 20_000, outputTokens: 8_000 } },
      { provider: 'kimi', model: 'kimi-k2.7-code', usage: { inputTokens: 5_000, outputTokens: 2_000 } },
    ];
    const ledger = mockLedger(entries);
    const sink = { inputTokens: 30_000, outputTokens: 11_000 }; // 5k in / 1k out unattributed aux (plan/judge)
    const remainder = { inputTokens: 5_000, outputTokens: 1_000 };
    const r = decideBuildBilledUsd(ledger, sink, 'off', null, null); // 'off' = Normal (non-Opus)
    expect(r.isOpusTier).toBe(false);
    expect(r.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(realProviderCostUsd(entries, remainder)), 9);
    expect(r.realCostRemainder).toEqual(remainder);
  });

  it('NON-Opus + real-cost OFF + no per-tier/cost-routing: falls back to the legacy flat amount', () => {
    setEnv({ AGENTV3_REALCOST_BILLING: 'off', AGENTV3_PER_TIER_BILLING: undefined, AGENTV3_COST_ROUTING: undefined });
    const ledger = mockLedger([{ provider: 'glm', usage: { inputTokens: 12_000, outputTokens: 3_000 } }]);
    const sink = { inputTokens: 12_000, outputTokens: 3_000 };
    const r = decideBuildBilledUsd(ledger, sink, 'off', null, null);
    expect(r.effectiveBilledUsd).toBe(billedAmountUsd(sink, 'off'));
  });

  it('reconciledProviderUsage always sums to the sink total (admin-report invariant)', () => {
    const entries = [
      { provider: 'glm', usage: { inputTokens: 9_000, outputTokens: 4_000 } },
      { provider: 'claude', usage: { inputTokens: 3_000, outputTokens: 1_000 } },
    ];
    const sink = { inputTokens: 15_000, outputTokens: 6_000 }; // 3k in / 1k out aux remainder
    const r = decideBuildBilledUsd(mockLedger(entries), sink, 'off', null, null);
    const summed = Object.values(r.reconciledProviderUsage).reduce(
      (a, u) => ({ inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens }),
      { inputTokens: 0, outputTokens: 0 },
    );
    expect(summed).toEqual(sink);
  });

  it('realCostRemainder is never negative (ledger attributed more than the sink → 0, no negative bill)', () => {
    const entries = [{ provider: 'glm', usage: { inputTokens: 50_000, outputTokens: 20_000 } }];
    const sink = { inputTokens: 10_000, outputTokens: 4_000 }; // smaller than the ledger (defensive edge)
    const r = decideBuildBilledUsd(mockLedger(entries), sink, 'off', null, null);
    expect(r.realCostRemainder.inputTokens).toBeGreaterThanOrEqual(0);
    expect(r.realCostRemainder.outputTokens).toBeGreaterThanOrEqual(0);
  });
});
