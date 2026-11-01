import { describe, expect, it } from 'vitest';
import { calculateCatalogueChatCost, catalogueSnapshotIssue, type CatalogueSnapshot } from '../src/server/AI/RouterOne/catalogueMath';
const now = 100_000, ttl = 60_000;
const snapshot = (): CatalogueSnapshot => ({ kind: 'posted-wallet-token-tariff', provider: 'ENGINE_R1',
  model: 'synthetic-model', currency: 'USD', unit: 'USD/1000000-tokens', source: 'https://router.one/models/synthetic-model', fetchedAt: 90_000,
  bands: [{ aboveInputTokens: -1, inputUsdPerMillion: '0.60', outputUsdPerMillion: '2.40', cacheReadUsdPerMillion: '0.012', cacheWriteUsdPerMillion: '0.60' }] });
const usage = (input = 10000, read = 6000, output = 500) => ({ prompt_tokens: input, completion_tokens: output,
  total_tokens: input + output, prompt_tokens_details: { cached_tokens: read } });
const calc = (u: unknown = usage(), s = snapshot(), complete = true, model = s.model) => calculateCatalogueChatCost(s, model, u, complete, now, ttl);
describe('catalogue arithmetic is distinct from a settled wallet debit', () => {
  it('prices cached input once, multiplies by 2.5 once, and snapshots immutably', () => {
    const s = snapshot(); const result = calc(usage(), s);
    expect(result).toMatchObject({ kind: 'catalogue-calculated', costAttoUsd: '3672000000000000', modelSubtotalAttoUsd: '9180000000000000', billingAuthorized: false, settledWalletDebit: false });
    if (result.kind !== 'catalogue-calculated') throw new Error('expected calculation');
    s.bands = []; expect(result.snapshot.bands).toHaveLength(1); expect(Object.isFrozen(result.snapshot.bands[0])).toBe(true);
  });
  it('selects a long-context tier strictly above the boundary for the whole request', () => {
    const s = snapshot(); s.bands = [...s.bands, { aboveInputTokens: 10000, inputUsdPerMillion: '1.20', outputUsdPerMillion: '4.80', cacheReadUsdPerMillion: '0.024', cacheWriteUsdPerMillion: '1.20' }];
    expect(calc(usage(10000, 0, 500), s)).toMatchObject({ bandAboveInputTokens: -1, costAttoUsd: '7200000000000000' });
    expect(calc(usage(10001, 0, 500), s)).toMatchObject({ bandAboveInputTokens: 10000, costAttoUsd: '14401200000000000' });
  });
  it.each([undefined, {}, { prompt_tokens: 4 }, { prompt_tokens: 0, completion_tokens: 0 }, usage(10, 11), usage(-1, 0), { ...usage(), total_tokens: 1 }])('keeps incomplete/invalid usage pending: %j', u => {
    expect(calculateCatalogueChatCost(snapshot(), 'synthetic-model', u, true, now, ttl)).toMatchObject({ kind: 'pending', billingAuthorized: false });
  });
  it('preserves explicit zero separately from absent cache usage', () => {
    expect(calc(usage(0, 0, 0))).toMatchObject({ kind: 'catalogue-calculated', costAttoUsd: '0' });
    expect(calc(usage(), snapshot(), false)).toMatchObject({ kind: 'pending', reason: 'incomplete-usage' });
    expect(calc(usage(), snapshot(), true, 'other-model')).toMatchObject({ kind: 'pending', reason: 'model-mismatch' });
  });
  it('unknown cache split is calculable only when all input categories share a rate', () => {
    const s = snapshot(); s.bands = [{ ...s.bands[0], cacheReadUsdPerMillion: '0.6' }];
    expect(calc({ prompt_tokens: 10, completion_tokens: 2 }, s)).toMatchObject({ kind: 'catalogue-calculated', cacheReadTokens: null, cacheWriteTokens: null });
    expect(calc({ prompt_tokens: 10, completion_tokens: 2 })).toMatchObject({ kind: 'pending', reason: 'missing-cache-read' });
  });
  it('does not guess a Chat write counter or add cache aliases twice', () => {
    const s = snapshot(); s.bands = [{ ...s.bands[0], cacheWriteUsdPerMillion: '0.75' }];
    expect(catalogueSnapshotIssue(s, now, ttl)).toBe('unsupported-chat-cache-write-tariff');
    expect(calc({ ...usage(), cached_tokens: 100 })).toMatchObject({ kind: 'pending', reason: 'ambiguous-cache-alias' });
    expect(calc({ ...usage(), prompt_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1 } })).toMatchObject({ kind: 'pending', reason: 'unsupported-chat-cache-write-field' });
  });
  it.each(['0.0001', '0', '10000.123456789'])('never guesses rate units from magnitude: %s', price => {
    const s = snapshot(); s.bands = [{ aboveInputTokens: -1, inputUsdPerMillion: price, outputUsdPerMillion: price, cacheReadUsdPerMillion: price, cacheWriteUsdPerMillion: price }];
    const r = calc(usage(1, 0, 0), s); expect(r.kind).toBe('catalogue-calculated');
    if (r.kind === 'catalogue-calculated') expect(Number(r.costAttoUsd) / 1e18).toBeCloseTo(Number(price) / 1e6, 14);
  });
  it.each(['-1', 'NaN', 'Infinity', '1e-6', '0.1234567891'])('rejects malformed prices: %s', price => {
    const s = snapshot(); s.bands = [{ ...s.bands[0], outputUsdPerMillion: price }];
    expect(catalogueSnapshotIssue(s, now, ttl)).toBe('invalid-price');
  });
  it('rejects plan/unit/foreign-source/stale or future snapshots before any call', () => {
    for (const change of [{ kind: 'plan-quota' }, { unit: 'USD/token' }, { source: 'https://example.invalid/models/x' }, { fetchedAt: 1 }, { fetchedAt: now + 1 }]) {
      expect(catalogueSnapshotIssue({ ...snapshot(), ...change } as CatalogueSnapshot, now, ttl)).not.toBeNull();
    }
  });
});
