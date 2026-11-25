/**
 * 🔎 A SURPLUS REFUSAL SAYS WHICH REFUSAL (failedbr BR2514–BR2519 + the admin's test-bot screenshot, 2026-11-25).
 *
 * The admin's Test Chat Bot got a good answer from Surplus on deepseek-v4.1-flash, through the SAME min90 endpoint that
 * answered every BUILD turn with HTTP 404 — and in those builds the small admission call on qwen3-coder succeeded while the
 * 120k–240k-character build turn on the same qwen3-coder 404'd. So the refusal depends on the REQUEST, not on the account
 * or the model. Surplus documents its 404s by code (no_sellers_for_model, minimum_discount_not_met); the code was computed
 * for the server log only, and the report said "HTTP 404". Now the report carries the engine's own code.
 */
import { describe, expect, it } from 'vitest';
import { engineCodeOf } from '../src/server/AgentV3/providers/SurplusTurnRunner';
import { describeSurplusAttemptFailure } from '../src/server/AI/SurplusRegistry/buildSession';

describe('the engine\'s own code is read from the refusal — never its prose', () => {
  it('body.error.code', () => {
    expect(engineCodeOf({ status: 404, body: { error: { code: 'no_sellers_for_model', message: 'No seller can serve…' } } })).toBe('no_sellers_for_model');
  });
  it('body.data.error.code (the other spelling the adapter reads)', () => {
    expect(engineCodeOf({ status: 404, body: { data: { error: { code: 'minimum_discount_not_met' } } } })).toBe('minimum_discount_not_met');
  });
  it('falls back to error.type; prose, URLs and long text are never taken', () => {
    expect(engineCodeOf({ body: { error: { type: 'invalid_request_error' } } })).toBe('invalid_request_error');
    expect(engineCodeOf({ body: { error: { code: 'see https://x.example/why for details' } } })).toBeUndefined();
    expect(engineCodeOf({ body: {} })).toBeUndefined();
    expect(engineCodeOf(null)).toBeUndefined();
  });
});

describe('🔴 the report line names it', () => {
  it('"the engine refused the request, HTTP 404 (code no_sellers_for_model)"', () => {
    expect(describeSurplusAttemptFailure({ model: 'qwen3-coder', stage: 'response_validation', reason: 'invalid_completion', attempt: 1, httpStatus: 404, engineCode: 'no_sellers_for_model', benched: true, nextModel: 'deepseek-v4.1-flash' }))
      .toContain('the engine refused the request, HTTP 404 (code no_sellers_for_model)');
  });
  it('🔁 without the code (the old record) the line is exactly as it was', () => {
    expect(describeSurplusAttemptFailure({ model: 'qwen3-coder', stage: 'response_validation', reason: 'invalid_completion', attempt: 1, httpStatus: 404, benched: true }))
      .toBe('Surplus attempt 1 on qwen3-coder failed (response_validation: the engine refused the request, HTTP 404) — qwen3-coder is benched for this build');
  });
});
