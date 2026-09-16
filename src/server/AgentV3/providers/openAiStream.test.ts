import { describe, it, expect, afterEach } from 'vitest';
import {
  OpenAiStreamAccumulator,
  buildStreamingEnabled,
  streamIdleMs,
  streamHardCapMs,
  STREAM_IDLE_MS_DEFAULT,
  STREAM_HARD_CAP_MS_DEFAULT,
} from './openAiStream';
import { parseOpenAiCompletion } from './OpenAiToolAdapter';

/**
 * The accumulator is the breakage-prone half of streamed reading: tool-call arguments arrive as
 * fragments and a mistake here produces a tool call that dispatches to nothing. It is pure, so every
 * case below is exercised without a key, a network call or a clock.
 */

/** One text delta chunk. */
const text = (s: string) => ({ choices: [{ delta: { content: s } }] });

describe('OpenAiStreamAccumulator — text', () => {
  it('joins content deltas in order', () => {
    const acc = new OpenAiStreamAccumulator();
    for (const s of ['Hello', ', ', 'world']) acc.push(text(s));
    expect(acc.textSoFar()).toBe('Hello, world');
    expect(parseOpenAiCompletion(acc.toCompletion('complete')).text).toBe('Hello, world');
  });

  it('ignores junk chunks instead of throwing — a malformed frame must not kill a live turn', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push(null);
    acc.push(undefined);
    acc.push({} as never);
    acc.push({ choices: [] });
    acc.push({ choices: [{}] });
    acc.push(text('ok'));
    expect(acc.textSoFar()).toBe('ok');
  });
});

describe('OpenAiStreamAccumulator — tool calls', () => {
  it('reassembles arguments split across chunks, with id and name arriving only once', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: '{"path":' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src/App.tsx",' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"hi"}' } }] } }, { finish_reason: 'tool_calls' } as never] });
    acc.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });

    const result = parseOpenAiCompletion(acc.toCompletion('complete'));
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses[0]).toMatchObject({ id: 'call_1', name: 'write_file' });
    expect(result.toolUses[0].input).toEqual({ path: 'src/App.tsx', content: 'hi' });
    expect(result.stopReason).toBe('tool_use');
  });

  it('keeps parallel calls apart by index, and emits them in index order', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{"n":2}' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'first', arguments: '{"n":1}' } }] } }] });
    const result = parseOpenAiCompletion(acc.toCompletion('complete'));
    expect(result.toolUses.map((t) => t.name)).toEqual(['first', 'second']);
  });

  it('drops a fragment that never carried a name — it could only dispatch to nothing', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] });
    expect(parseOpenAiCompletion(acc.toCompletion('complete')).toolUses).toHaveLength(0);
  });
});

describe('OpenAiStreamAccumulator — a stall keeps what arrived', () => {
  /**
   * 🔑 The change this whole module exists for. The old total-clock bound returned NOTHING when it
   * fired; a stalled stream returns the partial answer, shaped as the truncation the engine already
   * knows how to recover from.
   */
  it('reports a stall as `length`, so the truncation guard can name the cut-off file', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"src/Big.tsx","content":"half a fi' } }] } }] });

    const result = parseOpenAiCompletion(acc.toCompletion('idle'));
    expect(result.truncated).toBe(true);
    // The arguments no longer parse, but the PATH is salvaged — so the build knows which file to redo.
    expect(result.toolUses[0].input).toEqual({ path: 'src/Big.tsx' });
    // …and never the half-written content, which must not reach disk.
    expect(result.toolUses[0].input).not.toHaveProperty('content');
  });

  it('a completed stream keeps the provider’s own finish_reason', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] });
    expect(acc.toCompletion('complete').choices[0].finish_reason).toBe('stop');
    expect(parseOpenAiCompletion(acc.toCompletion('complete')).truncated).toBeUndefined();
  });

  it('hasAnswer ignores reasoning — thinking alone is not something to salvage', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { reasoning_content: 'let me think…' } }] });
    expect(acc.hasContent()).toBe(true);
    expect(acc.hasAnswer()).toBe(false);
    acc.push(text('a'));
    expect(acc.hasAnswer()).toBe(true);
  });
});

describe('OpenAiStreamAccumulator — usage and model', () => {
  it('captures the usage that rides the final chunk, and a later empty chunk cannot erase it', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push(text('hi'));
    expect(acc.usageMissing()).toBe(true);
    acc.push({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } });
    acc.push({ choices: [{ delta: {} }] });
    expect(acc.usageMissing()).toBe(false);
    const usage = parseOpenAiCompletion(acc.toCompletion('complete')).usage;
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 40 });
  });

  /** 🔒 ONE-WALLET LAW: a stream with no usage reports ZERO, never an invented number. */
  it('a stream that carried no usage yields zeros, not an estimate from the text length', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push(text('a fairly long answer that would tokenize to something'));
    const usage = parseOpenAiCompletion(acc.toCompletion('complete')).usage;
    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('carries the model id through, so real-cost billing prices the rung that actually ran', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ model: 'glm-5.3-flash', choices: [{ delta: { content: 'x' } }] });
    expect(parseOpenAiCompletion(acc.toCompletion('complete')).model).toBe('glm-5.3-flash');
  });
});

describe('the clock and the switch', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('is OFF unless explicitly set to `on` — unset means today’s behaviour exactly', () => {
    expect(buildStreamingEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(buildStreamingEnabled({ AGENTV3_STREAM_BUILD_CALLS: '' } as NodeJS.ProcessEnv)).toBe(false);
    expect(buildStreamingEnabled({ AGENTV3_STREAM_BUILD_CALLS: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(buildStreamingEnabled({ AGENTV3_STREAM_BUILD_CALLS: ' ON ' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('a malformed clock value falls back to the default rather than to zero (which would mean "no bound")', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5']) {
      expect(streamIdleMs({ AGENTV3_STREAM_IDLE_MS: bad } as NodeJS.ProcessEnv)).toBe(STREAM_IDLE_MS_DEFAULT);
      expect(streamHardCapMs({ AGENTV3_STREAM_HARD_CAP_MS: bad } as NodeJS.ProcessEnv)).toBe(STREAM_HARD_CAP_MS_DEFAULT);
    }
    expect(streamIdleMs({ AGENTV3_STREAM_IDLE_MS: '15000' } as NodeJS.ProcessEnv)).toBe(15_000);
  });

  it('the hard cap stays under the 480 s build-turn budget, so one slow rung cannot eat a whole turn', () => {
    expect(STREAM_HARD_CAP_MS_DEFAULT).toBeLessThan(480_000);
    expect(STREAM_IDLE_MS_DEFAULT).toBeLessThan(STREAM_HARD_CAP_MS_DEFAULT);
  });
});
