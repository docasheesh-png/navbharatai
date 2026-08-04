import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { makeMultiProviderTurnRunner, forceModelRunner, pacedRunner, isFatalProviderError, fatalProviderHint, isServiceOverloadedError, createRateLimitCooldowns, sharedRateLimitCooldowns, rateLimitBenchAfter, type NamedRunner } from './MultiProviderTurnRunner';
import { _resetSharedPacers } from '../RateLimitPacer';

// The shared 429-cooldown singleton persists across runner instances BY DESIGN — reset it between
// tests so one test's simulated 429 storm can never bench a provider for an unrelated test.
beforeEach(() => sharedRateLimitCooldowns.reset());
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function ok(text: string, model?: string): TurnResult {
  return { text, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }], ...(model ? { model } : {}) };
}
describe('pacedRunner — proactive pacer decorator (default-off passthrough)', () => {
  const prev = process.env.AGENTV3_RATE_PACER;
  beforeEach(() => { _resetSharedPacers(); });
  afterAll(() => { if (prev === undefined) delete process.env.AGENTV3_RATE_PACER; else process.env.AGENTV3_RATE_PACER = prev; });

  it('is a no-op passthrough when the flag is OFF (returns the same result, same call)', async () => {
    delete process.env.AGENTV3_RATE_PACER;
    const inner = { runTurn: vi.fn().mockResolvedValue(ok('built')) };
    const wrapped = pacedRunner(inner, 'GLM');
    const r = await wrapped.runTurn(PARAMS);
    expect(r.text).toBe('built');
    expect(inner.runTurn).toHaveBeenCalledTimes(1);
  });

  it('paces through the shared pacer when ON, still returning the result unchanged', async () => {
    process.env.AGENTV3_RATE_PACER = 'on';
    const inner = { runTurn: vi.fn().mockResolvedValue(ok('paced')) };
    const wrapped = pacedRunner(inner, 'KIMI');
    const r = await wrapped.runTurn(PARAMS);
    expect(r.text).toBe('paced');
    expect(inner.runTurn).toHaveBeenCalledTimes(1);
  });

  it('re-throws a provider error unchanged when ON (chain backoff/rotation still handles it)', async () => {
    process.env.AGENTV3_RATE_PACER = 'on';
    const inner = { runTurn: vi.fn().mockRejectedValue(new Error('Request timed out.')) };
    await expect(pacedRunner(inner, 'GLM').runTurn(PARAMS)).rejects.toThrow('Request timed out.');
  });
});

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

  it('onTurnComplete forwards the ACTUAL model id (REAL-cost billing needs the exact rung)', async () => {
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: { runTurn: vi.fn().mockResolvedValue(ok('built', 'glm-4.7-flash')) } },
      { name: 'CLAUDE', runner: runnerOk('backstop') },
    ];
    const seen: Array<{ used: string; model?: string; input: number }> = [];
    const runner = makeMultiProviderTurnRunner(chain, {
      onTurnComplete: (used, usage, model) => seen.push({ used, model, input: usage.inputTokens }),
    });
    await runner.runTurn(PARAMS);
    expect(seen).toEqual([{ used: 'GLM', model: 'glm-4.7-flash', input: 1 }]);
  });

  it('key-pool (reportAs) — a benched key fails over to the next key, reported under the base name', async () => {
    // Two GLM keys: key #1 429s, key #2 (distinct bench name 'GLM#2') answers. Both report as 'GLM'.
    const key1 = runnerFail('429 Rate limit reached for requests');
    const key2 = runnerOk('from glm key2');
    const used: string[] = [];
    const errs: string[] = [];
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: key1 },
      { name: 'GLM#2', runner: key2, reportAs: 'GLM' },
      { name: 'CLAUDE', runner: runnerOk('backstop') },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { onProviderUsed: (u) => used.push(u), onProviderError: (n) => errs.push(n) });
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('from glm key2'); // second key carried it, not Claude
    expect(used).toEqual(['GLM']);            // reported as base 'GLM', not 'GLM#2'
    expect(errs).toEqual(['GLM']);            // the failed key #1 also reports as 'GLM'
  });

  it('key-pool — the 429 bench is PER key (name), so one throttled key does not sideline the pool', async () => {
    // key #1 429s twice in a row (would be benched), but key #2 keeps a distinct bench name and answers.
    const key1 = runnerFail('429 Rate limit reached for requests');
    const key2 = runnerOk('key2 ok');
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: key1 },
      { name: 'GLM#2', runner: key2, reportAs: 'GLM' },
    ];
    const runner = makeMultiProviderTurnRunner(chain, {});
    const r1 = await runner.runTurn(PARAMS);
    const r2 = await runner.runTurn(PARAMS);
    expect([r1.text, r2.text]).toEqual(['key2 ok', 'key2 ok']); // key #2 survives both turns
    expect(key2.runTurn).toHaveBeenCalledTimes(2);
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
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/All v5.0 providers failed \(GROK → CLAUDE\).*claude down/);
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

  it('a skip limit of 0 DISABLES the skip — GLM/Kimi lead every prompt, however large (admin 2026-07-11)', async () => {
    const { sizeGatedRunner } = await import('./MultiProviderTurnRunner');
    const inner = runnerOk('from glm');
    const gated = sizeGatedRunner(inner, 0); // 0 = no size skip
    const huge = { ...PARAMS, system: 'x'.repeat(500_000) };
    // The inner cheap runner IS called (no reject) even for a 500k-char prompt; the prompt diet still trims.
    expect((await gated.runTurn(huge)).text).toBe('from glm');
    expect(inner.runTurn).toHaveBeenCalledOnce();
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

  it('classifies a 429 as a rate-limit (but NOT a size-gate skip or a plain error)', async () => {
    const { isRateLimitProviderError } = await import('./MultiProviderTurnRunner');
    expect(isRateLimitProviderError(new Error('429 Rate limit reached'))).toBe(true);
    expect(isRateLimitProviderError(new Error('Too Many Requests'))).toBe(true);
    expect(isRateLimitProviderError(new Error('rate_limit_error'))).toBe(true);
    expect(isRateLimitProviderError(new Error('skipped: prompt 999 chars exceeds the cheap-floor limit 100 (routed to the next provider)'))).toBe(false);
    expect(isRateLimitProviderError(new Error('some other 500 error'))).toBe(false);
  });

  it('2 CONSECUTIVE 429s bench a provider for the rest of the run (no 429 storm); a success resets the streak', async () => {
    const { makeMultiProviderTurnRunner: make } = await import('./MultiProviderTurnRunner');
    const glm = runnerFail('429 Rate limit reached');
    const runner = make([{ name: 'GLM', runner: glm }, { name: 'CLAUDE', runner: runnerOk('from claude') }]);
    await runner.runTurn(PARAMS); // 429 #1
    await runner.runTurn(PARAMS); // 429 #2 → benched
    await runner.runTurn(PARAMS); // benched — GLM NOT called a third time (the storm is stopped)
    expect(glm.runTurn).toHaveBeenCalledTimes(2);

    // A provider that recovers (one success) has its 429 streak reset — it leads again next turn.
    const flaky = { runTurn: vi.fn() };
    flaky.runTurn
      .mockRejectedValueOnce(new Error('429 Rate limit reached'))
      .mockResolvedValueOnce({ text: 'recovered', usage: { inputTokens: 1, outputTokens: 1 } })
      .mockRejectedValueOnce(new Error('429 Rate limit reached'))
      .mockResolvedValue({ text: 'recovered again', usage: { inputTokens: 1, outputTokens: 1 } });
    const r2 = make([{ name: 'KIMI', runner: flaky as never }, { name: 'CLAUDE', runner: runnerOk('from claude') }]);
    await r2.runTurn(PARAMS); // 429 #1 → falls to Claude
    expect((await r2.runTurn(PARAMS)).text).toBe('recovered'); // success resets the streak
    await r2.runTurn(PARAMS); // 429 #1 again (streak was reset) → falls to Claude, NOT benched
    expect((await r2.runTurn(PARAMS)).text).toBe('recovered again'); // still reachable — proves reset
    expect(flaky.runTurn).toHaveBeenCalledTimes(4);
  });

  // === SHARED 429 COOLDOWN (StudySync autopsy 2026-07-16) ==========================================
  // 172 GLM failures in ONE build despite the per-instance bench: every call site builds its own
  // runner (each re-learns from zero) and the fast lane fires 8 concurrent turns (all start before
  // any streak hits 2). The shared registry is the cross-instance memory; these tests lock it.

  it('SHARED COOLDOWN — a 429-benched provider is skipped by a DIFFERENT runner instance (cross-instance memory)', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    let t = 1_000_000;
    const now = () => t;
    const glm1 = runnerFail('429 Rate limit reached');
    const r1 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm1 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r1.runTurn(PARAMS); // 429 #1
    await r1.runTurn(PARAMS); // 429 #2 → shared cooldown armed
    // A brand-new instance (a heal gate / judge / next fast-lane call) — the pre-fix bug re-learned from zero.
    const glm2 = runnerFail('429 Rate limit reached');
    const r2 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm2 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    const res = await r2.runTurn(PARAMS);
    expect(res.text).toBe('c');
    expect(glm2.runTurn).not.toHaveBeenCalled(); // skipped instantly — no re-hammering the saturated provider
  });

  it('BENCH-AFTER-1 (LearnLoop 429-storm fix) — a SINGLE 429 arms the shared cooldown so the storm can never form', async () => {
    // The default production benchAfter is now 1: one throttle benches the name process-wide, instead of
    // the old 2 that a concurrent-turn burst stampedes past. Cross-instance skip after just ONE 429.
    const cooldowns = createRateLimitCooldowns(60_000, 1);
    let t = 1_000_000;
    const now = () => t;
    const glm1 = runnerFail('429 Rate limit reached');
    const r1 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm1 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r1.runTurn(PARAMS); // 429 #1 → cooldown armed IMMEDIATELY (was: needs a 2nd)
    const glm2 = runnerFail('429 Rate limit reached');
    const r2 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm2 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    const res = await r2.runTurn(PARAMS);
    expect(res.text).toBe('c');
    expect(glm2.runTurn).not.toHaveBeenCalled(); // benched after the FIRST 429 — no storm
  });

  it('rateLimitBenchAfter — env parsing: default 1, honors a valid override, floors garbage to 1', () => {
    const saved = process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER;
    try {
      delete process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER;
      expect(rateLimitBenchAfter()).toBe(1);           // default = arm on first throttle
      process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER = '2';
      expect(rateLimitBenchAfter()).toBe(2);           // admin can restore the old behavior
      process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER = '3';
      expect(rateLimitBenchAfter()).toBe(3);
      process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER = 'abc';
      expect(rateLimitBenchAfter()).toBe(1);           // garbage → safe default
      process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER = '0';
      expect(rateLimitBenchAfter()).toBe(1);           // < 1 is meaningless → default
    } finally {
      if (saved === undefined) delete process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER;
      else process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER = saved;
    }
  });

  it('SHARED COOLDOWN — expires: the provider is tried again after the window (softer than the run-long bench)', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    let t = 1_000_000;
    const now = () => t;
    const glm = { runTurn: vi.fn() };
    glm.runTurn
      .mockRejectedValueOnce(new Error('429 Rate limit reached'))
      .mockRejectedValueOnce(new Error('429 Rate limit reached'))
      .mockResolvedValue({ text: 'glm recovered', usage: { inputTokens: 1, outputTokens: 1 } });
    // Two instances so the per-instance run-long bench (which never expires) doesn't mask the cooldown expiry.
    const r1 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm as never }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r1.runTurn(PARAMS); // 429 #1
    await r1.runTurn(PARAMS); // 429 #2 → cooldown until t+60s
    const r2 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm as never }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    expect((await r2.runTurn(PARAMS)).text).toBe('c'); // still cooling — skipped
    t += 61_000; // the window passes — GLM deserves another chance
    expect((await r2.runTurn(PARAMS)).text).toBe('glm recovered');
    expect(cooldowns.until('GLM')).toBe(0); // success cleared the shared state for everyone
  });

  // === ESCALATING RE-PROBE BENCH (restaurant-build autopsy 2026-07-21) ============================
  // 32 GLM 429s in one 27-min build DESPITE the shared cooldown: the bench was FIXED 60s, so an
  // all-build-long saturated provider was re-probed (and 429'd) roughly once a minute — a steady drip
  // the 8-in-120s breaker never sees. Each failed re-probe must DOUBLE the bench (capped), and a
  // success must reset it to the base window.

  it('ESCALATING BENCH — each failed re-probe doubles the window (60s → 120s → 240s), capped', () => {
    const c = createRateLimitCooldowns(60_000, 1, {}, 600_000);
    let t = 1_000_000;
    c.strike('GLM', t);
    expect(c.until('GLM')).toBe(t + 60_000);        // episode 1 — base window
    t += 61_000; c.strike('GLM', t);                 // re-probe after expiry fails again
    expect(c.until('GLM')).toBe(t + 120_000);       // episode 2 — doubled
    t += 121_000; c.strike('GLM', t);
    expect(c.until('GLM')).toBe(t + 240_000);       // episode 3 — doubled again
    t += 241_000; c.strike('GLM', t);
    expect(c.until('GLM')).toBe(t + 480_000);       // episode 4
    t += 481_000; c.strike('GLM', t);
    expect(c.until('GLM')).toBe(t + 600_000);       // episode 5 — capped at cooldownMaxMs, never beyond
  });

  it('ESCALATING BENCH — concurrent stragglers inside an active bench do NOT escalate (one burst = one episode)', () => {
    const c = createRateLimitCooldowns(60_000, 1, {}, 600_000);
    const t = 1_000_000;
    c.strike('GLM', t);                              // the fast lane's 8 concurrent turns all 429 together
    for (let i = 1; i <= 7; i++) c.strike('GLM', t + i);
    expect(c.until('GLM')).toBe(t + 60_000);        // still the base window — the burst is ONE episode
    c.strike('GLM', t + 61_000);                     // the first genuine re-probe failure after expiry
    expect(c.until('GLM')).toBe(t + 61_000 + 120_000); // only now does it double
  });

  it('ESCALATING BENCH — a success resets the escalation to the base window', () => {
    const c = createRateLimitCooldowns(60_000, 1, {}, 600_000);
    let t = 1_000_000;
    c.strike('GLM', t); t += 61_000;
    c.strike('GLM', t); t += 121_000;                // two episodes → next would be 240s
    c.clear('GLM');                                  // the provider answered — recovered
    c.strike('GLM', t);
    expect(c.until('GLM')).toBe(t + 60_000);        // fresh start at the base window
  });

  it('SHARED COOLDOWN — per bench NAME: one throttled key does not cool the rest of the pool', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const key1 = runnerFail('429 Rate limit reached');
    const key2 = runnerOk('from key2');
    const r = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: key1, reportAs: 'GLM' }, { name: 'GLM#2', runner: key2, reportAs: 'GLM' }, { name: 'CLAUDE', runner: runnerOk('c') }],
      { cooldowns, now },
    );
    await r.runTurn(PARAMS);
    await r.runTurn(PARAMS);
    expect(cooldowns.until('GLM')).toBeGreaterThan(0); // key 1 cooling
    expect(cooldowns.until('GLM#2')).toBe(0); // key 2 untouched — the pool keeps serving
    expect((await r.runTurn(PARAMS)).text).toBe('from key2');
  });

  it('SHARED COOLDOWN — disabled (cooldownMs 0) never arms: prior behavior byte-for-byte', async () => {
    const cooldowns = createRateLimitCooldowns(0, 2);
    const now = () => 1_000_000;
    const glm = runnerFail('429 Rate limit reached');
    const r1 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r1.runTurn(PARAMS);
    await r1.runTurn(PARAMS);
    expect(cooldowns.until('GLM')).toBe(0); // strike counted but no cooldown ever arms
    // A second instance still tries GLM — exactly the pre-fix behavior when the feature is off.
    const glm2 = runnerFail('429 Rate limit reached');
    const r2 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm2 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r2.runTurn(PARAMS);
    expect(glm2.runTurn).toHaveBeenCalledTimes(1);
  });

  it('SHARED COOLDOWN — a non-429 failure never strikes the shared registry (timeouts/5xx unaffected)', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const glm = runnerFail('500 internal server error');
    const r = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r.runTurn(PARAMS);
    await r.runTurn(PARAMS);
    await r.runTurn(PARAMS);
    expect(cooldowns.until('GLM')).toBe(0);
    expect(glm.runTurn).toHaveBeenCalledTimes(3); // ordinary fallthrough each turn, no cooldown
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

// === CIRCUIT BREAKER (CollabDesk/PaisaTrack GLM-storm autopsy 2026-07-19) =============================
// The short 60s cooldown RE-PROBES a saturated provider every minute → 79 GLM 429s in one build. The
// breaker tracks the rolling 429 rate and, once tripped, benches the provider for a LONG window (no
// per-minute re-probe) so the whole build leads with the next provider.
describe('circuit breaker — a sustained 429 rate benches the provider for a LONG window (not re-probed)', () => {
  it('trips after breakerTripAfter strikes in the window and stays benched past the short cooldown', () => {
    let t = 1_000_000;
    // trip after 3 strikes in 120s; short cooldown 60s; breaker 300s.
    const cd = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 3, breakerWindowMs: 120_000, breakerMs: 300_000 });
    cd.strike('GLM', t); // #1 → short cooldown t+60s
    cd.strike('GLM', t); // #2
    cd.strike('GLM', t); // #3 → breaker trips → t+300s
    // At t+61s the SHORT cooldown has expired, but the breaker keeps GLM benched.
    expect(cd.until('GLM')).toBe(t + 300_000);
    // A single success clears the short cooldown but NOT the breaker (proven-saturated stays benched).
    cd.clear('GLM');
    expect(cd.until('GLM')).toBe(t + 300_000);
  });

  it('does NOT trip when strikes are spread OUTSIDE the rolling window (a healthy provider with rare 429s)', () => {
    const cd = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 3, breakerWindowMs: 120_000, breakerMs: 300_000 });
    cd.strike('GLM', 1_000_000);          // 1 strike
    cd.strike('GLM', 1_000_000 + 200_000); // +200s (window is 120s → the first aged out)
    cd.strike('GLM', 1_000_000 + 400_000); // +400s
    // Only ever 1 strike inside any 120s window → breaker never trips (only the short cooldown, which
    // a later success would clear). The last strike's short cooldown is the only bench.
    expect(cd.until('GLM')).toBe(1_000_000 + 400_000 + 60_000);
  });

  it('is disabled when breakerTripAfter is 0 (existing 2-arg behaviour is byte-for-byte unchanged)', () => {
    const cd = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    for (let i = 0; i < 20; i++) cd.strike('GLM', 1_000_000);
    expect(cd.until('GLM')).toBe(1_000_000 + 60_000); // only the short cooldown, never a long breaker
  });

  // ESCALATING BENCH (MediConnect autopsy): each repeat trip benches GLM 2× longer, capped — so a
  // persistently-throttled provider stops being re-probed instead of re-storming 67 times over 31 min.
  it('escalates the bench on repeat trips (300s → 600s → 1200s), capped at breakerMaxMs', () => {
    const cd = createRateLimitCooldowns(60_000, 1, {
      breakerTripAfter: 3, breakerWindowMs: 120_000, breakerMs: 300_000,
      breakerMaxMs: 1_000_000, breakerEscalationWindowMs: 1_800_000,
    });
    // Trip #1 at t0 → base bench 300s.
    let t = 1_000_000;
    cd.strike('GLM', t); cd.strike('GLM', t); cd.strike('GLM', t);
    expect(cd.until('GLM')).toBe(t + 300_000);
    // After the bench expires the provider is probed again and re-storms → Trip #2 → 600s.
    t = t + 300_000 + 1;
    cd.strike('GLM', t); cd.strike('GLM', t); cd.strike('GLM', t);
    expect(cd.until('GLM')).toBe(t + 600_000);
    // Trip #3 → 1200s, but the cap (1_000_000ms) applies.
    t = t + 600_000 + 1;
    cd.strike('GLM', t); cd.strike('GLM', t); cd.strike('GLM', t);
    expect(cd.until('GLM')).toBe(t + 1_000_000); // 1200s wanted, capped at 1000s
  });

  it('a lone trip does NOT escalate (no breakerMaxMs → fixed bench, existing behaviour preserved)', () => {
    const cd = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 3, breakerWindowMs: 120_000, breakerMs: 300_000 });
    let t = 1_000_000;
    cd.strike('GLM', t); cd.strike('GLM', t); cd.strike('GLM', t);      // trip #1 → 300s
    t = t + 300_001;
    cd.strike('GLM', t); cd.strike('GLM', t); cd.strike('GLM', t);      // trip #2 → still 300s (no escalation)
    expect(cd.until('GLM')).toBe(t + 300_000);
  });

  it('circuitBreakerConfig — escalation defaults ON (cap 30min); tunable via env', async () => {
    const { circuitBreakerConfig } = await import('./MultiProviderTurnRunner');
    expect(circuitBreakerConfig({} as NodeJS.ProcessEnv).breakerMaxMs).toBe(1_800_000);
    expect(circuitBreakerConfig({ AGENTV3_CIRCUIT_BREAKER_MAX_MS: '600000' } as unknown as NodeJS.ProcessEnv).breakerMaxMs).toBe(600_000);
  });

  it('circuitBreakerConfig — default ON (trip 8); AGENTV3_CIRCUIT_BREAKER=off disables', async () => {
    const { circuitBreakerConfig } = await import('./MultiProviderTurnRunner');
    expect(circuitBreakerConfig({} as NodeJS.ProcessEnv).breakerTripAfter).toBe(8);
    expect(circuitBreakerConfig({ AGENTV3_CIRCUIT_BREAKER: 'off' } as unknown as NodeJS.ProcessEnv).breakerTripAfter).toBe(0);
    expect(circuitBreakerConfig({ AGENTV3_CIRCUIT_BREAKER_TRIP: '5' } as unknown as NodeJS.ProcessEnv).breakerTripAfter).toBe(5);
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
  it('SHARED COOLDOWN — TIMEOUTS strike it too (TaskFlow autopsy: 212 GLM timeouts in one build)', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const glm1 = runnerFail('Request timed out.');
    const r1 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm1 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r1.runTurn(PARAMS); // timeout #1
    await r1.runTurn(PARAMS); // timeout #2 → shared cooldown armed
    expect(cooldowns.until('GLM')).toBeGreaterThan(0);
    // A FRESH instance (heal gate / next fast-lane call) skips GLM instantly — no more timeout burns.
    const glm2 = runnerFail('Request timed out.');
    const r2 = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm2 }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    expect((await r2.runTurn(PARAMS)).text).toBe('c');
    expect(glm2.runTurn).not.toHaveBeenCalled();
  });
});

