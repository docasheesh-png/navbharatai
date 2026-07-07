import { describe, it, expect, vi } from 'vitest';
import { makeMultiProviderTurnRunner, forceModelRunner, isFatalProviderError, fatalProviderHint, type NamedRunner } from './MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function ok(text: string): TurnResult {
  return { text, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }] };
}
function runnerOk(text: string): TurnRunner {
  return { runTurn: vi.fn().mockResolvedValue(ok(text)) };
}
function runnerFail(msg: string): TurnRunner {
  return { runTurn: vi.fn().mockRejectedValue(new Error(msg)) };
}

describe('makeMultiProviderTurnRunner', () => {
  it('uses the first (cheapest) provider when it succeeds and does not call the rest', async () => {
    const grok = runnerOk('from grok');
    const claude = runnerOk('from claude');
    const used: string[] = [];
    const chain: NamedRunner[] = [
      { name: 'GROK', runner: grok },
      { name: 'CLAUDE', runner: claude },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { onProviderUsed: (u) => used.push(u) });
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('from grok');
    expect(used).toEqual(['GROK']);
    expect(claude.runTurn).not.toHaveBeenCalled();
  });

  it('falls through to the Claude backstop when cheaper providers throw', async () => {
    const vertex = runnerFail('vertex 500');
    const grok = runnerFail('grok 429');
    const claude = runnerOk('claude saved it');
    const fellBack: string[][] = [];
    const errors: string[] = [];
    const runner = makeMultiProviderTurnRunner(
      [
        { name: 'VERTEX', runner: vertex },
        { name: 'GROK', runner: grok },
        { name: 'CLAUDE', runner: claude },
      ],
      { onProviderUsed: (_u, fb) => fellBack.push(fb), onProviderError: (n) => errors.push(n) },
    );
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('claude saved it');
    expect(errors).toEqual(['VERTEX', 'GROK']);
    expect(fellBack).toEqual([['VERTEX', 'GROK']]);
  });

  it('throws an aggregated error only when EVERY provider (incl. backstop) fails', async () => {
    const runner = makeMultiProviderTurnRunner([
      { name: 'GROK', runner: runnerFail('grok down') },
      { name: 'CLAUDE', runner: runnerFail('claude down') },
    ]);
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/All v3.0 providers failed \(GROK → CLAUDE\).*claude down/);
  });

  it('works with a single backstop runner', async () => {
    const runner = makeMultiProviderTurnRunner([{ name: 'CLAUDE', runner: runnerOk('solo') }]);
    expect((await runner.runTurn(PARAMS)).text).toBe('solo');
  });

  it('throws if constructed with an empty chain', () => {
    expect(() => makeMultiProviderTurnRunner([])).toThrow(/at least one runner/);
  });
});

const CREDIT_ERR = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

