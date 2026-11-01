import { afterEach, describe, expect, it, vi } from 'vitest';
import { realProviderCostUsd, realRateFor } from '../src/server/AgentV3/providerRates';
import { RouterOneAccountingUnavailableError, routerOneAccountingFetch } from '../src/server/AI/RouterOne/accounting';
import { ledgerCostUsd } from '../src/server/AgentV3/buildCostCeiling';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { decideBuildBilledUsd } from '../src/server/routes/agentv3';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';

const usage = { inputTokens: 25062, outputTokens: 13686, cacheReadInputTokens: 16512 };
const model = 'deepseek-v4.1-flash';
afterEach(() => vi.unstubAllEnvs());

describe('Router One cannot inherit direct-provider rates or invent an actual expense', () => {
  it.each([model, 'glm-4.7-flash', 'claude-sonnet-4', 'kimi-k2.7', undefined])('rejects rate lookup for %s before model matching', id => {
    expect(() => realRateFor('ENGINE_R1', id)).toThrow(RouterOneAccountingUnavailableError);
    expect(() => realProviderCostUsd([{ provider: 'engine_r1', model: id, usage }])).toThrow(RouterOneAccountingUnavailableError);
  });
  it.each([undefined, {}, { totalCost: 0.0385 }, { walletChargedUsd: 0.0385 }, { buyer_cost_micro: 38500 }, { walletChargedUsd: -1 }, { chargeSource: 'pending' }])('does not accept unverified receipt-like data: %j', receipt => {
    const entry = { provider: 'ENGINE_R1', model, usage, receipt };
    expect(() => realProviderCostUsd([entry])).toThrow(RouterOneAccountingUnavailableError);
  });
  it('cost ceiling preserves other supplier expense when Router One expense is unknown', () => {
    const other = { provider: 'CLAUDE', model: 'claude-sonnet-4', usage: { inputTokens: 1000, outputTokens: 100 } };
    expect(ledgerCostUsd([{ provider: 'ENGINE_R1', model, usage }, other])).toBe(realProviderCostUsd([other]));
  });
});

describe('unavailable Router One settlement is absorbed separately at every billing mode', () => {
  it.each(['off', 'low', 'medium', 'max'] as const)('excludes it before legacy pricing for tier %s', tier => {
    for (const enabled of ['on', 'off']) {
      vi.stubEnv('AGENTV3_REALCOST_BILLING', enabled);
      const ledger = createProviderUsageLedger();
      ledger.add('ENGINE_R1', usage, model);
      const bill = decideBuildBilledUsd(ledger, ledger.total(), tier, null, null);
      expect(bill.effectiveBilledUsd).toBe(0);
      expect(bill.realCostUsd).toBe(0); // Known subtotal only; diagnostic explicitly says expense unknown.
      expect(bill.realCostRemainder).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(bill.reconciledProviderUsage.ENGINE_R1.inputTokens).toBe(usage.inputTokens);
    }
  });
  it('keeps mixed provider, sandbox, discount and real-cost floor identical to the remaining bill', () => {
    const rest = createProviderUsageLedger();
    rest.add('CLAUDE', { inputTokens: 1000, outputTokens: 100 }, 'claude-sonnet-4');
    const mixed = createProviderUsageLedger();
    mixed.add('CLAUDE', { inputTokens: 1000, outputTokens: 100 }, 'claude-sonnet-4');
    mixed.add('ENGINE_R1', usage, model);
    const expected = decideBuildBilledUsd(rest, rest.total(), 'off', null, null, 0.006324);
    const actual = decideBuildBilledUsd(mixed, mixed.total(), 'off', null, null, 0.006324);
    expect(actual.effectiveBilledUsd).toBe(expected.effectiveBilledUsd);
    expect(actual.realCostUsd).toBe(expected.realCostUsd);
    expect(actual.sandboxUsd).toBe(expected.sandboxUsd);
    for (const pct of [0, 10, 99]) {
      expect(applyBuildDiscount({ billedUsd: actual.effectiveBilledUsd, floorUsd: actual.realCostUsd, pct }))
        .toEqual(applyBuildDiscount({ billedUsd: expected.effectiveBilledUsd, floorUsd: expected.realCostUsd, pct }));
    }
    expect(decideBuildBilledUsd(mixed, mixed.total(), 'off', null, null, 0.006324)).toEqual(actual);
  });
  it('never adds cache tokens again, even for repeated, discarded or barren calls', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('ENGINE_R1', usage, model);
    ledger.add('ENGINE_R1', usage, model, { producedNothing: true, phase: 'failed' });
    const bill = decideBuildBilledUsd(ledger, ledger.total(), 'off', null, null, 0, new Set(['failed']));
    expect(bill.effectiveBilledUsd).toBe(0);
    expect(bill.realCostRemainder).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(bill.reconciledProviderUsage.ENGINE_R1.inputTokens).toBe(2 * usage.inputTokens);
  });
});

describe('Router One audit transport', () => {
  it('propagates a transport guard refusal instead of absorbing it as an accounting failure', async () => {
    const record = vi.fn();
    const guarded = vi.fn(async () => { throw new Error('canary denied'); });
    await expect(routerOneAccountingFetch(guarded, model, record)('https://example.invalid')).rejects.toThrow('canary denied');
    expect(record).not.toHaveBeenCalled();
  });
  it('preserves the documented request header without consuming the response or inventing an expense', async () => {
    const response = new Response('data: streamed-content', { headers: { 'X-Request-ID': 'request-123' } });
    const transport = vi.fn(async () => response);
    const record = vi.fn();
    const result = await routerOneAccountingFetch(transport, model, record)('https://example.invalid/v1/chat/completions');
    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    expect(record).toHaveBeenCalledExactlyOnceWith({ requestId: 'request-123', model, status: 200, expenseEvidence: 'unknown' });
    expect(await result.text()).toBe('data: streamed-content');
  });
  it('records unavailable correlation on failed responses and tolerates audit failure', async () => {
    const response = new Response('failed', { status: 500 });
    const record = vi.fn(() => { throw new Error('audit unavailable'); });
    expect(await routerOneAccountingFetch(async () => response, model, record)('https://example.invalid')).toBe(response);
    expect(record).toHaveBeenCalledWith({ requestId: null, model, status: 500, expenseEvidence: 'unknown' });
  });
});
