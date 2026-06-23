import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeClient, parseMessage, isRetryableError, type MessagesCreateClient } from './ClaudeClient';
import { opusEquivalentUsd, billedAmountUsd, STANDARD_MULTIPLIER, ONLY_OPUS_MULTIPLIER } from './pricing';

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

describe('pricing (D5/D6) — margin is structurally positive', () => {
  it('computes Opus-equivalent cost from default $15/$75 per MTok', () => {
    // 1M input + 1M output = $15 + $75 = $90
    expect(opusEquivalentUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(90, 6);
  });

  it('applies 2.5x standard markup and 5x only-opus markup', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const base = opusEquivalentUsd(usage);
    expect(billedAmountUsd(usage, false)).toBeCloseTo(base * STANDARD_MULTIPLIER, 6);
    expect(billedAmountUsd(usage, true)).toBeCloseTo(base * ONLY_OPUS_MULTIPLIER, 6);
    // 5x > 2.5x > raw cost → user always pays at least the real cost.
    expect(billedAmountUsd(usage, true)).toBeGreaterThan(billedAmountUsd(usage, false));
    expect(billedAmountUsd(usage, false)).toBeGreaterThan(base);
  });

  it('never goes negative on zero/garbage token counts', () => {
    expect(billedAmountUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(billedAmountUsd({ inputTokens: -5, outputTokens: -5 })).toBe(0);
  });
});

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
