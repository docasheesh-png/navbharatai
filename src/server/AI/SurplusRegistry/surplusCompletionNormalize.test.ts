import { describe, it, expect } from 'vitest';
import { canonicalSurplusModel, normalizeSurplusCompletion, surplusIdentityMismatch } from './productionAdapter';

describe('Surplus reasoning-model completion normalization (05015 z Hello DNA)', () => {
  it('maps dated / vendor-prefixed ids to the reviewed model, never a different one', () => {
    expect(canonicalSurplusModel('gpt-5.6-sol-2026-10-01')).toBe('gpt-5.6-sol');
    expect(canonicalSurplusModel('openai/gpt-5.6-sol')).toBe('gpt-5.6-sol');
    const c = normalizeSurplusCompletion({ model: 'gpt-5.6-sol-20261001', choices: [{ message: { role: 'assistant', content: 'simple' }, finish_reason: 'stop' }] } as never, 'gpt-5.6-sol');
    expect(c.model).toBe('gpt-5.6-sol');
    const other = normalizeSurplusCompletion({ model: 'gpt-4o', choices: [] } as never, 'gpt-5.6-sol');
    expect(other.model).toBe('gpt-4o');
  });
  it('joins text parts and fills missing finish_reason only when an answer exists', () => {
    const c = normalizeSurplusCompletion({ model: 'gpt-5.6-sol', choices: [{ message: { role: 'assistant', content: [{ type: 'output_text', text: 'sim' }, { type: 'output_text', text: 'ple' }] }, finish_reason: null }] } as never, 'gpt-5.6-sol');
    expect(c.choices[0].message.content).toBe('simple');
    expect(c.choices[0].finish_reason).toBe('stop');
    const empty = normalizeSurplusCompletion({ model: 'gpt-5.6-sol', choices: [{ message: { role: 'assistant', content: '' }, finish_reason: null }] } as never, 'gpt-5.6-sol');
    expect(empty.choices[0].finish_reason).toBeNull();
  });
  it('names the failing identity check', () => {
    const wire = { status: 200, headers: {}, body: {}, receivedAt: 1 };
    expect(surplusIdentityMismatch(wire, { choices: [], model: 'm' }, { truncated: false, provider: 'p', served_by: 'direct', adapted_params: [] })).toBe('served_by');
    expect(surplusIdentityMismatch(wire, { choices: [], model: 'm' }, { truncated: false, provider: 'p', served_by: 'marketplace', adapted_params: ['max_tokens'] })).toBe('');
  });
});
