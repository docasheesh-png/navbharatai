/**
 * A RUNG THAT ONLY THINKS MUST BEGIN ITS ANSWER WITHIN ITS OWN BOUND (autopsy 15e69839, 2026-10-12).
 *
 * The app had rendered at 299 s. The next KIMI call then streamed REASONING for over three minutes and began no
 * answer: reasoning resets the 60 s silence clock and satisfies the crawl floor, so the only bound left was the
 * 300 s stream ceiling. The user watched "still working" and pressed Stop. And had they waited, the ceiling would
 * have been reported as "build budget reached" — which ends the whole chain with "no provider failed" instead of
 * trying the next rung. Both are locked here, through the real runner with a stream double.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { isTimeoutProviderError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BUDGET_REACHED_MESSAGE, isBudgetEndedError } from '../src/server/AgentV3/turnDeadline';
import type { ClaudeToolDef, RunTurnParams } from '../src/server/AgentV3/ClaudeClient';

const TOOLS: ClaudeToolDef[] = [
  { name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
];
const params = (over: Partial<RunTurnParams> = {}): RunTurnParams => ({
  model: 'kimi-k2.7-code', system: 'You build apps.', messages: [{ role: 'user', content: 'go on' }], tools: TOOLS, ...over,
});

/** A provider that streams reasoning every 30 ms for `thinkMs`, then (optionally) an answer. */
function thinkingStream(thinkMs: number, answer?: string) {
  let aborted = false;
  const stream = {
    controller: { abort: () => { aborted = true; } },
    get aborted() { return aborted; },
    async *[Symbol.asyncIterator]() {
      const until = Date.now() + thinkMs;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 30));
        if (aborted) return;
        yield { choices: [{ delta: { reasoning_content: 'thinking… ' } }] };
      }
      if (answer) yield { choices: [{ delta: { content: answer } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } };
    },
  };
  const client = { chat: { completions: { create: async () => stream } } } as unknown as OpenAiChatClient;
  return { client, stream };
}

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });
function streamingOn(hardCapMs: number) {
  process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
  process.env.AGENTV3_STREAM_IDLE_MS = '400';
  process.env.AGENTV3_STREAM_HARD_CAP_MS = String(hardCapMs);
}

describe('the answer must begin within the rung\'s own bound', () => {
  it('🔒 reasoning only, past the bound, with a next rung ⇒ a provider TIMEOUT (the chain falls), and the stream is closed', async () => {
    streamingOn(5_000);
    const { client, stream } = thinkingStream(3_000);
    const started = Date.now();
    const err = await new OpenAiToolRunner(client, { model: 'kimi-k2.7-code', timeoutMs: 300 })
      .runTurn(params({ hasNextRung: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out after 300ms — only reasoning arrived/);
    expect(isTimeoutProviderError(err), 'must be a timeout the ladder falls through and benches on').toBe(true);
    expect(isBudgetEndedError(err), 'must never read as our own budget ending').toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(stream.aborted, 'the provider must stop generating (and billing)').toBe(true);
  });

  it('an answer that BEGINS inside the bound is never cut, however long the whole call runs', async () => {
    streamingOn(5_000);
    const { client } = thinkingStream(150, 'Here is the plan.');
    const res = await new OpenAiToolRunner(client, { model: 'kimi-k2.7-code', timeoutMs: 300 })
      .runTurn(params({ hasNextRung: true }));
    expect(JSON.stringify(res)).toContain('Here is the plan.');
  });

  it('the LAST rung is not given the bound — a slow answer beats no answer', async () => {
    streamingOn(5_000);
    const { client } = thinkingStream(600, 'Late but real.');
    const res = await new OpenAiToolRunner(client, { model: 'kimi-k2.7-code', timeoutMs: 300 })
      .runTurn(params({ hasNextRung: false }));
    expect(JSON.stringify(res)).toContain('Late but real.');
  });
});

describe('whose ceiling it was decides the words', () => {
  it('🔒 the PROVIDER\'s own stream ceiling is a timeout, never "build budget reached"', async () => {
    streamingOn(500);
    const { client } = thinkingStream(3_000);
    const err = await new OpenAiToolRunner(client, { model: 'kimi-k2.7-code', timeoutMs: 120_000 })
      .runTurn(params({ hasNextRung: false })).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(BUDGET_REACHED_MESSAGE);
    expect(isTimeoutProviderError(err)).toBe(true);
  });

  it('the LANE\'s deadline, when nearer, is still our budget — never blamed on the provider', async () => {
    streamingOn(5_000);
    const { client } = thinkingStream(3_000);
    const err = await new OpenAiToolRunner(client, { model: 'kimi-k2.7-code', timeoutMs: 120_000 })
      .runTurn(params({ hasNextRung: true, deadlineAt: Date.now() + 2_500 })).catch((e: unknown) => e);
    expect(isBudgetEndedError(err)).toBe(true);
  });
});
