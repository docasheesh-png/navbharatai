import { describe, it, expect } from 'vitest';
import { issueVerifiedFreeProof } from '../AI/LiveRegistry/proof';
import { createProviderUsageLedger } from './ProviderUsageLedger';
import { realProviderCostUsd } from './providerRates';
import { billableEntries } from './unbilledTurns';
const model = 'vendor/future-model:free';
const usage = { inputTokens: 1000, outputTokens: 100 };
const proof = () => issueVerifiedFreeProof({ modelId: model, ...usage, registryVersion: 'v1', verifiedAt: 100, basis: 'explicit-zero-fees', estimatedInferenceUsd: '0', reportedCost: '0' });
describe('verified-free builder pricing receipts', () => {
  it('prices a verified dispatch at zero without needing a hardcoded model rate', () => {
    const ledger = createProviderUsageLedger(); const receipt = proof();
    ledger.add('OPENROUTER', { ...usage, pricingProof: receipt }, model);
    expect(ledger.entries()[0].pricingProof).toBe(receipt);
    expect(realProviderCostUsd(ledger.entries())).toBe(0);
  });
  it('does not merge verified and unknown usage with identical labels', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('OPENROUTER', { ...usage, pricingProof: proof() }, model);
    ledger.add('OPENROUTER', usage, model);
    ledger.add('OPENROUTER', { ...usage, pricingProof: proof() }, model);
    expect(ledger.entries()).toHaveLength(3);
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.0045);
    expect(ledger.total()).toEqual({ inputTokens: 3000, outputTokens: 300 });
  });
  it('never treats a free suffix or provider name as proof', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model, usage }])).toBeCloseTo(0.0045);
  });
  it('does not inherit a zero direct-provider rate from an OpenRouter model alias', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model: 'z-ai/glm-4.7-flash:free', usage }])).toBeCloseTo(0.0045);
  });
  it('rejects a serialized receipt', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model, usage, pricingProof: JSON.parse(JSON.stringify(proof())) }])).toBeGreaterThan(0);
  });
  it('rejects a receipt for another model', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model: 'different:free', usage, pricingProof: proof() }])).toBeGreaterThan(0);
  });
  it('rejects usage exceeding the receipt', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model, usage: { ...usage, outputTokens: 101 }, pricingProof: proof() }])).toBeGreaterThan(0);
  });
  it('does not waive unknown aux cost', () => {
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model, usage, pricingProof: proof() }], usage)).toBeCloseTo(0.0045);
  });
  it('does not waive a different provider', () => {
    expect(realProviderCostUsd([{ provider: 'CLAUDE', model, usage, pricingProof: proof() }])).toBeGreaterThan(0);
  });
  it('preserves receipts when subtracting discarded or barren output', () => {
    const ledger = createProviderUsageLedger(); const receipt = proof();
    ledger.add('OPENROUTER', { ...usage, pricingProof: receipt }, model, { discardedOutput: true });
    const entries = billableEntries(ledger.entries());
    expect(entries[0].pricingProof).toBe(receipt);
    expect(entries[0].usage.outputTokens).toBe(0);
    expect(realProviderCostUsd(entries)).toBe(0);
  });
  it('records later discarded output in separate receipt slices', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('OPENROUTER', { ...usage, pricingProof: proof() }, model, { phase: 'plan' });
    ledger.add('OPENROUTER', { ...usage, pricingProof: proof() }, model, { phase: 'plan' });
    ledger.discardOutput('OPENROUTER', model, 150, { phase: 'plan' });
    expect(ledger.entries().map(e => e.unbilled?.outputTokens)).toEqual([50, 100]);
    expect(realProviderCostUsd(billableEntries(ledger.entries()))).toBe(0);
  });
  it('does not grant zero pricing when usage was not reported', () => {
    const missing = issueVerifiedFreeProof({ modelId: model, registryVersion: 'v1', verifiedAt: 100, basis: 'explicit-zero-fees', estimatedInferenceUsd: '0', reportedCost: null });
    expect(realProviderCostUsd([{ provider: 'OPENROUTER', model, usage, pricingProof: missing }])).toBeGreaterThan(0);
  });
});
