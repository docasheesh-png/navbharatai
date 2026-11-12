import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficialTestChatError, runOfficialOpenAiCompatTest } from './testChatBotOfficial';

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