describe('fatal provider errors — billing/auth failures are never re-ground (build report 2026-07-07)', () => {
  it('classifies the real credit-balance 400 and auth/permission/key errors as FATAL', () => {
    expect(isFatalProviderError(new Error(CREDIT_ERR))).toBe(true);
    expect(isFatalProviderError(new Error('authentication_error: invalid x-api-key'))).toBe(true);
    expect(isFatalProviderError(new Error('permission_error: model not allowed'))).toBe(true);
    expect(isFatalProviderError(new Error('account suspended'))).toBe(true);
  });

  it('keeps transient failures retryable (overload / rate limit / timeout / 5xx are NOT fatal)', () => {
    for (const msg of ['529 overloaded_error', '429 rate_limit_error', 'Request timed out.', '500 internal server error', 'ECONNRESET']) {
      expect(isFatalProviderError(new Error(msg))).toBe(false);
    }
  });

  it('a provider that fails FATALLY is skipped on every later turn of the same run (no re-grind)', async () => {
    // The report's build re-hit the same credit error after grinding the ladder for 8+ minutes.
    const glm = runnerOk('from glm');
    const claude = runnerFail(CREDIT_ERR);
    const chain: NamedRunner[] = [{ name: 'CLAUDE', runner: claude }, { name: 'GLM', runner: glm }];
    const runner = makeMultiProviderTurnRunner(chain);
    expect((await runner.runTurn(PARAMS)).text).toBe('from glm'); // turn 1: CLAUDE fatal → GLM carries
    expect((await runner.runTurn(PARAMS)).text).toBe('from glm'); // turn 2: CLAUDE skipped cold
    expect(claude.runTurn).toHaveBeenCalledTimes(1); // never retried after the fatal error
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
  });

  it('a TRANSIENT failure is retried on the next turn (behaviour unchanged)', async () => {
    const flaky = runnerFail('529 overloaded_error');
    const backstop = runnerOk('from backstop');
    const runner = makeMultiProviderTurnRunner([{ name: 'GLM', runner: flaky }, { name: 'CLAUDE', runner: backstop }]);
    await runner.runTurn(PARAMS);
    await runner.runTurn(PARAMS);
    expect(flaky.runTurn).toHaveBeenCalledTimes(2); // still tried each turn — transient ≠ dead
  });

  it('when EVERY provider is known-fatal, later turns fail INSTANTLY with the honest platform hint', async () => {
    const claude = runnerFail(CREDIT_ERR);
    const haiku = runnerFail(CREDIT_ERR);
    const runner = makeMultiProviderTurnRunner([{ name: 'CLAUDE', runner: claude }, { name: 'CLAUDE_HAIKU', runner: haiku }]);
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/credit balance/i);           // turn 1: real calls
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/known-fatal|PLATFORM ISSUE/); // turn 2: instant
    expect(claude.runTurn).toHaveBeenCalledTimes(1);
    expect(haiku.runTurn).toHaveBeenCalledTimes(1); // neither re-called on turn 2
  });

  it('the final error names the platform problem in plain words (honesty to the user)', async () => {
    const runner = makeMultiProviderTurnRunner([{ name: 'CLAUDE', runner: runnerFail(CREDIT_ERR) }]);
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/PLATFORM ISSUE.*out of credits/i);
    expect(fatalProviderHint('blah credit balance is too low blah')).toMatch(/Plans & Billing/);
    expect(fatalProviderHint('529 overloaded')).toBe(''); // transient failures get no platform blame
  });
});

describe('forceModelRunner (P7 — fixed-model Haiku backstop)', () => {
  it('overrides params.model with the forced model, leaving other params intact', async () => {
    const captured: RunTurnParams[] = [];
    const inner: TurnRunner = { runTurn: vi.fn(async (p: RunTurnParams) => { captured.push(p); return ok('haiku reply'); }) };
    const forced = forceModelRunner(inner, 'claude-haiku-4-5');
    const res = await forced.runTurn(PARAMS); // PARAMS.model === 'm'
    expect(res.text).toBe('haiku reply');
    expect(captured[0].model).toBe('claude-haiku-4-5'); // forced, not 'm'
    expect(captured[0].messages).toBe(PARAMS.messages); // everything else passed through
  });

  it('serves as a working final backstop when the primary Claude model fails', async () => {
    // Vertex + Gemini + primary Claude all throw; the forced-Haiku backstop completes the turn.
    const haikuInner: TurnRunner = { runTurn: vi.fn(async (p: RunTurnParams) => ok(`done on ${p.model}`)) };
    const chain: NamedRunner[] = [
      { name: 'GEMINI', runner: runnerFail('gemini down') },
      { name: 'CLAUDE', runner: runnerFail('sonnet overloaded') },
      { name: 'CLAUDE_HAIKU', runner: forceModelRunner(haikuInner, 'claude-haiku-4-5') },
    ];
    const runner = makeMultiProviderTurnRunner(chain);
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('done on claude-haiku-4-5'); // backstop ran on the forced model
  });
});
