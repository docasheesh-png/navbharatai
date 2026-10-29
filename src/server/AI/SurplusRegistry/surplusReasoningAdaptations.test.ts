import { describe, it, expect } from 'vitest';
import { adaptedParamsPreserveContract, surplusIdentityMismatch } from './productionAdapter';

// DNA (live z scope): gpt-5.6-sol replies carried X-SI-Adapted-Params naming reasoning-wire repairs.
describe('Surplus reasoning-model adaptations keep the contract', () => {
  const wire = (h: Record<string, string>) => ({ status: 200, receivedAt: 1, body: {}, headers: { 'x-si-provider-family': 'openai', 'x-si-served-by': 'marketplace', ...h } });
  const tel = (adapted: string[]) => ({ truncated: false, provider: 'openai', served_by: 'marketplace', adapted_params: adapted, conflicts: false });
  const body = { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], model: 'gpt-5.6-sol' };

  it.each([
    'max_tokens,reasoning_effort',
    'reasoning_effort,include_reasoning',
    'max_tokens,temperature,top_p,parallel_tool_calls',
    'prompt_cache_key,stream_options',
    'reasoning.effort',
  ])('accepts %s (scope reply passes identity)', header => {
    const list = header.split(',');
    expect(adaptedParamsPreserveContract(list)).toBe(true);
    expect(surplusIdentityMismatch(wire({ 'x-si-adapted-params': header }), body, tel(list))).toBe('');
  });

  it.each(['tools', 'tool_choice', 'model', 'provider', 'messages', 'si_route'])('still rejects contract change %s', p => {
    expect(adaptedParamsPreserveContract([p])).toBe(false);
    expect(surplusIdentityMismatch(wire({ 'x-si-adapted-params': p }), body, tel([p]))).not.toBe('');
  });
});
