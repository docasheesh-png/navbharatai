import { afterEach, describe, expect, it, vi } from 'vitest';
import { isModelNotFound, isOfficialChatUrl, listProviderModels, OfficialTestChatError, probeChatHostReachability, runOfficialOpenAiCompatTest, runOfficialVertexTest } from './testChatBotOfficial';

describe('admin official OpenAI-compat helper', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects a URL that is not on the official allow-list', async () => {
    await expect(runOfficialOpenAiCompatTest({
      url: 'https://evil.example/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'x',
      messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal,
    })).rejects.toMatchObject({ providerCode: 'url-not-allowlisted' });
  });

  it('sends OpenRouter max_price 0 and no fallbacks when calling the public chat endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'x-request-id': 'or-1' }),
      text: async () => JSON.stringify({
        model: 'alpha/cheap:free',
        choices: [{ message: { content: 'Hello from OpenRouter' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      }),
    });
    vi.stubGlobal('fetch', fetchImpl);
    const result = await runOfficialOpenAiCompatTest({
      url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'alpha/cheap:free',
      messages: [{ role: 'user', content: 'Synthetic test question' }], signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ content: 'Hello from OpenRouter', model: 'alpha/cheap:free' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'alpha/cheap:free', stream: false, max_tokens: 1024,
      provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
    });
  });

  it('calls the official Router One endpoint once, with no OpenRouter price guard and no redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'x-request-id': 'r1-1' }),
      text: async () => JSON.stringify({
        model: 'deepseek-v4.1-flash',
        choices: [{ message: { content: 'Hello from Router One' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      }),
    });
    vi.stubGlobal('fetch', fetchImpl);
    const result = await runOfficialOpenAiCompatTest({
      url: 'https://api.router.one/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'Synthetic test question' }], signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ content: 'Hello from Router One', model: 'deepseek-v4.1-flash' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.router.one/v1/chat/completions');
    expect(init.redirect).toBe('error');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'deepseek-v4.1-flash', stream: false, max_tokens: 1024 });
    expect(body.provider).toBeUndefined();
  });

  it('never calls a Router One look-alike host', async () => {
    await expect(runOfficialOpenAiCompatTest({
      url: 'https://api.router.one.evil.example/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'x',
      messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal,
    })).rejects.toMatchObject({ providerCode: 'url-not-allowlisted' });
  });

  it('keeps the OpenRouter zero-price guard unless the caller explicitly reserved for a paid model', async () => {
    const reply = { ok: true, headers: new Headers(), text: async () => JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' } }] }) };
    const fetchImpl = vi.fn().mockResolvedValue(reply);
    vi.stubGlobal('fetch', fetchImpl);
    const base = { url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'nvidia/nemotron-3-super-120b-a12b',
      messages: [{ role: 'user' as const, content: 'hi' }], signal: new AbortController().signal };
    await runOfficialOpenAiCompatTest(base);
    await runOfficialOpenAiCompatTest({ ...base, allowPaid: false });
    await runOfficialOpenAiCompatTest({ ...base, allowPaid: true });
    const bodies = fetchImpl.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].provider).toMatchObject({ max_price: { prompt: 0, completion: 0 } });
    expect(bodies[1].provider).toMatchObject({ max_price: { prompt: 0, completion: 0 } });
    expect(bodies[2].provider).toBeUndefined();
  });

  it('server extra fields never override the model, messages, token bound or stream flag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), text: async () => JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' } }] }) });
    vi.stubGlobal('fetch', fetchImpl);
    await runOfficialOpenAiCompatTest({
      url: 'https://api.surplusintelligence.ai/min90/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal,
      extraBody: { si_route: { objective: 'price' }, model: 'other', max_tokens: 999999, stream: true },
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ si_route: { objective: 'price' }, model: 'deepseek-v4.1-flash', max_tokens: 1024, stream: false });
  });

  it.each([
    'https://api.kimi.com/coding/v1/chat/completions',
    'https://api.moonshot.ai/v1/chat/completions',
    'https://api.z.ai/api/paas/v4/chat/completions',
    'https://integrate.api.nvidia.com/v1/chat/completions',
    'https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions',
    'https://api.surplusintelligence.ai/min90/v1/chat/completions',
  ])('allows the official endpoint %s', url => {
    expect(isOfficialChatUrl(url)).toBe(true);
  });

  it.each([
    'http://api.z.ai/api/paas/v4/chat/completions',
    'https://api.z.ai:8443/api/paas/v4/chat/completions',
    'https://user:pass@api.z.ai/api/paas/v4/chat/completions',
    'https://api.z.ai/api/paas/v4/models',
    'https://api.z.ai/api/paas/v4/chat/completions?x=1',
    'https://bedrock-runtime.evil.amazonaws.com.example/openai/v1/chat/completions',
    'https://bedrock-runtime.us-west-2.amazonaws.com.evil.example/openai/v1/chat/completions',
    'https://kimi.com.evil.example/v1/chat/completions',
    'not a url',
  ])('refuses %s', url => {
    expect(isOfficialChatUrl(url)).toBe(false);
  });

  it('calls Vertex once with the typed model and maps the assistant role to model', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'Hello from Vertex', modelVersion: 'gemini-2.5-pro-001', usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 } });
    const result = await runOfficialVertexTest({ client: { models: { generateContent } }, model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], signal: new AbortController().signal });
    expect(result).toEqual({ content: 'Hello from Vertex', model: 'gemini-2.5-pro-001', usage: { inputTokens: 4, outputTokens: 3 } });
    expect(generateContent).toHaveBeenCalledOnce();
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe('gemini-2.5-pro');
    expect(request.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(request.config.maxOutputTokens).toBe(1024);
  });

  it('reports a Vertex failure as an official error with its status', async () => {
    const generateContent = vi.fn().mockRejectedValue(Object.assign(new Error('PERMISSION_DENIED'), { status: 403 }));
    await expect(runOfficialVertexTest({ client: { models: { generateContent } }, model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'a' }], signal: new AbortController().signal })).rejects.toMatchObject({ classificationHint: 'auth', httpStatus: 403 });
    await expect(runOfficialVertexTest({ client: null, model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'a' }], signal: new AbortController().signal })).rejects.toMatchObject({ providerCode: 'configuration' });
  });

  describe('streamed replies and a body that never finishes (admin report 2026-11-15: Router One HTTP 200, 90003 ms, "invalid-json")', () => {
    const sse = (chunks: string[], { hang = false } = {}) => new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        if (!hang) controller.close();
      },
    });
    const sseResponse = (body: ReadableStream<Uint8Array>) => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'x-request-id': 'r1-req' }), body,
      text: async () => { throw new Error('text() must not be used for a stream'); },
    });
    const routerOne = { url: 'https://api.router.one/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user' as const, content: 'hi' }] };

    it('asks Router One for a stream and joins the deltas, model and usage into one reply', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(sseResponse(sse([
        'data: {"model":"deepseek-v4.1-flash","choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        '\ndata: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ])));
      vi.stubGlobal('fetch', fetchImpl);
      const result = await runOfficialOpenAiCompatTest({ ...routerOne, signal: new AbortController().signal, stream: true });
      expect(result).toEqual({ content: 'Hello', model: 'deepseek-v4.1-flash', usage: { inputTokens: 7, outputTokens: 2 } });
      const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
      expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true }, max_tokens: 1024 });
    });

    it('reports activity on every stream event, reasoning included, so a caller can tell "silent" from "still writing"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n',
      ]))));
      const onActivity = vi.fn();
      expect((await runOfficialOpenAiCompatTest({ ...routerOne, signal: new AbortController().signal, stream: true, onActivity })).content).toBe('ok');
      expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('reads a stream even when the provider ignores stream: false', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n']))));
      expect((await runOfficialOpenAiCompatTest({ ...routerOne, signal: new AbortController().signal })).content).toBe('ok');
    });

    it('reports the exact admin failure — headers 200, body never finished — as a timeout, not invalid-json', async () => {
      const abort = new AbortController();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'b7622d6b7fd547d8c968e9e5740f770b' }),
        text: () => new Promise((_, reject) => {
          if (abort.signal.aborted) reject(new Error('aborted'));
          else abort.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      }));
      const pending = runOfficialOpenAiCompatTest({ ...routerOne, signal: abort.signal });
      abort.abort();
      const error = await pending.catch(value => value) as OfficialTestChatError;
      expect(error).toBeInstanceOf(OfficialTestChatError);
      expect(error).toMatchObject({ classificationHint: 'timeout', httpStatus: 200, providerCode: 'body-timeout', providerRequestId: 'b7622d6b7fd547d8c968e9e5740f770b' });
      expect(error.providerCode).not.toBe('invalid-json');
      expect(error.providerMessage).toContain('did not finish');
    });

    it('reports a stream cut off by the time limit as a timeout that says how much had arrived', async () => {
      const abort = new AbortController();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          abort.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(body)));
      const pending = runOfficialOpenAiCompatTest({ ...routerOne, signal: abort.signal, stream: true });
      await new Promise(resolve => setTimeout(resolve, 10));
      abort.abort();
      const error = await pending.catch(value => value) as OfficialTestChatError;
      expect(error).toMatchObject({ classificationHint: 'timeout', providerCode: 'body-timeout' });
      expect(error.providerMessage).toContain('7 characters');
    });

    it('surfaces an error event inside the stream, with the key redacted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse(['data: {"error":{"message":"upstream refused synthetic-key-value"}}\n\n']))));
      const error = await runOfficialOpenAiCompatTest({ ...routerOne, signal: new AbortController().signal, stream: true }).catch(value => value) as OfficialTestChatError;
      expect(error).toMatchObject({ providerCode: 'stream-error' });
      expect(error.providerMessage).not.toContain('synthetic-key-value');
    });

    it('treats a stream with no text as empty, not as success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse(['data: [DONE]\n']))));
      await expect(runOfficialOpenAiCompatTest({ ...routerOne, signal: new AbortController().signal, stream: true })).rejects.toMatchObject({ providerCode: 'empty' });
    });
  });

  describe('a reasoning model that thinks but does not answer (admin report 2026-11-15, Router One deepseek-v4.1-flash)', () => {
    const routerOne = { url: 'https://api.router.one/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user' as const, content: 'bharat me kitni nadiyan hai?' }], signal: new AbortController().signal };
    const jsonReply = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json', 'x-request-id': '6acc8c0bdf6593a255a04fe989c84f45' }),
      text: async () => JSON.stringify(body) });

    it('names the exact admin reply — empty content, reasoning only, length — instead of a bare "empty"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonReply({
        id: 'resp_20094', object: 'chat.completion', model: 'deepseek-v4.1-flash',
        choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'We need answer in Hindi. Question: how many rivers in India…' } }],
      })));
      const error = await runOfficialOpenAiCompatTest({ ...routerOne, maxTokens: 1024 }).catch(value => value) as OfficialTestChatError;
      expect(error).toMatchObject({ classificationHint: 'empty', providerCode: 'reasoning-only', providerRequestId: '6acc8c0bdf6593a255a04fe989c84f45' });
      expect(error.providerMessage).toContain('only its reasoning');
      expect(error.providerMessage).toContain('1024-token limit');
    });

    it('sends the caller’s larger output bound so the model has room to answer', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonReply({ model: 'deepseek-v4.1-flash', choices: [{ message: { content: 'Lagbhag 400 se zyada nadiyan.' } }] }));
      vi.stubGlobal('fetch', fetchImpl);
      const result = await runOfficialOpenAiCompatTest({ ...routerOne, maxTokens: 8192 });
      expect(result.content).toBe('Lagbhag 400 se zyada nadiyan.');
      expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).max_tokens).toBe(8192);
    });

    it('keeps the page default and caps an absurd bound', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonReply({ choices: [{ message: { content: 'ok' } }] }));
      vi.stubGlobal('fetch', fetchImpl);
      await runOfficialOpenAiCompatTest(routerOne);
      await runOfficialOpenAiCompatTest({ ...routerOne, maxTokens: 10_000_000 });
      await runOfficialOpenAiCompatTest({ ...routerOne, maxTokens: -5 });
      const bounds = fetchImpl.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).max_tokens);
      expect(bounds).toEqual([1024, 16384, 1024]);
    });

    it('no longer cuts a long answer at 4,000 characters', async () => {
      const long = 'n'.repeat(9000);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonReply({ choices: [{ message: { content: long } }] })));
      expect((await runOfficialOpenAiCompatTest(routerOne)).content).toHaveLength(9000);
    });

    it('names a reasoning-only stream the same way', async () => {
      const body = new ReadableStream<Uint8Array>({ start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"thinking…"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n'));
        c.close();
      } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body, text: async () => '' }));
      const error = await runOfficialOpenAiCompatTest({ ...routerOne, stream: true, maxTokens: 8192 }).catch(value => value) as OfficialTestChatError;
      expect(error).toMatchObject({ providerCode: 'reasoning-only' });
      expect(error.providerMessage).toContain('8192-token limit');
    });

    it('a plain empty reply with no reasoning is still just "empty"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonReply({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })));
      await expect(runOfficialOpenAiCompatTest(routerOne)).rejects.toMatchObject({ providerCode: 'empty' });
    });
  });

  it('still throws OfficialTestChatError for a non-JSON OpenRouter failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, headers: new Headers(), text: async () => 'unauthorized',
    }));
    await expect(runOfficialOpenAiCompatTest({
      url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: 'synthetic-key-value', model: 'alpha/cheap:free',
      messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(OfficialTestChatError);
  });
});


