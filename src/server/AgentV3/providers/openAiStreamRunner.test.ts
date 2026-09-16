import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiToolRunner, type OpenAiChatClient } from './OpenAiToolRunner';
import type { ClaudeToolDef, RunTurnParams } from '../ClaudeClient';
import { BUDGET_REACHED_MESSAGE } from '../turnDeadline';

/**
 * THE STREAMED BUILD CALL, end to end through the runner (admin 2026-09-16: "kimi aur glm slow hai,
 * time out ho jata hai").
 *
 * The accumulator is unit-tested in openAiStream.test.ts; what is asserted HERE is the behaviour that
 * decides whether a slow provider costs a build:
 *   • a stall keeps the partial answer instead of destroying the call;
 *   • a stall with nothing usable is still a provider FAILURE, so the chain falls through and the
 *     bench can see it;
 *   • our clock ending is never reported as the provider's fault;
 *   • the flag off is byte-identical to the non-streaming path.
 */

const TOOLS: ClaudeToolDef[] = [
  { name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
];

const baseParams = (over: Partial<RunTurnParams> = {}): RunTurnParams => ({
  model: 'claude-sonnet-4-6',
  system: 'You build apps.',
  messages: [{ role: 'user', content: 'make a calculator' }],
  tools: TOOLS,
  ...over,
});

type Chunk = Record<string, unknown>;

/**
 * A stream double. `chunks` may contain a `number`, meaning "wait this long before the next chunk" —
 * which is how a stalled provider is simulated without waiting in real time (vi.useFakeTimers cannot
 * be used here because the runner races real promises).
 */
function streamOf(chunks: Array<Chunk | number>, onAbort?: () => void) {
  let aborted = false;
  return {
    controller: { abort: () => { aborted = true; onAbort?.(); } },
    get aborted() { return aborted; },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        if (typeof c === 'number') {
          await new Promise((r) => setTimeout(r, c));
          if (aborted) return;
          continue;
        }
        yield c;
      }
    },
  };
}

function clientStreaming(stream: unknown): { client: OpenAiChatClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(stream);
  return { client: { chat: { completions: { create } } } as unknown as OpenAiChatClient, create };
}

const textChunk = (s: string) => ({ choices: [{ delta: { content: s } }] });

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

function enableStreaming(idleMs = 120) {
  process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
  process.env.AGENTV3_STREAM_IDLE_MS = String(idleMs);
  process.env.AGENTV3_STREAM_HARD_CAP_MS = '5000';
}

describe('streamed build calls — the flag', () => {
  it('OFF by default: the request carries no stream field and the old path runs', async () => {
    const { client, create } = clientStreaming({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const res = await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams());
    expect(create.mock.calls[0][0].stream).toBeUndefined();
    expect(create.mock.calls[0][0].stream_options).toBeUndefined();
    expect(res.text).toBe('done');
  });

  it('ON: asks for the stream AND for usage on the final chunk (a stream carries none otherwise)', async () => {
    enableStreaming();
    const { client, create } = clientStreaming(streamOf([textChunk('hi'), { choices: [{ delta: {}, finish_reason: 'stop' }] }]));
    await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams());
    expect(create.mock.calls[0][0].stream).toBe(true);
    expect(create.mock.calls[0][0].stream_options).toEqual({ include_usage: true });
  });

  it('ON but the provider ignored it and answered normally: the completion is still parsed', async () => {
    enableStreaming();
    const { client } = clientStreaming({
      choices: [{ message: { role: 'assistant', content: 'plain' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const res = await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams());
    expect(res.text).toBe('plain');
  });
});

describe('streamed build calls — a slow provider is not a failed one', () => {
  it('delivers text incrementally to onText, exactly once per delta', async () => {
    enableStreaming();
    const { client } = clientStreaming(streamOf([
      textChunk('Build'), textChunk('ing '), textChunk('app'),
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]));
    const onText = vi.fn();
    const res = await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams({ onText }));
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['Build', 'ing ', 'app']);
    // …and NOT a fourth call repeating the whole answer.
    expect(onText).toHaveBeenCalledTimes(3);
    expect(res.text).toBe('Building app');
  });

  /** 🔑 THE WHOLE POINT: the old total clock returned nothing here. */
  it('a stall KEEPS the partial answer and reports it as truncated, naming the cut-off file', async () => {
    enableStreaming(100);
    const stream = streamOf([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"half' } }] } }] },
      600, // silence far longer than the 100 ms idle bound
      textChunk('never arrives'),
    ]);
    const { client } = clientStreaming(stream);
    const res = await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams());

    expect(res.truncated).toBe(true);
    expect(res.toolUses).toHaveLength(1);
    expect(res.toolUses[0].input).toEqual({ path: 'src/App.tsx' });
    // The provider is still generating and still billing when we stop reading — so it is aborted.
    expect(stream.aborted).toBe(true);
  });

  it('a stall with NOTHING usable is a provider failure the bench can see', async () => {
    enableStreaming(80);
    const { client } = clientStreaming(streamOf([500, textChunk('too late')]));
    await expect(new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams()))
      .rejects.toThrow(/timed out/i);
  });

  it('reasoning alone is not an answer — a stall after only thinking still fails the rung', async () => {
    enableStreaming(80);
    const { client } = clientStreaming(streamOf([
      { choices: [{ delta: { reasoning_content: 'thinking hard…' } }] },
      500,
    ]));
    await expect(new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams()))
      .rejects.toThrow(/timed out/i);
  });
});

describe('streamed build calls — whose clock ran out', () => {
  /**
   * A provider handed two seconds because the LANE had two seconds left has not failed at anything.
   * `isTimeoutProviderError` must not match this, or a healthy rung gets benched for our budgeting.
   */
  it('the lane’s deadline ending a stream reads as OUR budget, never as a provider timeout', async () => {
    enableStreaming(5_000); // idle bound far larger than the lane's remaining budget
    const { client } = clientStreaming(streamOf([1_000, textChunk('late')]));
    await expect(
      new OpenAiToolRunner(client, { model: 'glm-5.3-flash' })
        .runTurn(baseParams({ deadlineAt: Date.now() + 300 })),
    ).rejects.toThrow(BUDGET_REACHED_MESSAGE);
  });

  it('a lane with no budget left never opens a stream at all', async () => {
    enableStreaming();
    const { client, create } = clientStreaming(streamOf([textChunk('x')]));
    await expect(
      new OpenAiToolRunner(client, { model: 'glm-5.3-flash' })
        .runTurn(baseParams({ deadlineAt: Date.now() - 1 })),
    ).rejects.toThrow(/budget exhausted/i);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('streamed build calls — an abandoned read must not crash the server', () => {
  /**
   * 🔴 Aborting the stream is exactly what makes the pending `next()` reject, a moment AFTER we
   * stopped waiting on it. Without a handler that is an unhandled rejection in the build server —
   * from the code path added to make builds more reliable.
   */
  it('a stream whose iterator throws after the stall raises no unhandled rejection', async () => {
    enableStreaming(60);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const stream = {
        controller: { abort() { /* the SDK would reject the in-flight next() here */ } },
        async *[Symbol.asyncIterator]() {
          yield textChunk('partial answer');
          await new Promise((r) => setTimeout(r, 400));
          throw new Error('stream aborted by client');
        },
      };
      const { client } = clientStreaming(stream);
      const res = await new OpenAiToolRunner(client, { model: 'glm-5.3-flash' }).runTurn(baseParams());
      expect(res.text).toBe('partial answer');
      expect(res.truncated).toBe(true);
      // Let the abandoned promise settle and any rejection surface.
      await new Promise((r) => setTimeout(r, 500));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
