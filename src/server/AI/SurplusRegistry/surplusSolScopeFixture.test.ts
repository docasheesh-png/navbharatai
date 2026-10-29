import { describe, it, expect } from 'vitest';
import { createProductionSurplusAdapter } from './productionAdapter';

// Live-shaped gpt-5.6-sol scope replies (OpenAI direct via Surplus marketplace, thinking repaired).
const sol = (headers: Record<string, string>, body: Record<string, unknown>) => ({ status: 200, receivedAt: Date.now(),
  headers: { 'x-si-provider-family': 'openai', 'x-si-served-by': 'marketplace', 'x-si-route-objective': 'price', ...headers }, body });
const reply = { id: 'chatcmpl-1', model: 'gpt-5.6-sol-2026-10-01', usage: { prompt_tokens: 900, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 0 } },
  choices: [{ index: 0, message: { role: 'assistant', content: [{ type: 'text', text: '{"fitsWeak":true}' }] }, finish_reason: null }] };

describe('gpt-5.6-sol scope fixtures through the real adapter identify()', () => {
  const adapter = createProductionSurplusAdapter({} as NodeJS.ProcessEnv);
  it('accepts reasoning repairs header + dated id + text parts', () => {
    const r = adapter.identify(sol({ 'x-si-adapted-params': 'max_tokens,reasoning_effort,include_reasoning,temperature' }, structuredClone(reply)), 'gpt-5.6-sol');
    expect(r.model).toBe('gpt-5.6-sol');
    expect(r.completion.choices?.[0]?.message?.content).toBe('{"fitsWeak":true}');
    expect(r.completion.choices?.[0]?.finish_reason).toBe('stop');
  });
  it('accepts long-request body telemetry with reasoning adaptations', () => {
    const body = { ...structuredClone(reply), surplus: { provider: 'openai', served_by: 'marketplace', route_objective: 'price', adapted_params: ['max_tokens', 'reasoning_effort'], truncated: false } };
    expect(() => adapter.identify(sol({}, body), 'gpt-5.6-sol')).not.toThrow();
  });
  it('names the failed field in the raw error (for z@ chat)', () => {
    expect(() => adapter.identify(sol({ 'x-si-adapted-params': 'tools' }, structuredClone(reply)), 'gpt-5.6-sol'))
      .toThrow(/did not match \(adapted_params/);
    expect(() => adapter.identify(sol({ 'x-si-served-by': 'fallback_key' }, structuredClone(reply)), 'gpt-5.6-sol'))
      .toThrow('did not match (served_by)');
  });
});

import { isSurplusReasoningModel } from './buildSession';
describe('scope prefers flash / non-reasoning Surplus models', () => {
  it.each([['gpt-5.6-sol', true], ['openai/gpt-5.6-terra', true], ['o3-mini', true], ['deepseek-v4.1-flash', false], ['qwen3-coder-instruct', false], ['glm-4.6', false]])('%s reasoning=%s', (m, r) => {
    expect(isSurplusReasoningModel(m as string)).toBe(r);
  });
});
