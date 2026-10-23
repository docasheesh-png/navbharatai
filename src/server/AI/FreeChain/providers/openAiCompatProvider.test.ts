import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';

const { create, construct, withResponse } = vi.hoisted(() => ({ create: vi.fn(), construct: vi.fn(), withResponse: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
    constructor(options: unknown) { construct(options); }
  },
}));

import { OpenAiCompatProvider, FreeChainProviderError, type AdapterConfig } from './openAiCompatProvider';
import { runWithInferenceScope } from '../../inferencePolicy';

const KEY = 'test-fake-secret-never-log';
const GROQ: AdapterConfig = {
  provider: 'GROQ', model: 'test-model', key: KEY,
  baseURL: 'https://api.groq.com/openai/v1', priority: 2,
  maxOutputTokens: 512, timeoutMs: 4000, streamUsage: false,
};
const config = (overrides: Partial<AdapterConfig> = {}): AdapterConfig => ({ ...GROQ, ...overrides });
function reply(data: unknown, headers: Record<string, string> = {}) {
  withResponse.mockResolvedValue({ data, response: { headers: new Headers(headers) } });
}
function completion(content: string | null = 'hello', usage?: unknown) {
  return { choices: [{ message: { content }, finish_reason: 'stop' }], usage };
}
function stream(chunks: unknown[], headers: Record<string, string> = {}, terminal = true) {
  const controller = new AbortController();
  reply({ controller, async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
    if (terminal) yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
  } }, headers);
  return controller;
}
function chunk(content: string, extra: Record<string, unknown> = {}) {
  return { choices: [{ delta: { content }, finish_reason: null }], ...extra };
}
async function failure(promise: Promise<unknown>) {
  try { await promise; throw new Error('Expected failure'); }
  catch (error) { expect(error).toBeInstanceOf(FreeChainProviderError); return error as FreeChainProviderError; }
}

