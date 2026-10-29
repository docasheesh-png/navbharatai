import { describe, it, expect } from 'vitest';
import { adaptedParamsPreserveContract } from './productionAdapter';

describe('Surplus adapted params (05012 gpt-5.6-sol scope DNA)', () => {
  it('accepts a pure output-cap rename', () => {
    expect(adaptedParamsPreserveContract([])).toBe(true);
    expect(adaptedParamsPreserveContract(['max_tokens'])).toBe(true);
    expect(adaptedParamsPreserveContract(['max_tokens->max_completion_tokens'])).toBe(true);
  });
  it('still fails closed on contract-changing adaptations', () => {
    expect(adaptedParamsPreserveContract(['tools'])).toBe(false);
    expect(adaptedParamsPreserveContract(['max_tokens', 'tool_choice'])).toBe(false);
    expect(adaptedParamsPreserveContract(['provider'])).toBe(false);
    expect(adaptedParamsPreserveContract([42 as unknown as string])).toBe(false);
  });
});
