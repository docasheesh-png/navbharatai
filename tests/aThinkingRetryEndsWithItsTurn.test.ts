import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAiToolRunner, _resetThinkingParamMemo, type OpenAiChatClient,
} from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { isBuildStoppedError } from '../src/server/AgentV3/stopSignal';
import { BUDGET_EXHAUSTED_MESSAGE } from '../src/server/AgentV3/turnDeadline';

const rejection = () => new Error('400 Invalid value for thinking.type');
const response = {
  choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

function delayedRejection() {
  let rejectFirst!: (error: Error) => void;
  const create = vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValue(response);
  const client = { chat: { completions: { create } } } as OpenAiChatClient;
  const runner = new OpenAiToolRunner(client, { model: 'glm-5.3-flash', thinkingControl: true, timeoutMs: 1_000 });
  return { runner, create, rejectFirst: (error: Error) => rejectFirst(error) };
}

const params = { model: 'glm-5.3-flash', messages: [], tools: [], thinking: false };

describe('a thinking-parameter retry belongs to the turn that requested it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
    _resetThinkingParamMemo();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    _resetThinkingParamMemo();
  });

  it('never starts another provider request after Stop ended the waiting turn', async () => {
    const { runner, create, rejectFirst } = delayedRejection();
    const stop = new AbortController();
    const ended = runner.runTurn({ ...params, signal: stop.signal }).catch((error) => error);
    stop.abort();
    expect(isBuildStoppedError(await ended)).toBe(true);
    rejectFirst(rejection());
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never starts another request after the provider wait timed out', async () => {
    const { runner, create, rejectFirst } = delayedRejection();
    const ended = runner.runTurn(params).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await ended).message).toMatch(/timed out/);
    rejectFirst(rejection());
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rechecks whether the caller still has enough budget before retrying', async () => {
    const { runner, create, rejectFirst } = delayedRejection();
    const ended = runner.runTurn({ ...params, deadlineAt: Date.now() + 1_000 }).catch((error) => error);
    // The first request returned a 400 with too little time left for a useful second call.
    vi.setSystemTime(10_900);
    rejectFirst(rejection());
    expect((await ended).message).toBe(BUDGET_EXHAUSTED_MESSAGE);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('still drops the rejected field and retries once while the turn is live', async () => {
    const { runner, create, rejectFirst } = delayedRejection();
    const done = runner.runTurn(params);
    rejectFirst(rejection());
    expect((await done).text).toBe('done');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].thinking).toEqual({ type: 'low' });
    expect(create.mock.calls[1][0]).not.toHaveProperty('thinking');
  });
});
