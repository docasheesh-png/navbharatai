/**
 * 🧬 Q-1125 — the behaviour behind the census, exercised rather than read.
 *
 * `aCallOutsideTheLoopIsStillOnTheRecord` reads the SOURCE: it proves no raw text-runner call survives
 * in the build route. That is the census, and it is what catches a new silent site. This file proves the
 * door it funnels them into actually does its job — a row on success, a row on failure, a row when a
 * bound expires, and never a number nothing measured.
 *
 * Both halves are needed. A door that is reached by every caller but records nothing is the same silence
 * with more code in front of it.
 */
import { describe, it, expect } from 'vitest';
import { recordedTextCall } from '../src/server/AgentV3/recordedTextCall';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';
import type { LlmCallRecord } from '../src/server/AgentV3/BuildDiagnostics';

const PARAMS: RunTurnParams = {
  model: 'planned-model-1', system: 'sys', messages: [{ role: 'user', content: 'u' }], tools: [], maxTokens: 10,
};

function turn(over: Partial<TurnResult> = {}): TurnResult {
  return {
    text: 'hello', toolUses: [], stopReason: 'end_turn', rawContent: [],
    usage: { inputTokens: 7, outputTokens: 11 } as TurnResult['usage'],
    ...over,
  };
}

/** A runner that reports a provider (as the real chain does) and then resolves or rejects. */
function stubRunner(
  outcome: { resolve: TurnResult } | { reject: Error } | { hang: true },
  reportAs: string | null = 'KIMI',
): { make: (onUsed: (used: string) => void) => TurnRunner } {
  return {
    make: (onUsed) => ({
      runTurn: (_p: RunTurnParams): Promise<TurnResult> => {
        if (reportAs) onUsed(reportAs);
        if ('hang' in outcome) return new Promise<TurnResult>(() => { /* never settles — the bound must act */ });
        return 'resolve' in outcome ? Promise.resolve(outcome.resolve) : Promise.reject(outcome.reject);
      },
    }),
  };
}

function harness(outcome: Parameters<typeof stubRunner>[0], reportAs: string | null = 'KIMI') {
  const rows: Array<Omit<LlmCallRecord, 'ts'>> = [];
  const runner = stubRunner(outcome, reportAs);
  return {
    rows,
    deps: {
      makeRunner: runner.make,
      // Stands in for `fastLaneCallIdentity`: it must refuse to name anyone when nothing reported.
      identify: (reported: boolean, used: string | undefined, answered?: string | null) =>
        (reported ? { provider: (used ?? '').toLowerCase(), model: answered ?? 'planned-model-1' } : { provider: 'unknown', model: 'unknown' }),
      record: (row: Omit<LlmCallRecord, 'ts'>) => { rows.push(row); },
    },
  };
}

describe('an aux model call leaves a row whatever happens to it', () => {
  it('a success is recorded, with the model that ANSWERED and the chain\'s own times', async () => {
    const h = harness({ resolve: turn({ model: 'kimi-k2.7-code', attemptMs: 340, fallbackMs: 120 }) });
    const t = await recordedTextCall(h.deps, PARAMS, { promptPreview: 'sys\n---\nu' });

    expect(t.text).toBe('hello');
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    expect(row.ok).toBe(true);
    // The answering id, never the planned one and never the family label (answeringModel.ts's whole point).
    expect(row.model).toBe('kimi-k2.7-code');
    expect(row.provider).toBe('kimi');
    expect(row.inputTokens).toBe(7);
    expect(row.outputTokens).toBe(11);
    expect(row.promptChars).toBe('sys\n---\nu'.length);
    expect(row.responseChars).toBe('hello'.length);
    // Measured by the chain, so carried — and bounded by the caller's own wait, as the sink requires.
    expect(row.answerMs).toBe(340);
    expect(row.fallbackMs).toBe(120);
  });

  it('A FAILURE IS A CALL THAT WAS PAID FOR — it is recorded, and the error still propagates', async () => {
    const h = harness({ reject: new Error('provider exploded') });
    await expect(recordedTextCall(h.deps, PARAMS, { promptPreview: 'p' })).rejects.toThrow('provider exploded');

    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    expect(row.ok).toBe(false);
    expect(row.error).toBe('provider exploded');
    // Nothing answered, so nothing is claimed about tokens or the response.
    expect(row.responseChars).toBe(0);
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(0);
    // And NO chain-split time: nothing measured one. This is Q-1011's own defect one level down.
    expect(row.answerMs).toBeUndefined();
    expect(row.fallbackMs).toBeUndefined();
    expect(row.openMs).toBeUndefined();
    expect(row.firstOutputMs).toBeUndefined();
  });

  it('AN EXPIRED BOUND IS NOT A SILENCE — the abandoned call leaves a row saying so', async () => {
    const h = harness({ hang: true });
    await expect(
      recordedTextCall(h.deps, PARAMS, { promptPreview: 'p', timeoutMs: 20, timeoutMessage: 'blueprint step timed out' }),
    ).rejects.toThrow('blueprint step timed out');

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].ok).toBe(false);
    expect(h.rows[0].error).toBe('blueprint step timed out');
    // The bound was still reported by a rung before it hung, so the row may name it.
    expect(h.rows[0].provider).toBe('kimi');
  });

  it('when NO rung ever reported, the row names nobody rather than the default', async () => {
    const h = harness({ reject: new Error('nothing was reachable') }, null);
    await expect(recordedTextCall(h.deps, PARAMS, { promptPreview: 'p' })).rejects.toThrow();
    expect(h.rows[0].provider).toBe('unknown');
    expect(h.rows[0].model).toBe('unknown');
  });

  it('a sink that throws can never break the build', async () => {
    const h = harness({ resolve: turn() });
    const deps = { ...h.deps, record: () => { throw new Error('diagnostics store is full'); } };
    await expect(recordedTextCall(deps, PARAMS, { promptPreview: 'p' })).resolves.toMatchObject({ text: 'hello' });
  });

  it('a call that beats its bound is not recorded twice, and leaves no timer behind', async () => {
    const h = harness({ resolve: turn({ model: 'glm-4.7-flashx' }) });
    const t = await recordedTextCall(h.deps, PARAMS, { promptPreview: 'p', timeoutMs: 5_000 });
    expect(t.model).toBe('glm-4.7-flashx');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].ok).toBe(true);
    // If the 5 s timer were left armed, vitest would hold this file open for its full bound.
  });
});
