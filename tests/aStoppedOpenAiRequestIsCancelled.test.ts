import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAiToolRunner, _resetThinkingParamMemo, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { isBuildStoppedError } from '../src/server/AgentV3/stopSignal';
import { BUDGET_REACHED_MESSAGE } from '../src/server/AgentV3/turnDeadline';

const params = { model: 'glm-5.3-flash', messages: [], tools: [], thinking: false };
const answer = () => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
}), { headers: { 'content-type': 'application/json' } });

// Exercise the real SDK's cancellation path with an injected fetch; no network or key is used.
function queuedProvider(rejectThinking = false) {
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  let requestSignal: AbortSignal | null | undefined;
  let release!: (response: Response) => void;
  let fetches = 0;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
    fetches++;
    if (rejectThinking && fetches === 1) return new Response(JSON.stringify({ error: { message: 'Invalid value for thinking.type' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    requestSignal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      release = resolve;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      began();
    });
  });
  const sdk = new OpenAI({ apiKey: 'test-only', baseURL: 'https://unused.invalid', maxRetries: 0, timeout: 60_000, fetch });
  const runner = new OpenAiToolRunner(sdk as unknown as OpenAiChatClient, { model: params.model, timeoutMs: 1_000, thinkingControl: true });
  return { runner, started, fetch, signal: () => requestSignal, release: () => release(answer()) };
}

describe('a stopped OpenAI-compatible turn cancels its queued HTTP request', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetThinkingParamMemo();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    _resetThinkingParamMemo();
  });

  it.each(['off', 'on'])('cancels the SDK before a response opens (streaming %s)', async (streaming) => {
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', streaming);
    const provider = queuedProvider();
    const stop = new AbortController();
    const ended = provider.runner.runTurn({ ...params, signal: stop.signal }).catch((error) => error);
    await provider.started;
    stop.abort();
    try {
      expect(isBuildStoppedError(await ended)).toBe(true);
      expect(provider.signal()?.aborted).toBe(true);
      expect(provider.fetch).toHaveBeenCalledTimes(1);
    } finally { provider.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('cancels the SDK when the runner timeout ends its queued request', async () => {
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
    const provider = queuedProvider();
    const ended = provider.runner.runTurn(params).catch((error) => error);
    await provider.started;
    await vi.advanceTimersByTimeAsync(1_000);
    try {
      expect((await ended).message).toMatch(/timed out/);
      expect(provider.signal()?.aborted).toBe(true);
    } finally { provider.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('also cancels the live optional-thinking-field retry', async () => {
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
    const provider = queuedProvider(true);
    const stop = new AbortController();
    const ended = provider.runner.runTurn({ ...params, signal: stop.signal }).catch((error) => error);
    await provider.started;
    stop.abort();
    try {
      expect(isBuildStoppedError(await ended)).toBe(true);
      expect(provider.signal()?.aborted).toBe(true);
      expect(provider.fetch).toHaveBeenCalledTimes(2);
    } finally { provider.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('cancels on the caller deadline while preserving budget attribution', async () => {
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
    const provider = queuedProvider();
    const ended = provider.runner.runTurn({ ...params, deadlineAt: Date.now() + 500 }).catch((error) => error);
    await provider.started;
    await vi.advanceTimersByTimeAsync(500);
    try {
      expect((await ended).message).toBe(BUDGET_REACHED_MESSAGE);
      expect(provider.signal()?.aborted).toBe(true);
    } finally { provider.release(); await vi.advanceTimersByTimeAsync(0); }
  });
});
