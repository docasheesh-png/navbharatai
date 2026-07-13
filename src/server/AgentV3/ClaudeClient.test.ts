import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeClient, parseMessage, isRetryableError, type MessagesCreateClient } from './ClaudeClient';
import { runInNoClaudeZone, NoClaudeInWeakBuildError } from './noClaudeZone';

describe('parseMessage', () => {
  it('extracts text, tool_use blocks, stop reason and usage', () => {
    const result = parseMessage({
      content: [
        { type: 'text', text: 'Let me create the file.' },
        { type: 'tool_use', id: 'tu_1', name: 'write_file', input: { path: 'a.ts', content: 'x' } },
        { type: 'tool_use', id: 'tu_2', name: 'bash', input: { command: 'ls' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 10 },
    });

    expect(result.text).toBe('Let me create the file.');
    expect(result.toolUses).toHaveLength(2);
    expect(result.toolUses[0]).toEqual({ id: 'tu_1', name: 'write_file', input: { path: 'a.ts', content: 'x' } });
    expect(result.toolUses[1].name).toBe('bash');
    expect(result.stopReason).toBe('tool_use');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(40);
    expect(result.usage.cacheReadInputTokens).toBe(10);
    expect(result.usage.cacheCreationInputTokens).toBe(0);
  });

  it('tolerates a missing usage block and malformed tool_use', () => {
    const result = parseMessage({
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', name: 'no_id_so_skipped' }, // missing id → skipped
      ],
      stop_reason: 'end_turn',
    });
    expect(result.text).toBe('done');
    expect(result.toolUses).toHaveLength(0);
    expect(result.usage.inputTokens).toBe(0);
  });
});

describe('ClaudeClient.runTurn — UNBREAKABLE weak-module no-Claude guard', () => {
  // Admin absolute rule (2026-07-13) + App #3 leak: a weak/free build must NEVER run Claude, even a
  // raw ClaudeClient that bypassed the chain guard. The chokepoint refuses BEFORE touching the client.
  it('throws NoClaudeInWeakBuildError inside an active zone, without calling the API', async () => {
    const create = vi.fn(); // must NEVER be called
    const client = new ClaudeClient({ messages: { create } } as MessagesCreateClient);
    await runInNoClaudeZone({ active: true }, async () => {
      await expect(
        client.runTurn({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'fix it' }] }),
      ).rejects.toBeInstanceOf(NoClaudeInWeakBuildError);
    });
    expect(create).not.toHaveBeenCalled(); // no tokens spent
  });

  it('runs normally when the zone is inactive (paid/power build)', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new ClaudeClient({ messages: { create } } as MessagesCreateClient);
    await runInNoClaudeZone({ active: false }, async () => {
      const res = await client.runTurn({ model: 'claude-sonnet-4-6', messages: [] });
      expect(res.text).toBe('ok');
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  // HAIKU AMENDMENT (admin 2026-07-13): Haiku is the ONE authorized Claude on a weak build — the chain's
  // CLAUDE_HAIKU backstop is forceModelRunner-pinned to haikuModel(), so a legit backstop turn presents a
  // haiku id here and must RUN; Sonnet/Opus stay refused ("never never").
  it('allows a HAIKU call inside an active zone (the authorized weak-tier last resort)', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'haiku ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new ClaudeClient({ messages: { create } } as MessagesCreateClient);
    await runInNoClaudeZone({ active: true }, async () => {
      const res = await client.runTurn({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'fix' }] });
      expect(res.text).toBe('haiku ok');
      await expect(
        client.runTurn({ model: 'claude-opus-4-8', messages: [] }),
      ).rejects.toBeInstanceOf(NoClaudeInWeakBuildError); // opus: never never
    });
    expect(create).toHaveBeenCalledTimes(1); // only the haiku call reached the API
  });
});