describe('reachability check after a network failure (admin report 2026-11-16: BluesMinds 60 s timeout from Cloud Run, instant from a phone)', () => {
  it('says the host is reachable when /models answers, even with 401, and sends no key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":{"message":"Invalid token"}}', { status: 401 }));
    const text = await probeChatHostReachability('https://api.bluesminds.com/v1', fetchImpl as unknown as typeof fetch);
    expect(text).toContain('HTTP 401');
    expect(text).toContain('can reach the host');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.bluesminds.com/v1/models');
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
    expect(init.method).toBe('GET');
  });

  it('derives /models from a full chat-completions URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    await probeChatHostReachability('https://api.z.ai/api/paas/v4/chat/completions', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.z.ai/api/paas/v4/models');
  });

  it('says the host cannot be reached when /models also times out', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect(await probeChatHostReachability('https://api.bluesminds.com/v1', fetchImpl as unknown as typeof fetch)).toContain('cannot reach the host');
  });

  it('names a DNS or connection error code', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    expect(await probeChatHostReachability('https://api.bluesminds.com/v1', fetchImpl as unknown as typeof fetch)).toContain('ENOTFOUND');
  });

  it('never probes a non-https endpoint', async () => {
    const fetchImpl = vi.fn();
    expect(await probeChatHostReachability('http://api.example.invalid/v1', fetchImpl as unknown as typeof fetch)).toContain('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('model-not-found lists the models the key can use (admin report 2026-11-16: BluesMinds "No available channel for model z-ai/glm4.7")', () => {
  it('recognises the exact BluesMinds answer and common siblings', () => {
    expect(isModelNotFound('model_not_found', 'No available channel for model z-ai/glm4.7 under group default (distributor)')).toBe(true);
    expect(isModelNotFound(null, 'The model `x` does not exist')).toBe(true);
    expect(isModelNotFound('rate_limit', 'slow down')).toBe(false);
  });
  it('reads /models with the key, sent only to that endpoint, and returns ids only', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'z-ai/glm4.6', owned_by: 'x' }, { id: 'moonshotai/kimi-k2.6' }, { id: '<script>' }] }), { status: 200 }));
    const text = await listProviderModels('https://api.bluesminds.com/v1', 'synthetic-key-value', fetchImpl as unknown as typeof fetch);
    expect(text).toContain('z-ai/glm4.6');
    expect(text).toContain('moonshotai/kimi-k2.6');
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('synthetic-key-value');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.bluesminds.com/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-key-value');
    expect(init.redirect).toBe('error');
  });
  it('reports a refused list honestly and never calls a non-https endpoint', async () => {
    const refused = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await listProviderModels('https://api.bluesminds.com/v1', 'k-value', refused as unknown as typeof fetch)).toContain('HTTP 401');
    const never = vi.fn();
    expect(await listProviderModels('http://insecure.invalid/v1', 'k-value', never as unknown as typeof fetch)).toBe('');
    expect(never).not.toHaveBeenCalled();
  });
});
