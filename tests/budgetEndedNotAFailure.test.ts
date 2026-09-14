/**
 * A CALL WE STOPPED IS NOT A CALL THAT FAILED — build report 70115adf (2026-09-13).
 *
 * What that build did: the fast lane handed off at 90s, the full builder finished the app, the
 * production build SUCCEEDED and a preview snapshot was saved. The user was then told their app
 * "is NOT ready to use yet", and the report carried **153 `Provider GLM failed` entries for a
 * provider that was never called**.
 *
 * One cause behind both. The abandoned lane's plan call outlived its lane by 18 seconds and threw
 * `build budget exhausted before this call could start`. Nothing in the stack recognised that string,
 * so it was handled as an ordinary provider failure: the chain walked every remaining rung (the
 * refusal is thrown before any network call, so 153 of them took milliseconds), and the resulting
 * unresolved ERROR became the release gate's "1 build-breaking blocker".
 *
 * These tests pin the three facts that stop it recurring.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isBudgetEndedError, BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE,
} from '../src/server/AgentV3/turnDeadline';
import { isTimeoutProviderError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('isBudgetEndedError — it recognises our own clock', () => {
  it('matches both messages the deadline module throws', () => {
    expect(isBudgetEndedError(new Error(BUDGET_EXHAUSTED_MESSAGE))).toBe(true);
    expect(isBudgetEndedError(new Error(BUDGET_REACHED_MESSAGE))).toBe(true);
  });

  it('matches when the message is wrapped by a caller, which is how it really arrives', () => {
    expect(isBudgetEndedError(new Error(`Kimi call aborted: ${BUDGET_REACHED_MESSAGE}`))).toBe(true);
    expect(isBudgetEndedError(BUDGET_EXHAUSTED_MESSAGE)).toBe(true);
  });

  it('does not match an ordinary provider failure', () => {
    for (const m of ['503 service unavailable', 'rate limit reached', 'socket hang up', 'timed out after 120000ms']) {
      expect(isBudgetEndedError(new Error(m))).toBe(false);
    }
    expect(isBudgetEndedError(null)).toBe(false);
    expect(isBudgetEndedError(undefined)).toBe(false);
    expect(isBudgetEndedError({})).toBe(false);
  });

  it('🔒 and is still NOT a provider timeout — the guard #2894 added must keep holding', () => {
    // If this ever flips, a provider gets benched for our clock running out, which is the original bug.
    expect(isTimeoutProviderError(new Error(BUDGET_EXHAUSTED_MESSAGE))).toBe(false);
    expect(isTimeoutProviderError(new Error(BUDGET_REACHED_MESSAGE))).toBe(false);
  });
});

describe('the report stops accusing a provider and stops blocking the app', () => {
  function diag(): BuildDiagnostics {
    return new BuildDiagnostics({ buildId: 'b1', workspaceId: 'w1', sessionId: 's1', prompt: 'p', startedAt: 1 });
  }

  it('🔴 a budget-ended call is NOT a shipping blocker — the RED gate this produced', () => {
    const d = diag();
    d.recordLlmCall({
      ts: 2, model: 'claude-sonnet-4-6', provider: 'anthropic', ok: false,
      error: `All NavBharatAI Pro providers failed. Last error: ${BUDGET_EXHAUSTED_MESSAGE}`,
      promptChars: 1, responseChars: 0, toolCalls: 0, latencyMs: 108132,
    } as never);
    // `blockers` in the release gate is exactly this number.
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('an ordinary failed call IS still a blocker — the fix must not blind the gate', () => {
    const d = diag();
    d.recordLlmCall({
      ts: 2, model: 'kimi-k2.6', provider: 'moonshot', ok: false,
      error: '500 internal server error',
      promptChars: 1, responseChars: 0, toolCalls: 0, latencyMs: 900,
    } as never);
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('the stopped call is still ON the timeline, and says what really happened', () => {
    const d = diag();
    d.recordLlmCall({
      ts: 2, model: 'kimi-k2.6', ok: false, error: BUDGET_REACHED_MESSAGE,
      promptChars: 1, responseChars: 0, toolCalls: 0, latencyMs: 5,
    } as never);
    const codes = d.report().issues.map((i) => i.code);
    expect(codes).toContain('LLM_CALL_BUDGET_ENDED');
    expect(codes).not.toContain('LLM_CALL_FAILED');
    const issue = d.report().issues.find((i) => i.code === 'LLM_CALL_BUDGET_ENDED')!;
    expect(issue.message).toMatch(/time budget ended, not because it failed/);
    expect(issue.autoResolved).toBe(true);
  });

  it('a TRUNCATED response is untouched by this branch', () => {
    const d = diag();
    d.recordLlmCall({
      ts: 2, model: 'kimi-k2.6', ok: true, finishReason: 'max_tokens',
      promptChars: 1, responseChars: 10, toolCalls: 0, latencyMs: 5,
    } as never);
    expect(d.report().issues.map((i) => i.code)).toContain('LLM_TRUNCATED');
  });
});

describe('the chain stops walking rungs it cannot use', () => {
  it('🔴 aborts on the FIRST budget refusal instead of trying every remaining provider', async () => {
    const { makeMultiProviderTurnRunner } = await import('../src/server/AgentV3/providers/MultiProviderTurnRunner');
    const attempts: string[] = [];
    const rung = (name: string) => ({
      name,
      runner: {
        runTurn: vi.fn(async () => {
          attempts.push(name);
          throw new Error(BUDGET_EXHAUSTED_MESSAGE);
        }),
      },
    });
    // A pool the size of the one in the report, so a regression is unmissable.
    const chain = [rung('KIMI'), ...Array.from({ length: 153 }, (_, i) => rung(`GLM#${i}`))];
    const runner = makeMultiProviderTurnRunner(
      chain.map((c) => ({ name: c.name, runner: c.runner as never })) as never,
      {} as never,
    );
    await expect(runner.runTurn({} as never)).rejects.toThrow(/time budget ended/);
    // Exactly ONE provider was asked. The report's 153 were all after the budget was already gone.
    expect(attempts).toEqual(['KIMI']);
  });

  it('the message names OUR budget, never "all providers failed"', async () => {
    const { makeMultiProviderTurnRunner } = await import('../src/server/AgentV3/providers/MultiProviderTurnRunner');
    const runner = makeMultiProviderTurnRunner(
      [{ name: 'KIMI', runner: { runTurn: async () => { throw new Error(BUDGET_REACHED_MESSAGE); } } }] as never,
      {} as never,
    );
    await expect(runner.runTurn({} as never)).rejects.toThrow(/No provider failed/);
  });

  it('an ordinary failure still walks the chain to the backstop', async () => {
    const { makeMultiProviderTurnRunner } = await import('../src/server/AgentV3/providers/MultiProviderTurnRunner');
    const seen: string[] = [];
    const runner = makeMultiProviderTurnRunner(
      [
        { name: 'KIMI', runner: { runTurn: async () => { seen.push('KIMI'); throw new Error('500 boom'); } } },
        { name: 'GLM', runner: { runTurn: async () => { seen.push('GLM'); return { text: 'ok' } as never; } } },
      ] as never,
      {} as never,
    );
    await runner.runTurn({} as never);
    expect(seen).toEqual(['KIMI', 'GLM']);
  });
});