describe('ClaudeClient.runTurn (injected mock client)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes model/system/messages and adds tools + tool_choice when tools given', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const mock: MessagesCreateClient = { messages: { create } };
    const client = new ClaudeClient(mock);

    const res = await client.runTurn({
      model: 'claude-sonnet-test',
      system: 'You are an engineer.',
      messages: [{ role: 'user', content: 'build x' }],
      tools: [{ name: 'bash', description: 'run', input_schema: { type: 'object', properties: {} } }],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-test');
    // System is cached by default (RC-2): a [{type:'text', text, cache_control}] block.
    expect(params.system[0].text).toBe('You are an engineer.');
    expect(params.tools).toHaveLength(1);
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.max_tokens).toBe(8192);
    expect(res.text).toBe('ok');
    expect(res.usage.inputTokens).toBe(5);
  });

  it('omits tools/tool_choice when no tools are provided', async () => {
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' });
    const client = new ClaudeClient({ messages: { create } });
    await client.runTurn({ model: 'm', messages: [] });
    const params = create.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
  });
});

describe('ClaudeClient streaming (word-by-word + thinking)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('delivers text/thinking deltas via callbacks and parses the final message', async () => {
    const finalMessage = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello world' },
        { type: 'tool_use', id: 'tu_1', name: 'write_file', input: { path: 'a.ts' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    async function* gen() {
      yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me ' } };
      yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'plan' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
    }
    const stream = vi.fn().mockImplementation(() => {
      const iter = gen() as AsyncIterable<unknown> & { finalMessage: typeof finalMessage };
      iter.finalMessage = finalMessage;
      return iter;
    });
    const create = vi.fn();
    const client = new ClaudeClient({ messages: { create, stream } } as MessagesCreateClient);

    const textDeltas: string[] = [];
    const thinkingDeltas: string[] = [];
    const res = await client.runTurn({
      // A thinking-CAPABLE model (Sonnet 4.6) so adaptive thinking is actually requested.
      model: 'claude-sonnet-4-6',
      messages: [],
      thinking: true,
      onText: (d) => textDeltas.push(d),
      onThinking: (d) => thinkingDeltas.push(d),
    });

    // Streamed, not the non-streaming create path.
    expect(stream).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    // Adaptive thinking was requested in the right shape.
    expect(stream.mock.calls[0][0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });

    expect(textDeltas).toEqual(['Hello ', 'world']);
    expect(thinkingDeltas).toEqual(['Let me ', 'plan']);
    expect(res.text).toBe('Hello world');
    expect(res.toolUses).toHaveLength(1);
    expect(res.usage.inputTokens).toBe(12);
  });

  it('uses the non-streaming path when no callbacks are provided (backward compatible)', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
    const stream = vi.fn();
    const client = new ClaudeClient({ messages: { create, stream } } as MessagesCreateClient);
    const res = await client.runTurn({ model: 'm', messages: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(res.text).toBe('ok');
  });

  it('falls back to the non-streaming create path when streaming throws a transient error', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'recovered' }], stop_reason: 'end_turn' });
    const stream = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error('overloaded'), { status: 529 });
    });
    const client = new ClaudeClient({ messages: { create, stream } } as MessagesCreateClient, { sleep: async () => {}, baseDelayMs: 0 });
    const res = await client.runTurn({ model: 'm', messages: [], onText: () => {} });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('recovered');
  });
});

// REGRESSION (build report 2026-07-05): a Haiku build turn sent adaptive `thinking` and the API 400'd
// with "adaptive thinking is not supported on this model", killing the whole provider-fallback chain.
// Extended-reasoning params must be gated by model capability so a cheap/fallback tier degrades
// gracefully (no reasoning display) instead of failing the turn outright.
describe('ClaudeClient — extended-reasoning params gated by model capability (build-report fix)', () => {
  function mock() {
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' });
    return { create, client: new ClaudeClient({ messages: { create } } as MessagesCreateClient) };
  }

  it('does NOT send adaptive thinking to a HAIKU model (the exact 400 the build report hit)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'claude-haiku-4-5-20251001', messages: [], thinking: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].thinking).toBeUndefined(); // gated off → no 400
  });

  it('does NOT send output_config.effort to a HAIKU model either (same capability class)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'claude-haiku-4-5-20251001', messages: [], effort: 'high' });
    expect(create.mock.calls[0][0].output_config).toBeUndefined();
  });

  it('DOES send adaptive thinking + effort to a capable model (Sonnet 4.6)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'claude-sonnet-4-6', messages: [], thinking: true, effort: 'high' });
    const p = create.mock.calls[0][0];
    expect(p.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(p.output_config).toEqual({ effort: 'high' });
  });

  it('DOES send them to Opus 4.8', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'claude-opus-4-8', messages: [], thinking: true });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('default-DENIES an unknown model id (never send an unsupported param → no 400)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'some-future-model', messages: [], thinking: true });
    expect(create.mock.calls[0][0].thinking).toBeUndefined();
  });
});

