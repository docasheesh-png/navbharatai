import { describe, it, expect } from 'vitest';
import { ledgerCostUsd } from './buildCostCeiling';

describe('BMI autopsy — unsettled Surplus usage never aborts a build', () => {
  it('prices an unsettled Surplus entry at 0 instead of throwing', () => {
    const entries = [
      { provider: 'SURPLUS', model: 'qwen3-coder', usage: { inputTokens: 1000, outputTokens: 500 } },
    ] as unknown as Parameters<typeof ledgerCostUsd>[0];
    expect(() => ledgerCostUsd(entries)).not.toThrow();
    expect(ledgerCostUsd(entries)).toBe(0);
  });
  it('still prices the non-Surplus entries next to an unsettled Surplus one', () => {
    const entries = [
      { provider: 'SURPLUS', model: 'qwen3-coder', usage: { inputTokens: 1000, outputTokens: 500 } },
      { provider: 'GLM', model: 'glm-4.6', usage: { inputTokens: 100000, outputTokens: 50000 } },
    ] as unknown as Parameters<typeof ledgerCostUsd>[0];
    expect(ledgerCostUsd(entries)).toBeGreaterThan(0);
  });
});
