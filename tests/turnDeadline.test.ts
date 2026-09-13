import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  turnDeadline,
  deadlineFromBudget,
  MIN_USEFUL_CALL_MS,
  BUDGET_EXHAUSTED_MESSAGE,
  BUDGET_REACHED_MESSAGE,
} from '../src/server/AgentV3/turnDeadline';
import { isTimeoutProviderError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';

/**
 * THE REPORT (admin, 2026-09-13). The fast lane capped its plan call at 90 s. The Kimi rung's own
 * client timeout was 120 s. `withTimeout` only RACES — it stops the WAIT, not the CALL — so the
 * abandoned request kept running and that build logged provider events **148 seconds after it had
 * ended**, on a sandbox still being billed by the minute.
 *
 * Neither number was wrong. They answered different questions, in different files, months apart, and
 * nothing existed to carry the first answer to the second. This file pins the contract that does.
 */

const NOW = 1_000_000;

describe('no deadline is byte-identical to the behaviour that existed before this module', () => {
  it('returns the configured bound untouched', () => {
    expect(turnDeadline(120_000, undefined, NOW)).toEqual({ timeoutMs: 120_000, expired: false, source: 'configured' });
  });

  it('treats every unmeasurable deadline as absent, never as expired', () => {
    /**
     * THE LINE THAT KEEPS THIS SAFE, and the same rule `oneShotStillViable` follows: a caller that
     * did not measure has proven nothing. Reading an unknown as "no time left" would silently refuse
     * calls that work today — an outage built out of caution.
     */
    for (const bad of [undefined, null, NaN, 0, -1, Infinity, -Infinity, '90000' as unknown as number, {} as unknown as number]) {
      expect(turnDeadline(120_000, bad as number | null | undefined, NOW), String(bad))
        .toEqual({ timeoutMs: 120_000, expired: false, source: 'configured' });
    }
  });

  it('an unbounded runner with no deadline stays unbounded', () => {
    expect(turnDeadline(0, undefined, NOW)).toEqual({ timeoutMs: 0, expired: false, source: 'none' });
  });
});

describe('a deadline can only ever SHORTEN a call', () => {
  it('the report\'s exact case: a 90 s lane must not start a 120 s call', () => {
    const decision = turnDeadline(120_000, NOW + 90_000, NOW);
    expect(decision.timeoutMs).toBe(90_000);
    expect(decision.source).toBe('deadline');
  });

  it('a deadline LONGER than the runner\'s own bound never extends it', () => {
    // The provider's own limit is a judgement about that provider. A caller with time to spare does
    // not get to override it — this direction is exactly how a "budget" becomes a way to hang a build.
    const decision = turnDeadline(60_000, NOW + 600_000, NOW);
    expect(decision.timeoutMs).toBe(60_000);
    expect(decision.source).toBe('configured');
  });

  it('property: the answer never exceeds the configured bound, for any deadline', () => {
    for (let remaining = -5_000; remaining <= 300_000; remaining += 997) {
      const d = turnDeadline(120_000, NOW + remaining, NOW);
      expect(d.timeoutMs).toBeLessThanOrEqual(120_000);
      if (!d.expired) expect(d.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('bounds a runner that had NO bound of its own — the one case it shortens from infinite', () => {
    expect(turnDeadline(0, NOW + 30_000, NOW)).toEqual({ timeoutMs: 30_000, expired: false, source: 'deadline' });
  });
});

describe('an exhausted budget refuses BEFORE spending, which is the 148 seconds', () => {
  it('expires once less than a useful call\'s worth of clock remains', () => {
    expect(turnDeadline(120_000, NOW + MIN_USEFUL_CALL_MS - 1, NOW).expired).toBe(true);
    expect(turnDeadline(120_000, NOW + MIN_USEFUL_CALL_MS, NOW).expired).toBe(false);
  });

  it('a deadline already in the past expires', () => {
    expect(turnDeadline(120_000, NOW - 60_000, NOW).expired).toBe(true);
  });

  it('an expired decision reports NO bound rather than a zero that reads as "unbounded"', () => {
    // 0 means "no limit" everywhere else in this codebase, so an expired decision must be read
    // through `expired` and never through its timeout — callers check the flag first.
    const d = turnDeadline(120_000, NOW - 1, NOW);
    expect(d.expired).toBe(true);
    expect(d.timeoutMs).toBe(0);
  });
});

describe('🔴 it must not blame the provider for our own clock', () => {
  it('neither budget message is read as a provider timeout', () => {
    /**
     * `isTimeoutProviderError` benches a rung after two consecutive timeouts. A provider handed eight
     * seconds because the LANE had eight seconds left has not failed at anything, and benching it
     * would punish it for our budgeting — then the NEXT build starts a rung down for no reason.
     */
    expect(isTimeoutProviderError(new Error(BUDGET_EXHAUSTED_MESSAGE))).toBe(false);
    expect(isTimeoutProviderError(new Error(BUDGET_REACHED_MESSAGE))).toBe(false);
  });

  it('a REAL provider timeout is still benched — the guard above must not have disarmed it', () => {
    expect(isTimeoutProviderError(new Error('OpenAI-compatible call (GLM/Kimi) timed out after 60000ms'))).toBe(true);
    expect(isTimeoutProviderError(new Error('Request timed out.'))).toBe(true);
  });

  it('`source` is what decides the wording, and it is only "deadline" when OUR clock won', () => {
    expect(turnDeadline(120_000, NOW + 30_000, NOW).source).toBe('deadline');   // ours ran out first
    expect(turnDeadline(30_000, NOW + 120_000, NOW).source).toBe('configured'); // theirs did
  });
});

describe('deadlineFromBudget — "we did not measure" and "no time left" stay different facts', () => {
  it('turns a remaining budget into the absolute instant every hop can read', () => {
    expect(deadlineFromBudget(90_000, NOW)).toBe(NOW + 90_000);
  });

  it('returns undefined rather than an instant already in the past', () => {
    for (const bad of [undefined, null, NaN, 0, -1]) {
      expect(deadlineFromBudget(bad as number | null | undefined, NOW), String(bad)).toBeUndefined();
    }
  });
});

describe('WIRING — a contract nothing calls is a comment', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('every leaf runner that bounds itself also honours the caller\'s budget', () => {
    // Rule 3: the same root cause lives in every family that sets its own timeout, so all of them are
    // fixed together. A new provider family added without this line is the way the bug comes back.
    for (const f of [
      'src/server/AgentV3/providers/OpenAiToolRunner.ts',
      'src/server/AgentV3/providers/GeminiToolRunner.ts',
      'src/server/AgentV3/ClaudeClient.ts',
    ]) {
      const src = read(f);
      expect(src, f).toContain('turnDeadline(');
      expect(src, f).toContain('BUDGET_EXHAUSTED_MESSAGE');
    }
  });

  it('the GLM/Kimi family — the one in the report — words the overrun by WHOSE clock ran out', () => {
    const src = read('src/server/AgentV3/providers/OpenAiToolRunner.ts');
    expect(src).toContain("bound.source === 'deadline'");
    expect(src).toContain('BUDGET_REACHED_MESSAGE');
  });

  it('the Claude RETRY ladder faces the deadline too, not just the opening call', () => {
    // A retry is a new call carrying the full 120 s bound. Bounding only the first one leaves the
    // expensive half of this family unbounded.
    const src = read('src/server/AgentV3/ClaudeClient.ts');
    expect(src).toContain('createWithRetry(createParams, params.deadlineAt)');
    expect(src).toContain('if (turnDeadline(llmRequestTimeoutMs(), deadlineAt).expired) throw err;');
  });

  it('the fast lane hands its OWN cap down — the exact inversion the report found', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(src).toContain('{ deadlineAt: deadlineFromBudget(planCap, laneStartedAt) }');
    expect(src).toContain('{ deadlineAt: deadlineFromBudget(contractCap) }');
  });

  it('the route forwards it, and a CONTINUATION carries it too', () => {
    const src = read('src/server/routes/agentv3.ts');
    expect(src).toContain('fastGenerateOnce(system, continuationPrompt(text), genOpts?.deadlineAt)');
    expect(src).toMatch(/deadlineAt,/);
  });
});

describe('BEHAVIOUR — the runner really refuses, not just the helper', () => {
  it('GLM/Kimi: an exhausted budget never reaches the provider at all', async () => {
    const { OpenAiToolRunner } = await import('../src/server/AgentV3/providers/OpenAiToolRunner');
    let called = 0;
    const client = { chat: { completions: { create: async () => { called += 1; return {} as never; } } } };
    const runner = new OpenAiToolRunner(client as never, { model: 'glm-5.2', timeoutMs: 60_000 });
    await expect(runner.runTurn({
      model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], deadlineAt: Date.now() - 1,
    })).rejects.toThrow(BUDGET_EXHAUSTED_MESSAGE);
    // THE WHOLE POINT: not "it failed fast" — it never spent anything. The report's 148 seconds were
    // calls that had already lost their reader and were started anyway.
    expect(called).toBe(0);
  });

  it('GLM/Kimi: with budget to spare it calls the provider exactly as before', async () => {
    const { OpenAiToolRunner } = await import('../src/server/AgentV3/providers/OpenAiToolRunner');
    let called = 0;
    const client = { chat: { completions: { create: async () => { called += 1; return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } as never; } } } };
    const runner = new OpenAiToolRunner(client as never, { model: 'glm-5.2', timeoutMs: 60_000 });
    const out = await runner.runTurn({
      model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], deadlineAt: Date.now() + 60_000,
    });
    expect(called).toBe(1);
    expect(out.text).toBe('ok');
  });

  it('GLM/Kimi: NO deadline behaves exactly as it did before this contract existed', async () => {
    const { OpenAiToolRunner } = await import('../src/server/AgentV3/providers/OpenAiToolRunner');
    let called = 0;
    const client = { chat: { completions: { create: async () => { called += 1; return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } as never; } } } };
    const runner = new OpenAiToolRunner(client as never, { model: 'glm-5.2', timeoutMs: 60_000 });
    await runner.runTurn({ model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] });
    expect(called).toBe(1);
  });

  it('Gemini/Vertex: the sibling family refuses on the same terms', async () => {
    const { GeminiToolRunner } = await import('../src/server/AgentV3/providers/GeminiToolRunner');
    let called = 0;
    const client = { models: { generateContent: async () => { called += 1; return {} as never; } } };
    const runner = new GeminiToolRunner(client as never, { model: 'gemini-2.5-flash', timeoutMs: 120_000 });
    await expect(runner.runTurn({
      model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }], deadlineAt: Date.now() - 1,
    })).rejects.toThrow(BUDGET_EXHAUSTED_MESSAGE);
    expect(called).toBe(0);
  });

  it('an overrun bounded by OUR clock is worded so the provider is not benched for it', async () => {
    const { OpenAiToolRunner } = await import('../src/server/AgentV3/providers/OpenAiToolRunner');
    // A call that never settles, with 300 ms of budget left: our clock is what ends it.
    const client = { chat: { completions: { create: () => new Promise<never>(() => {}) } } };
    const runner = new OpenAiToolRunner(client as never, { model: 'glm-5.2', timeoutMs: 60_000 });
    const err = await runner.runTurn({
      model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], deadlineAt: Date.now() + 300,
    }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toBe(BUDGET_REACHED_MESSAGE);
    expect(isTimeoutProviderError(err)).toBe(false);
  });
});
