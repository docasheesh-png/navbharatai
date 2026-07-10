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

  it('Billing Phase 3 — onTurnComplete reports the winning provider AND its real token usage', async () => {
    const glm = { runTurn: vi.fn().mockResolvedValue({ ...ok('built'), usage: { inputTokens: 800, outputTokens: 140, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } }) };
    const seen: Array<{ p: string; usage: { inputTokens: number; outputTokens: number } }> = [];
    const chain: NamedRunner[] = [{ name: 'GLM', runner: glm }];
    const runner = makeMultiProviderTurnRunner(chain, { onTurnComplete: (p, usage) => seen.push({ p, usage }) });
    await runner.runTurn(PARAMS);
    expect(seen).toEqual([{ p: 'GLM', usage: { inputTokens: 800, outputTokens: 140 } }]);
  });

  it('Billing Phase 3 — onTurnComplete fires for the provider that ACTUALLY answered after a fallback', async () => {
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: runnerFail('overloaded') },
      { name: 'CLAUDE', runner: runnerOk('from claude') },
    ];
    const seen: string[] = [];
    const runner = makeMultiProviderTurnRunner(chain, { onTurnComplete: (p) => seen.push(p) });
    await runner.runTurn(PARAMS);
    expect(seen).toEqual(['CLAUDE']); // never GLM (it threw)
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

describe('cheap-floor combined design (admin 2026-07-07): size gate + prompt diet + timeout bench', () => {
  it('a turn over the size limit SKIPS the cheap runner instantly (falls through, inner never called)', async () => {
    const { sizeGatedRunner, estimatePromptChars } = await import('./MultiProviderTurnRunner');
    const inner = runnerOk('from glm');
    const gated = sizeGatedRunner(inner, 100);
    const big = { ...PARAMS, system: 'x'.repeat(200) };
    expect(estimatePromptChars(big)).toBeGreaterThan(100);
    await expect(gated.runTurn(big)).rejects.toThrow(/skipped: prompt .* exceeds the cheap-floor limit/);
    expect(inner.runTurn).not.toHaveBeenCalled();
    // Small turns pass through untouched.
    expect((await gated.runTurn(PARAMS)).text).toBe('from glm');
  });

  it('prompt diet: oversized tool_result/text blocks are trimmed with an honest marker; structure preserved', async () => {
    const { capMessageContentForCheapFloor } = await import('./MultiProviderTurnRunner');
    const fat = 'y'.repeat(10_000);
    const capped = capMessageContentForCheapFloor({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: fat }, { type: 'text', text: 'small' }] },
      ],
    } as never, 6_000);
    const blocks = (capped.messages[0] as { content: Array<{ content?: string; text?: string }> }).content;
    expect(blocks).toHaveLength(2); // no block dropped — tool pairing intact
    expect(blocks[0].content!.length).toBeLessThan(7_000);
    expect(blocks[0].content).toContain('chars trimmed for the fast model');
    expect(blocks[1].text).toBe('small'); // small blocks untouched
  });

  it('2 CONSECUTIVE timeouts bench a provider for the rest of the run; a success resets the streak', async () => {
    const { makeMultiProviderTurnRunner: make } = await import('./MultiProviderTurnRunner');
    const glm = runnerFail('Request timed out.');
    const backstop = runnerOk('from claude');
    const runner = make([{ name: 'GLM', runner: glm }, { name: 'CLAUDE', runner: backstop }]);
    await runner.runTurn(PARAMS); // timeout 1
    await runner.runTurn(PARAMS); // timeout 2 → benched
    await runner.runTurn(PARAMS); // benched — GLM not called
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
  });

  it('a size-gate skip does NOT count toward the timeout bench (skips are free, not failures)', async () => {
    const { makeMultiProviderTurnRunner: make, sizeGatedRunner: gate, isTimeoutProviderError } = await import('./MultiProviderTurnRunner');
    expect(isTimeoutProviderError(new Error('skipped: prompt 999 chars exceeds the cheap-floor limit 100 (routed to the next provider)'))).toBe(false);
    const inner = runnerOk('from glm');
    const runner = make([{ name: 'GLM', runner: gate(inner, 100) }, { name: 'CLAUDE', runner: runnerOk('from claude') }]);
    const big = { ...PARAMS, system: 'x'.repeat(200) };
    await runner.runTurn(big); // skip
    await runner.runTurn(big); // skip
    expect((await runner.runTurn(PARAMS)).text).toBe('from glm'); // small turn still reaches GLM — not benched
  });
});

describe('hopelessly-oversized prompts abort the ladder (the 2.2M-token reviewer case, 2026-07-07)', () => {
  it('classifies the real errors: >1M tokens = hopeless; a merely-large prompt still falls through', async () => {
    const { isHopelesslyOversizedError } = await import('./MultiProviderTurnRunner');
    expect(isHopelesslyOversizedError(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 2204128 tokens > 1000000 maximum"}}'))).toBe(true);
    expect(isHopelesslyOversizedError(new Error('The input token count (1885546) exceeds the maximum number of tokens allowed (1048576).'))).toBe(true);
    // 209k > Haiku's 200k but far under the 1M fleet max — a bigger-window provider might fit it.
    expect(isHopelesslyOversizedError(new Error('prompt is too long: 209130 tokens > 200000 maximum'))).toBe(false);
    expect(isHopelesslyOversizedError(new Error('529 overloaded_error'))).toBe(false);
  });

  it('aborts the chain on the FIRST hopeless error instead of replaying the doomed request downward', async () => {
    const { makeMultiProviderTurnRunner: make } = await import('./MultiProviderTurnRunner');
    const claude = runnerFail('prompt is too long: 2204128 tokens > 1000000 maximum');
    const haiku = runnerOk('never reached');
    const runner = make([{ name: 'CLAUDE', runner: claude }, { name: 'CLAUDE_HAIKU', runner: haiku }]);
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/too large for every AI provider/);
    expect(haiku.runTurn).not.toHaveBeenCalled(); // the 3 wasted round-trips are gone
  });
});