beforeEach(() => {
  vi.resetAllMocks();
  create.mockReturnValue({ withResponse });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('endpoint and credential boundary', () => {
  it.each([
    ['GLM', 'https://api.z.ai/api/paas/v4/'],
    ['GEMINI', 'https://generativelanguage.googleapis.com/v1beta/openai/'],
    ['GROQ', 'https://api.groq.com/openai/v1'],
    ['CLOUDFLARE', 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1'],
    ['DEEPSEEK', 'https://api.deepseek.com/v1/'],
  ] as const)('accepts only the fixed %s endpoint', async (provider, baseURL) => {
    const adapter = new OpenAiCompatProvider(config({ provider, baseURL }));
    expect(adapter.name).toBe(provider);
    expect(await adapter.healthCheck()).toBe(true);
    expect(construct).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    'http://api.groq.com/openai/v1', 'https://evil.example/openai/v1',
    'https://api.groq.com.evil.example/openai/v1', 'https://api.groq.com@evil.example/openai/v1',
    'https://user:secret@api.groq.com/openai/v1', 'https://api.groq.com/openai/v1?key=secret',
    'https://api.groq.com/openai/v1#secret', 'https://api.groq.com:443/openai/v1',
    'https://api.groq.com/openai/v1/../v1', 'https://api.groq.com/openai/v1//',
    'https://api.groq.com/openai/v1\n', 'https://generativelanguage.googleapis.com/v1beta/openai',
  ])('rejects URL override %s before constructing a client', (baseURL) => {
    expect(() => new OpenAiCompatProvider(config({ baseURL }))).toThrow('CONFIGURATION');
    expect(construct).not.toHaveBeenCalled();
  });

  it.each(['', 'one,two', 'one two', 'one\ntwo', ' key', 'key\t', 'x'.repeat(4097)])('rejects missing or multiple credentials', (key) => {
    expect(() => new OpenAiCompatProvider(config({ key }))).toThrow('CONFIGURATION');
  });

  it.each([
    { model: 'one,two' }, { model: 'bad model' }, { priority: -1 }, { priority: 1.5 },
    { maxOutputTokens: 0 }, { maxOutputTokens: Infinity }, { maxOutputTokens: 131073 },
    { timeoutMs: 0 }, { timeoutMs: 600001 }, { envName: 'Bearer secret' },
  ])('rejects unsafe configuration %j', (override) => {
    expect(() => new OpenAiCompatProvider(config(override))).toThrow('CONFIGURATION');
  });

  it('freezes public rung identity and copies configuration before the caller can mutate it', async () => {
    const input = config();
    const adapter = new OpenAiCompatProvider(input);
    input.model = 'expensive-model'; input.maxOutputTokens = 100000;
    expect(() => { Object.assign(adapter, { pinnedModel: 'expensive-model' }); }).toThrow();
    reply(completion());
    await adapter.execute('hello');
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'test-model', max_completion_tokens: 512 });
  });

  it('neither object inspection nor JSON exposes credentials or the SDK after dispatch', async () => {
    const adapter = new OpenAiCompatProvider(config());
    reply(completion());
    await adapter.execute('hello');
    expect(JSON.stringify(adapter)).not.toContain(KEY);
    expect(inspect(adapter, { showHidden: true, depth: 10 })).not.toContain(KEY);
    expect(Object.values(adapter)).not.toContain(KEY);
  });
});

describe('one pinned dispatch, usage and policy boundary', () => {
  it('passes the nonstream abort signal, output cap, no retries and sanitized quota headers', async () => {
    const signal = new AbortController().signal;
    reply(completion('hi', { prompt_tokens: 17, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } }), {
      'x-ratelimit-remaining-tokens': '200', authorization: `Bearer ${KEY}`, 'x-request-id': KEY,
    });
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', systemPrompt: 'system', signal });
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ apiKey: KEY, maxRetries: 0, logLevel: 'off', fetchOptions: { redirect: 'error' } }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ model: 'test-model', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }], max_completion_tokens: 512, stream: false }, { signal, maxRetries: 0, timeout: 4000 });
    expect(result).toMatchObject({ provider: 'GROQ', model: 'test-model', content: 'hi', usage: { inputTokens: 17, outputTokens: 3 }, completeUsage: true, cachedInputTokens: 8, finishReason: 'stop', rateLimitHeaders: { 'x-ratelimit-remaining-tokens': '200' } });
  });

  it('outbound transport drops inherited SDK credentials and permits only the exact completion URL', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    reply(completion());
    await new OpenAiCompatProvider(config()).execute('hello');
    const options = construct.mock.calls[0][0];
    expect(options).toMatchObject({ organization: null, project: null, adminAPIKey: null, webhookSecret: null });
    const signal = new AbortController().signal;
    await options.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', body: '{}', signal, headers: { Authorization: 'wrong-account', 'OpenAI-Organization': 'private-org', 'Cookie': 'private-cookie' }, redirect: 'follow' });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', body: '{}', signal, redirect: 'error',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    await expect(options.fetch('https://evil.example/chat/completions', { method: 'POST' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(options.fetch('https://api.groq.com/openai/v1/chat/completions?key=private', { method: 'POST' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(options.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'GET' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { prompt_tokens: 12 }, { completion_tokens: 4 }, { prompt_tokens: null, completion_tokens: 1 }, { prompt_tokens: '2', completion_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: NaN, completion_tokens: 1 }, { prompt_tokens: 1.5, completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: Infinity }])('never invents or zero-fills usage from %j', async (usage) => {
    reply(completion('hi', usage));
    const result = await new OpenAiCompatProvider(config()).execute('hello');
    expect(result.completeUsage).toBe(false);
    expect(result.usage).toBeUndefined();
  });

  it('accepts measured zero counts and rejects cache hits above input count', async () => {
    reply(completion('hi', { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 2 }));
    const result = await new OpenAiCompatProvider(config()).execute('hello');
    expect(result).toMatchObject({ usage: { inputTokens: 0, outputTokens: 0 }, completeUsage: true });
    expect(result.cachedInputTokens).toBeUndefined();
  });

  it('uses provider extension usage in a nonstream reply', async () => {
    reply({ ...completion(), x_groq: { usage: { prompt_tokens: 9, completion_tokens: 2 } } });
    expect(await new OpenAiCompatProvider(config()).execute('hello')).toMatchObject({ usage: { inputTokens: 9, outputTokens: 2 }, completeUsage: true });
  });

  it('enforces policy before both modes and again on reuse', async () => {
    const adapter = new OpenAiCompatProvider(config());
    reply(completion());
    await adapter.execute('allowed');
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
    for (const onChunk of [undefined, vi.fn()]) {
      const error = await failure(runWithInferenceScope('free-modules', () => adapter.executeTurn({ prompt: 'blocked', onChunk })));
      expect(error.code).toBe('POLICY_BLOCKED');
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('nonstream execute forwards its optional signal without changing the existing AIProvider signature', async () => {
    reply(completion());
    const signal = new AbortController().signal;
    await new OpenAiCompatProvider(config()).execute('hello', undefined, 'test-model', undefined, undefined, signal);
    expect(create.mock.calls[0][1].signal).toBe(signal);
  });

  it('rejects an image, schema or changed pinned model without dispatching', async () => {
    const adapter = new OpenAiCompatProvider(config());
    for (const call of [
      () => adapter.execute('hello', undefined, undefined, undefined, ['image']),
      () => adapter.execute('hello', {}),
      () => adapter.execute('hello', undefined, 'different-model'),
      () => adapter.executeStream('hello', undefined, vi.fn(), 'different-model'),
    ]) expect((await failure(call())).code).toBe('INVALID_REQUEST');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['glm-4.7-flash', 'glm-4.5-flash'])('GLM %s uses one pinned completion, no unverified stream options, and final-chunk usage', async model => {
    stream([chunk('Flash answer', { choices: [{ delta: { content: 'Flash answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 3 } })], {}, false);
    const onChunk = vi.fn();
    const provider = new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model }));
    const result = await provider.executeTurn({ prompt: 'hello', onChunk });
    expect(result).toMatchObject({ provider: 'GLM', model, content: 'Flash answer', completeUsage: true, usage: { inputTokens: 20, outputTokens: 3 } });
    expect(create).toHaveBeenCalledExactlyOnceWith({ model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 512, stream: true, thinking: { type: 'disabled' } }, expect.objectContaining({ maxRetries: 0 }));
    expect(onChunk.mock.calls).toEqual([['Flash answer']]);
  });

  it.each([
    ['sensitive', 'SAFETY_REFUSAL'],
    ['model_context_window_exceeded', 'INVALID_REQUEST'],
    ['network_error', 'NETWORK'],
  ])('GLM finish reason %s is classified as %s before any content escapes', async (finish_reason, code) => {
    for (const streaming of [false, true]) {
      const choices = [{ message: { content: 'Untrusted terminal content' }, delta: { content: 'Untrusted terminal content' }, finish_reason }];
      if (streaming) stream([{ choices }], {}, false); else reply({ choices });
      const onChunk = vi.fn();
      const error = await failure(new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-4.7-flash' })).executeTurn({ prompt: 'hello', ...(streaming ? { onChunk } : {}) }));
      expect(error.code).toBe(code);
      expect(onChunk).not.toHaveBeenCalled();
    }
  });

  it('GLM never emits reasoning_content and reads bounded reported cached input tokens', async () => {
    stream([
      { choices: [{ delta: { reasoning_content: 'Private reasoning must not leave this adapter' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'Visible answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 3, cached_tokens: 10 } },
    ], {}, false);
    const onChunk = vi.fn();
    const result = await new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5-flash' })).executeTurn({ prompt: 'hello', onChunk });
    expect(onChunk.mock.calls).toEqual([['Visible answer']]);
    expect(result).toMatchObject({ content: 'Visible answer', completeUsage: true, cachedInputTokens: 10 });
    expect(JSON.stringify(result)).not.toContain('Private reasoning');
    expect(create.mock.calls[0][0].thinking).toEqual({ type: 'disabled' });
  });

  it('both GLM Flash rungs use the same single credential with no pool rotation', async () => {
    reply(completion());
    for (const model of ['glm-4.7-flash', 'glm-4.5-flash']) {
      await new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model })).execute('hello');
    }
    expect(construct.mock.calls.map(([options]) => options.apiKey)).toEqual([KEY, KEY]);
    expect(create.mock.calls.map(([body]) => body.model)).toEqual(['glm-4.7-flash', 'glm-4.5-flash']);
    expect(() => new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', key: 'first,second' }))).toThrow('CONFIGURATION');
    expect(() => new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/coding/paas/v4' }))).toThrow('CONFIGURATION');
  });

  it.each([
    ['1301', 'SAFETY_REFUSAL', false],
    [1301, 'SAFETY_REFUSAL', false],
    ['1302', 'RATE_LIMIT', true],
    ['1305', 'SERVER', true],
    ['1113', 'QUOTA_EXHAUSTED', false],
    ['1308', 'QUOTA_EXHAUSTED', false],
    ['1310', 'QUOTA_EXHAUSTED', false],
    ['1313', 'QUOTA_EXHAUSTED', false],
  ])('documented GLM error %s maps to %s without leaking provider material', async (code, expected, retryable) => {
    withResponse.mockRejectedValue({ status: 429, error: { code, message: KEY }, headers: { 'retry-after': '30', 'authorization': KEY } });
    const error = await failure(new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-4.7-flash' })).execute('hello'));
    expect(error).toMatchObject({ code: expected, retryable, retryAfterMs: 30000, rateLimitHeaders: { 'retry-after': '30' } });
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it.each([false, true])('a statusless streamed GLM safety code is terminal even after delivered text: %s', async afterText => {
    const controller = new AbortController();
    reply({ controller, async *[Symbol.asyncIterator]() {
      if (afterText) yield chunk('Partial answer');
      throw Object.assign(new Error(KEY), { code: '1301' });
    } });
    const onChunk = vi.fn();
    const error = await failure(new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-4.7-flash' })).executeTurn({ prompt: 'hello', onChunk }));
    expect(error).toMatchObject({ code: 'SAFETY_REFUSAL', retryable: false });
    expect(onChunk.mock.calls).toEqual(afterText ? [['Partial answer']] : []);
    expect(controller.signal.aborted).toBe(true);
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('numeric Z.AI safety codes never classify unrelated providers', async () => {
    withResponse.mockRejectedValue({ error: { code: '1301', message: KEY } });
    expect((await failure(new OpenAiCompatProvider(config()).execute('hello'))).code).toBe('NETWORK');
  });

  it('GLM auth diagnostics name only the dedicated environment variable', async () => {
    withResponse.mockRejectedValue({ status: 401, message: KEY });
    const provider = new OpenAiCompatProvider(config({ provider: 'GLM', baseURL: 'https://api.z.ai/api/paas/v4', envName: 'FREE_CHAIN_GLM_API_KEY' }));
    const error = await failure(provider.execute('hello'));
    expect(error).toMatchObject({ code: 'AUTH', credentialEnv: 'FREE_CHAIN_GLM_API_KEY' });
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('DeepSeek HTTP 402 marks an exhausted account rather than a malformed user request', async () => {
    withResponse.mockRejectedValue({ status: 402, message: KEY });
    const error = await failure(new OpenAiCompatProvider(config({ provider: 'DEEPSEEK', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' })).execute('hello'));
    expect(error).toMatchObject({ code: 'QUOTA_EXHAUSTED', status: 402, retryable: false });
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('DeepSeek always disables thinking and preserves separate cache-hit usage', async () => {
    reply(completion('hi', { prompt_tokens: 20, completion_tokens: 3, prompt_cache_hit_tokens: 12 }));
    const adapter = new OpenAiCompatProvider(config({ provider: 'DEEPSEEK', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' }));
    expect(await adapter.execute('hello')).toMatchObject({ cachedInputTokens: 12 });
    expect(create.mock.calls[0][0]).toMatchObject({ thinking: { type: 'disabled' }, model: 'deepseek-flash', max_tokens: 512 });
  });

  it.each(['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'apiKey', 'headers', 'tools', 'n', '__proto__'])('extraBody cannot override %s', (name) => {
    expect(() => new OpenAiCompatProvider(config({ extraBody: { [name]: 'unsafe' } }))).toThrow('CONFIGURATION');
  });

  it('safe generation options work, but reasoning cannot be reenabled', async () => {
    const adapter = new OpenAiCompatProvider(config({ extraBody: { temperature: 0.1, top_p: 0.9, reasoning_effort: 'none' } }));
    reply(completion());
    await adapter.execute('hello');
    expect(create.mock.calls[0][0]).toMatchObject({ temperature: 0.1, top_p: 0.9, reasoning_effort: 'none' });
    expect(() => new OpenAiCompatProvider(config({ extraBody: { thinking: { type: 'enabled' } } }))).toThrow('CONFIGURATION');
  });
});

describe('streaming fidelity and cancellation', () => {
  it('retains usage from the last content chunk, not only an empty tail', async () => {
    stream([chunk('hel'), chunk('lo', { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 6, completion_tokens: 2, prompt_cache_hit_tokens: 3 } })], { 'x-ratelimit-reset-tokens': '1m2.5s' });
    const onChunk = vi.fn();
    const signal = new AbortController().signal;
    const result = await new OpenAiCompatProvider(config({ streamUsage: true })).executeTurn({ prompt: 'hello', onChunk, signal });
    expect(result).toMatchObject({ content: 'hello', usage: { inputTokens: 6, outputTokens: 2 }, completeUsage: true, cachedInputTokens: 3, finishReason: 'stop', rateLimitHeaders: { 'x-ratelimit-reset-tokens': '1m2.5s' } });
    expect(onChunk.mock.calls).toEqual([['hel'], ['lo']]);
    expect(create.mock.calls[0][0].stream_options).toEqual({ include_usage: true });
    expect(create.mock.calls[0][1].signal).toBe(signal);
  });

  it.each([undefined, { prompt_tokens: 6, completion_tokens: 2 }])('clean EOF without terminal reason cannot release a paid reservation, even with usage %j', async usage => {
    const upstream = stream([chunk('partial answer', { usage })], {}, false);
    const onChunk = vi.fn(); const settleReservation = vi.fn();
    const promise = new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk }).then(result => { settleReservation(result.usage); return result; });
    const error = await failure(promise);
    expect(error.code).toBe('NETWORK');
    expect(onChunk.mock.calls).toEqual([['partial answer']]);
    expect(settleReservation).not.toHaveBeenCalled();
    expect(upstream.signal.aborted).toBe(true);
  });

  it('an unknown finish reason cannot authorize settlement', async () => {
    stream([chunk('partial answer', { choices: [{ delta: { content: 'partial answer' }, finish_reason: 'unexpected' }], usage: { prompt_tokens: 6, completion_tokens: 2 } })], {}, false);
    expect((await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() }))).code).toBe('NETWORK');
  });

  it('a valid length finish reason is terminal and preserves exact reported totals', async () => {
    stream([chunk('bounded answer', { choices: [{ delta: { content: 'bounded answer' }, finish_reason: 'length' }], usage: { prompt_tokens: 6, completion_tokens: 2 } })], {}, false);
    expect(await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() })).toMatchObject({ content: 'bounded answer', finishReason: 'length', completeUsage: true, usage: { inputTokens: 6, outputTokens: 2 } });
  });

  it('does not mistake an intermediate usage count for final stream usage', async () => {
    stream([chunk('one', { usage: { prompt_tokens: 5, completion_tokens: 1 } }), chunk('two')]);
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() });
    expect(result.content).toBe('onetwo');
    expect(result.completeUsage).toBe(false);
    expect(result.usage).toBeUndefined();
  });

  it('invalid final usage cannot reuse an earlier complete count', async () => {
    stream([chunk('one', { usage: { prompt_tokens: 5, completion_tokens: 1 } }), { choices: [], usage: { prompt_tokens: 5 } }]);
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() });
    expect(result.completeUsage).toBe(false);
    expect(result.usage).toBeUndefined();
  });

  it('retains tail-only usage and ignores subsequent missing usage', async () => {
    stream([chunk('hi'), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1 } }, { choices: [] }]);
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() });
    expect(result).toMatchObject({ content: 'hi', usage: { inputTokens: 10, outputTokens: 1 }, completeUsage: true });
    expect(create.mock.calls[0][0]).not.toHaveProperty('stream_options');
  });

  it('accepts Groq extension usage on a final chunk', async () => {
    stream([chunk('hi'), { choices: [{ delta: {}, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 10, completion_tokens: 1 } } }]);
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() });
    expect(result).toMatchObject({ usage: { inputTokens: 10, outputTokens: 1 }, completeUsage: true });
  });

  it('a Groq embedded error is not a successful answer', async () => {
    stream([chunk('partial'), { choices: [], x_groq: { error: { code: 'rate_limit_exceeded', message: KEY } } }]);
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() }));
    expect(error.code).toBe('RATE_LIMIT');
    expect(inspect(error)).not.toContain(KEY);
  });

  it('unknown Groq embedded errors are sanitized server failures, never success', async () => {
    stream([chunk('partial'), { choices: [], x_groq: { error: KEY } }]);
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: vi.fn() }));
    expect(error.code).toBe('SERVER');
    expect(inspect(error)).not.toContain(KEY);
  });

  it('executeStream preserves the existing string-returning contract', async () => {
    stream([chunk('hello')]);
    expect(await new OpenAiCompatProvider(config()).executeStream('hi', undefined, vi.fn(), 'test-model')).toBe('hello');
  });

  it.each([{ chunks: [] }, { chunks: [chunk('   ')] }])('rejects empty and whitespace-only streams', async ({ chunks }) => {
    stream(chunks);
    const onChunk = vi.fn();
    expect((await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk }))).code).toBe('EMPTY_RESPONSE');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('holds initial whitespace until actual text, then preserves the complete prefix exactly once', async () => {
    stream([chunk('  '), chunk('\n'), chunk('hello'), chunk(' '), chunk('there')]);
    const onChunk = vi.fn();
    const result = await new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk });
    expect(result.content).toBe('  \nhello there');
    expect(onChunk.mock.calls).toEqual([['  \nhello'], [' '], ['there']]);
  });

  it('does not start a request after abort', async () => {
    const controller = new AbortController(); controller.abort(KEY);
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', signal: controller.signal }));
    expect(error).toMatchObject({ code: 'ABORTED', name: 'AbortError', retryable: false });
    expect(inspect(error)).not.toContain(KEY);
    expect(create).not.toHaveBeenCalled();
  });

  it('aborting during a chunk cancels upstream and emits no more text', async () => {
    const upstream = stream([chunk('one'), chunk('two')]);
    const caller = new AbortController();
    const onChunk = vi.fn(() => caller.abort(KEY));
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk, signal: caller.signal }));
    expect(error.code).toBe('ABORTED');
    expect(onChunk.mock.calls).toEqual([['one']]);
    expect(upstream.signal.aborted).toBe(true);
  });

  it('aborting a nonstream response still fails instead of delivering an abandoned reply', async () => {
    const controller = new AbortController();
    withResponse.mockImplementation(async () => { controller.abort(KEY); return { data: completion(), response: { headers: new Headers() } }; });
    expect((await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', signal: controller.signal }))).code).toBe('ABORTED');
  });

  it('callback failure closes the stream and never leaks the callback error', async () => {
    const upstream = stream([chunk('one'), chunk('two')]);
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk: () => { throw new Error(KEY); } }));
    expect(upstream.signal.aborted).toBe(true);
    expect(inspect(error, { depth: 10 })).not.toContain(KEY);
    expect(error).not.toHaveProperty('cause');
  });
});

describe('safe failure classification', () => {
  it('the public error constructor also sanitizes metadata and cannot be mutated later', () => {
    const error = new FreeChainProviderError('AUTH', { status: 401, rateLimitHeaders: { authorization: KEY, 'retry-after': KEY }, credentialEnv: KEY });
    expect(error.rateLimitHeaders).toEqual({});
    expect(error.credentialEnv).toBeUndefined();
    expect(() => { Object.assign(error, { message: KEY }); }).toThrow();
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(inspect(error)).not.toContain(KEY);
  });

  it.each([
    [401, undefined, 'AUTH'], [403, undefined, 'AUTH'], [429, undefined, 'RATE_LIMIT'],
    [429, 'insufficient_quota', 'QUOTA_EXHAUSTED'], [404, undefined, 'MODEL_UNAVAILABLE'],
    [400, 'model_not_found', 'MODEL_UNAVAILABLE'], [400, undefined, 'INVALID_REQUEST'],
    [503, undefined, 'SERVER'], [504, undefined, 'TIMEOUT'], [408, undefined, 'TIMEOUT'],
    [400, 'content_policy_violation', 'SAFETY_REFUSAL'],
  ])('classifies HTTP %s / %s without retaining provider data', async (status, code, expected) => {
    const logs = vi.spyOn(console, 'error');
    withResponse.mockRejectedValue(Object.assign(new Error(KEY), { status, code, headers: { authorization: KEY, 'set-cookie': KEY }, error: { message: KEY }, request: { apiKey: KEY }, cause: new Error(KEY) }));
    const error = await failure(new OpenAiCompatProvider(config({ envName: 'FREE_CHAIN_GROQ_API_KEY' })).execute('hello'));
    expect(error.code).toBe(expected);
    expect(error.status).toBe(status);
    expect(error.rateLimitHeaders).toEqual({});
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(KEY);
    expect(error).not.toHaveProperty('cause');
    expect(logs).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    if (expected === 'AUTH') expect(error.credentialEnv).toBe('FREE_CHAIN_GROQ_API_KEY');
  });

  it.each([['APIConnectionTimeoutError', 'TIMEOUT'], ['APIUserAbortError', 'ABORTED'], ['AbortError', 'ABORTED'], ['APIConnectionError', 'NETWORK']])('classifies SDK %s', async (name, expected) => {
    withResponse.mockRejectedValue(Object.assign(new Error(KEY), { name }));
    expect((await failure(new OpenAiCompatProvider(config()).execute('hello'))).code).toBe(expected);
  });

  it('a constructor failure is sanitized too', async () => {
    construct.mockImplementationOnce(() => { throw new Error(KEY); });
    const error = await failure(new OpenAiCompatProvider(config()).execute('hello'));
    expect(error.code).toBe('NETWORK');
    expect(inspect(error)).not.toContain(KEY);
  });

  it('sanitizes counter/reset values even on otherwise allowed quota headers', async () => {
    withResponse.mockRejectedValue({ status: 429, headers: new Headers({
      'x-ratelimit-remaining-tokens': KEY, 'x-ratelimit-reset-tokens': `1m ${KEY}`,
      'retry-after': KEY, date: KEY, 'x-ratelimit-limit-requests': '500',
      authorization: KEY, 'x-request-id': KEY, 'set-cookie': KEY,
    }) });
    const error = await failure(new OpenAiCompatProvider(config()).execute('hello'));
    expect(error.rateLimitHeaders).toEqual({ 'x-ratelimit-limit-requests': '500' });
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('parses seconds and HTTP-date Retry-After relative to the server clock', async () => {
    for (const [headers, expected] of [
      [{ 'retry-after': '12.5' }, 12500],
      [{ 'retry-after': 'Thu, 22 Oct 2026 17:11:00 GMT', date: 'Thu, 22 Oct 2026 17:10:00 GMT' }, 60000],
    ] as const) {
      withResponse.mockRejectedValue({ status: 429, headers });
      expect((await failure(new OpenAiCompatProvider(config()).execute('hello'))).retryAfterMs).toBe(expected);
    }
  });

  it.each(['', '   ', null])('a blank completion is a failure', async (content) => {
    reply(completion(content));
    expect((await failure(new OpenAiCompatProvider(config()).execute('hello'))).code).toBe('EMPTY_RESPONSE');
  });

  it.each([
    { message: { content: '', refusal: KEY }, finish_reason: 'stop' },
    { message: { content: null }, finish_reason: 'content_filter' },
    { message: { content: null }, finish_reason: 'SAFETY' },
  ])('refusals are terminal, not empty-response retries', async (choice) => {
    reply({ choices: [choice] });
    const error = await failure(new OpenAiCompatProvider(config()).execute('hello'));
    expect(error).toMatchObject({ code: 'SAFETY_REFUSAL', retryable: false });
    expect(inspect(error)).not.toContain(KEY);
  });

  it.each([
    { delta: { content: '', refusal: KEY }, finish_reason: null },
    { delta: {}, finish_reason: 'content_filter' },
    { delta: {}, finish_reason: 'PROHIBITED_CONTENT' },
  ])('streaming refusals stop upstream and never emit their text', async (choice) => {
    const upstream = stream([{ choices: [choice] }]);
    const onChunk = vi.fn();
    const error = await failure(new OpenAiCompatProvider(config()).executeTurn({ prompt: 'hello', onChunk }));
    expect(error).toMatchObject({ code: 'SAFETY_REFUSAL', retryable: false });
    expect(onChunk).not.toHaveBeenCalled();
    expect(upstream.signal.aborted).toBe(true);
  });
});