// POOL COOLDOWN (quiz-app autopsy 2026-07-17): the real build burned 76s/68s/50s turns because each
// GLM KEY had to earn its own strikes while the SERVICE itself was saturated ("429 The service may be
// temporarily overloaded" + timeouts across different keys). Service-level failures now strike a
// shared `pool:<base>` cooldown so 2 of them — across ANY keys — bench the whole pool at once. A
// per-key quota 429 must NEVER pool-strike (rotation to the next key genuinely helps there).
describe('POOL cooldown — service saturation benches the whole key pool', () => {
  it('classifies service-overloaded vs per-key quota errors', () => {
    expect(isServiceOverloadedError(new Error('429 The service may be temporarily overloaded, please try again later'))).toBe(true);
    expect(isServiceOverloadedError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isServiceOverloadedError(new Error('overloaded_error'))).toBe(true);
    expect(isServiceOverloadedError(new Error('429 Rate limit reached for requests'))).toBe(false);
    expect(isServiceOverloadedError(new Error('500 internal server error'))).toBe(false);
  });

  it('2 timeouts across DIFFERENT keys bench the pool — the next instance skips every key instantly', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const chain1: NamedRunner[] = [
      { name: 'GLM', runner: runnerFail('Request timed out.') },
      { name: 'GLM#2', runner: runnerFail('Request timed out.'), reportAs: 'GLM' },
      { name: 'CLAUDE', runner: runnerOk('backstop') },
    ];
    const r1 = makeMultiProviderTurnRunner(chain1, { cooldowns, now });
    expect((await r1.runTurn(PARAMS)).text).toBe('backstop'); // key1 + key2 each timeout once → 2 POOL strikes
    expect(cooldowns.until('pool:GLM')).toBeGreaterThan(now());
    // A FRESH instance (fresh per-instance streaks — the real heal-gate/fast-lane pattern): with only
    // per-key strikes each key would burn ANOTHER full timeout window; the pool bench skips them all.
    const key1b = runnerFail('Request timed out.');
    const key2b = runnerFail('Request timed out.');
    const r2 = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: key1b }, { name: 'GLM#2', runner: key2b, reportAs: 'GLM' }, { name: 'CLAUDE', runner: runnerOk('backstop') }],
      { cooldowns, now },
    );
    expect((await r2.runTurn(PARAMS)).text).toBe('backstop');
    expect(key1b.runTurn).not.toHaveBeenCalled();
    expect(key2b.runTurn).not.toHaveBeenCalled();
  });

  it('the REAL quiz-app "service may be temporarily overloaded" 429 pool-strikes like a timeout', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: runnerFail('429 The service may be temporarily overloaded, please try again later') },
      { name: 'GLM#2', runner: runnerFail('429 The service may be temporarily overloaded, please try again later'), reportAs: 'GLM' },
      { name: 'CLAUDE', runner: runnerOk('backstop') },
    ];
    await makeMultiProviderTurnRunner(chain, { cooldowns, now }).runTurn(PARAMS);
    expect(cooldowns.until('pool:GLM')).toBeGreaterThan(now());
  });

  it('a per-key QUOTA 429 never benches the pool — sibling keys keep serving', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const r = makeMultiProviderTurnRunner(
      [
        { name: 'GLM', runner: runnerFail('429 Rate limit reached for requests') },
        { name: 'GLM#2', runner: runnerOk('from key2'), reportAs: 'GLM' },
        { name: 'CLAUDE', runner: runnerOk('backstop') },
      ],
      { cooldowns, now },
    );
    expect((await r.runTurn(PARAMS)).text).toBe('from key2');
    expect((await r.runTurn(PARAMS)).text).toBe('from key2');
    expect(cooldowns.until('pool:GLM')).toBe(0); // quota 429s never pool-strike
  });

  it('a pool-member SUCCESS after the bench expires clears the pool for everyone', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    let t = 1_000_000;
    const now = () => t;
    cooldowns.strike('pool:GLM', t);
    cooldowns.strike('pool:GLM', t); // pool benched
    expect(cooldowns.until('pool:GLM')).toBeGreaterThan(t);
    t += 61_000; // bench expired — the pool is probed again
    const r = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: runnerOk('recovered') }, { name: 'GLM#2', runner: runnerOk('x'), reportAs: 'GLM' }, { name: 'CLAUDE', runner: runnerOk('c') }],
      { cooldowns, now },
    );
    expect((await r.runTurn(PARAMS)).text).toBe('recovered');
    expect(cooldowns.until('pool:GLM')).toBe(0); // service recovered → pool fully cleared
  });

  it('a SINGLE-key provider never creates pool state (non-pool behavior byte-for-byte)', async () => {
    const cooldowns = createRateLimitCooldowns(60_000, 2);
    const now = () => 1_000_000;
    const glm = runnerFail('Request timed out.');
    const r = makeMultiProviderTurnRunner([{ name: 'GLM', runner: glm }, { name: 'CLAUDE', runner: runnerOk('c') }], { cooldowns, now });
    await r.runTurn(PARAMS);
    await r.runTurn(PARAMS);
    expect(cooldowns.until('GLM')).toBeGreaterThan(0); // per-key shared cooldown — unchanged
    expect(cooldowns.until('pool:GLM')).toBe(0); // no pool entry for a 1-key provider
  });
});
