import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOfficialChatUrl, OfficialTestChatError, runOfficialOpenAiCompatTest, runOfficialVertexTest } from './testChatBotOfficial';

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
