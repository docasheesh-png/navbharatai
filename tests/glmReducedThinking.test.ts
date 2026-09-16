// "CANNOT BE DISABLED" IS NOT "CANNOT BE REDUCED" (autopsy ee20478d, 2026-09-15).
//
// The 400 that produced glmThinking.ts reads in full:
//     "This model always engages in thinking and cannot be disabled; please use low, high, or max"
// The first clause was acted on and the second was not: the fix sent NO thinking field, which selects
// the model's DEFAULT effort — the MOST reasoning, not the least. On glm-5.3-flash that default spent
// the entire 4,833-token ceiling on three consecutive turns and produced no text and no tool call.
//
// These cases pin both halves: that we now ask for the provider's own lowest level, and that a model
// which rejects the field still works — because the level names come from an error message, not from a
// document, and a bet that cannot check itself has no place on the first rung of two ladders.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  glmThinkingParam, glmCanDisableThinking, isThinkingParamRejection, GLM_REDUCED_THINKING,
} from '../src/server/AgentV3/providers/glmThinking';
import {
  OpenAiToolRunner, modelRejectsThinkingParam, _resetThinkingParamMemo,
  type OpenAiChatClient,
} from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';

const reply = (text: string) => ({
  choices: [{ message: { role: 'assistant' as const, content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

function recordingClient(onCall: (p: Record<string, unknown>) => void, fail?: (n: number) => Error | null) {
  let n = 0;
  return {
    calls: [] as Record<string, unknown>[],
    chat: {
      completions: {
        create: async (p: Record<string, unknown>) => {
          n++;
          onCall(p);
          const e = fail?.(n);
          if (e) throw e;
          return reply('done');
        },
      },
    },
  };
}

describe('the ask: the provider’s own lowest level, never silence', () => {
  it('a model that CAN disable thinking still gets `disabled` — nothing regresses', () => {
    expect(glmThinkingParam('glm-4.7', false)).toEqual({ thinking: { type: 'disabled' } });
    expect(glmCanDisableThinking('glm-4.7')).toBe(true);
  });

  it('🔴 a model that CANNOT disable it gets `low`, not an empty object', () => {
    expect(glmThinkingParam('glm-5.3-flash', false)).toEqual({ thinking: { type: 'low' } });
    expect(glmThinkingParam('glm-5.3', false)).toEqual({ thinking: { type: 'low' } });
    expect(GLM_REDUCED_THINKING).toBe('low');
  });

  it('asking FOR thinking is unchanged, and no opinion still sends nothing', () => {
    expect(glmThinkingParam('glm-5.3-flash', true)).toEqual({ thinking: { type: 'enabled' } });
    expect(glmThinkingParam('glm-5.3-flash', undefined)).toEqual({});
    expect(glmThinkingParam('glm-5.3-flash', 'off' as unknown)).toEqual({});
  });

  it('EVERY GLM rung of every ladder now receives a reduced level rather than silence', () => {
    // Read from the table itself, so a ladder edited later is covered without anyone remembering.
    const glmRungs = Object.values(TIER_LADDERS).flatMap((l) => l.filter((r) => r.provider === 'GLM'));
    expect(glmRungs.length).toBeGreaterThan(0);
    for (const rung of glmRungs) {
      expect(glmThinkingParam(rung.model, false), rung.model).not.toEqual({});
    }
  });
});

describe('isThinkingParamRejection — narrow on purpose', () => {
  it('matches the shapes a rejected enum value actually takes', () => {
    expect(isThinkingParamRejection(new Error('400 Invalid value for thinking.type'))).toBe(true);
    expect(isThinkingParamRejection('Unsupported parameter: thinking')).toBe(true);
    expect(isThinkingParamRejection('reasoning_effort must be one of: low, high, max')).toBe(true);
  });

  it('🔒 does NOT match an unrelated bad request — a retry there would be a loop around a real failure', () => {
    expect(isThinkingParamRejection(new Error('400 tool schema is invalid'))).toBe(false);
    expect(isThinkingParamRejection(new Error('429 rate limit reached'))).toBe(false);
    expect(isThinkingParamRejection(new Error('prompt is too long'))).toBe(false);
    expect(isThinkingParamRejection(new Error('timed out after 150000ms'))).toBe(false);
    expect(isThinkingParamRejection(null)).toBe(false);
    // The word alone is not a rejection — a model that merely mentions thinking in prose must not
    // cost us a retry.
    expect(isThinkingParamRejection(new Error('the model is thinking'))).toBe(false);
  });
});

describe('🔒 the bet checks itself — a wrong guess costs one round-trip, never a build', () => {
  beforeEach(() => { _resetThinkingParamMemo(); });

  it('sends `low` on the first call', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = recordingClient((p) => seen.push(p));
    const runner = new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model: 'glm-5.3-flash', thinkingControl: true });
    await runner.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never);
    expect(seen[0].thinking).toEqual({ type: 'low' });
  });

  it('a REJECTION drops the field and retries the same call once — the turn still succeeds', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = recordingClient(
      (p) => seen.push(p),
      (n) => (n === 1 ? new Error('400 Invalid value for thinking.type') : null),
    );
    const runner = new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model: 'glm-5.3-flash', thinkingControl: true });
    const out = await runner.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never);
    expect(out.text).toBe('done');                 // the build is not harmed
    expect(seen).toHaveLength(2);
    expect(seen[0].thinking).toEqual({ type: 'low' });
    expect('thinking' in seen[1]).toBe(false);     // the retry carries no field at all
    expect(seen[1].max_tokens).toBe(seen[0].max_tokens); // and is otherwise the SAME request
  });

  it('the rejection is remembered, so the wasted round-trip is paid once per model, not per call', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = recordingClient(
      (p) => seen.push(p),
      (n) => (n === 1 ? new Error('400 Unsupported parameter: thinking') : null),
    );
    const opts = { model: 'glm-5.3-flash', thinkingControl: true };
    const runner = new OpenAiToolRunner(client as unknown as OpenAiChatClient, opts);
    await runner.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never);
    expect(modelRejectsThinkingParam('glm-5.3-flash')).toBe(true);
    // A brand-new runner (the real shape — one per rung per build) must inherit what was learned.
    const second = new OpenAiToolRunner(client as unknown as OpenAiChatClient, opts);
    await second.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never);
    expect(seen).toHaveLength(3);                  // 2 for the first turn, ONE for the second
    expect('thinking' in seen[2]).toBe(false);
  });

  it('🔒 an UNRELATED error is never retried — it propagates so the ladder can move on', async () => {
    let n = 0;
    const client = recordingClient(() => { n++; }, () => new Error('429 rate limit reached'));
    const runner = new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model: 'glm-5.3-flash', thinkingControl: true });
    await expect(runner.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never)).rejects.toThrow(/429/);
    expect(n).toBe(1);
    expect(modelRejectsThinkingParam('glm-5.3-flash')).toBe(false);
  });

  it('a runner with no thinkingControl sends no field and is never retried', async () => {
    let n = 0;
    const client = recordingClient(() => { n++; }, (c) => (c === 1 ? new Error('400 Invalid value for thinking.type') : null));
    const runner = new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model: 'grok-4' });
    await expect(runner.runTurn({ messages: [], tools: [], model: 'x', thinking: false } as never)).rejects.toThrow(/400/);
    expect(n).toBe(1); // no retry — we never sent the field, so dropping it cannot help
  });
});