describe('ClaudeClient prompt caching (RC-2)', () => {
  function mock() {
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' });
    return { create, client: new ClaudeClient({ messages: { create } }) };
  }

  it('caches the system prompt by default (system becomes a cached block array)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'm', system: 'big system', messages: [] });
    const params = create.mock.calls[0][0];
    expect(Array.isArray(params.system)).toBe(true);
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0].text).toBe('big system');
  });

  it('does not cache when cache:false (system stays a plain string)', async () => {
    const { create, client } = mock();
    await client.runTurn({ model: 'm', system: 'big system', messages: [], cache: false });
    expect(create.mock.calls[0][0].system).toBe('big system');
  });

  it('marks the last tool with cache_control when there is no system block', async () => {
    const { create, client } = mock();
    await client.runTurn({
      model: 'm',
      messages: [],
      tools: [
        { name: 'a', description: 'a', input_schema: { type: 'object', properties: {} } },
        { name: 'b', description: 'b', input_schema: { type: 'object', properties: {} } },
      ],
    });
    const tools = create.mock.calls[0][0].tools;
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('caches the growing transcript: last block of last message gets the breakpoint', async () => {
    const { create, client } = mock();
    await client.runTurn({
      model: 'm',
      system: 'sys',
      messages: [
        { role: 'user', content: 'build a todo app' },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: '1', name: 'write_file', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'wrote' }] },
      ],
    });
    const msgs = create.mock.calls[0][0].messages;
    // First message's string content is untouched (no breakpoint on it).
    expect(msgs[0].content).toBe('build a todo app');
    // Last message's last block carries the breakpoint.
    const lastBlocks = msgs[2].content;
    expect(lastBlocks[lastBlocks.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('never accumulates >1 transcript breakpoint: a stale one on an earlier message is stripped', async () => {
    const { create, client } = mock();
    await client.runTurn({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'old', cache_control: { type: 'ephemeral' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
      ],
    });
    const msgs = create.mock.calls[0][0].messages;
    // The stale breakpoint on message 0 is removed; only the last message's last block has one.
    expect(msgs[0].content[0].cache_control).toBeUndefined();
    expect(msgs[1].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not cache the transcript when cache:false', async () => {
    const { create, client } = mock();
    const original = [{ role: 'user', content: 'hi' }];
    await client.runTurn({ model: 'm', messages: original, cache: false });
    expect(create.mock.calls[0][0].messages).toBe(original); // passed through untouched
  });
});

describe('ClaudeClient retry/backoff (production hardening)', () => {
  const noSleep = async () => {};

  it('retries a transient 529 (overloaded) then succeeds', async () => {
    let calls = 0;
    const create = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        const e = Object.assign(new Error('overloaded'), { status: 529 });
        throw e;
      }
      return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
    });
    const client = new ClaudeClient({ messages: { create } }, { sleep: noSleep, baseDelayMs: 0 });
    const res = await client.runTurn({ model: 'm', messages: [] });
    expect(calls).toBe(3);
    expect(res.text).toBe('ok');
  });

  it('fails fast on a 400 (no retry)', async () => {
    const create = vi.fn().mockImplementation(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });
    const client = new ClaudeClient({ messages: { create } }, { sleep: noSleep });
    await expect(client.runTurn({ model: 'm', messages: [] })).rejects.toThrow('bad request');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries on a persistent 503', async () => {
    const create = vi.fn().mockImplementation(async () => {
      throw Object.assign(new Error('down'), { status: 503 });
    });
    const client = new ClaudeClient({ messages: { create } }, { sleep: noSleep, maxRetries: 2 });
    await expect(client.runTurn({ model: 'm', messages: [] })).rejects.toThrow('down');
    expect(create).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});

describe('isRetryableError', () => {
  it('treats rate-limit / overload / 5xx as retryable, client errors as fatal', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 529 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
    expect(isRetryableError(new Error('Connection error'))).toBe(true);
    expect(isRetryableError(new Error('request timeout'))).toBe(true);
    expect(isRetryableError(new Error('totally invalid prompt'))).toBe(false);
  });
});

// Pricing is covered comprehensively in pricing.test.ts (admin model 2026-07-05:
// cheap → Sonnet-equivalent × 1.2, Sonnet → × 3, Opus/power → real Opus × 2, + INR conversion).

import { sanitizeApiKey } from './ClaudeClient';

describe('sanitizeApiKey', () => {
  it('strips surrounding whitespace, newlines and wrapping quotes', () => {
    expect(sanitizeApiKey('  sk-ant-abc\n')).toBe('sk-ant-abc');
    expect(sanitizeApiKey('"sk-ant-abc"')).toBe('sk-ant-abc');
    expect(sanitizeApiKey("'sk-ant-abc'")).toBe('sk-ant-abc');
    expect(sanitizeApiKey('sk-ant-abc')).toBe('sk-ant-abc');
  });
  it('returns undefined for empty/missing values', () => {
    expect(sanitizeApiKey(undefined)).toBeUndefined();
    expect(sanitizeApiKey('   ')).toBeUndefined();
    expect(sanitizeApiKey('')).toBeUndefined();
  });
});

import { resolveAnthropicBaseUrl } from './ClaudeClient';

describe('resolveAnthropicBaseUrl', () => {
  const prevShared = process.env.ANTHROPIC_BASE_URL;
  const prevOverride = process.env.AGENTV3_ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (prevShared === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prevShared;
    if (prevOverride === undefined) delete process.env.AGENTV3_ANTHROPIC_BASE_URL;
    else process.env.AGENTV3_ANTHROPIC_BASE_URL = prevOverride;
  });

  it('defaults to the real Anthropic endpoint', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.AGENTV3_ANTHROPIC_BASE_URL;
    expect(resolveAnthropicBaseUrl()).toBe('https://api.anthropic.com');
  });

  it('IGNORES the ambient ANTHROPIC_BASE_URL proxy (the 404 cause)', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.aicredits.in/v1';
    delete process.env.AGENTV3_ANTHROPIC_BASE_URL;
    // The SDK would read ANTHROPIC_BASE_URL if we left baseURL unset; we must not.
    expect(resolveAnthropicBaseUrl()).toBe('https://api.anthropic.com');
  });

  it('honours an explicit AgentV3 override and strips a trailing /v1', () => {
    process.env.AGENTV3_ANTHROPIC_BASE_URL = 'https://my-gateway.example.com/v1';
    expect(resolveAnthropicBaseUrl()).toBe('https://my-gateway.example.com');
  });
});

import { llmRequestTimeoutMs } from './ClaudeClient';

describe('llmRequestTimeoutMs — fast-fail cap so a stalled model call never hangs the build', () => {
  const prev = process.env.AGENTV3_LLM_TIMEOUT_MS;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_LLM_TIMEOUT_MS; else process.env.AGENTV3_LLM_TIMEOUT_MS = prev; });

  it('defaults to 120 s', () => {
    delete process.env.AGENTV3_LLM_TIMEOUT_MS;
    expect(llmRequestTimeoutMs()).toBe(120_000);
  });
  it('honours a positive override', () => {
    process.env.AGENTV3_LLM_TIMEOUT_MS = '60000';
    expect(llmRequestTimeoutMs()).toBe(60_000);
  });
  it('falls back to the default on a non-numeric / zero / negative value', () => {
    process.env.AGENTV3_LLM_TIMEOUT_MS = 'abc';
    expect(llmRequestTimeoutMs()).toBe(120_000);
    process.env.AGENTV3_LLM_TIMEOUT_MS = '0';
    expect(llmRequestTimeoutMs()).toBe(120_000);
  });
});
