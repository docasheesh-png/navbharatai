import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatSurplus, createSurplusChat, SURPLUS_BASE_URL, SURPLUS_MIN30_BASE_URL, SURPLUS_MIN90_BASE_URL, SURPLUS_TIMEOUT_MS, SurplusError } from './surplusClient';

const secret = 'test-secret-never-log-this';
const env = { SURPLUS_API_KEY: secret };
const ok = { choices: [{ message: { content: 'Hello!' } }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('isolated Surplus helper', () => {
  it('sends the expected OpenAI-compatible request and supports per-call model switching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(ok));
    const chat = createSurplusChat(env, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await chat('Hi')).text).toBe('Hello!');
    expect(fetcher.mock.calls[0][0]).toBe(`${SURPLUS_BASE_URL}/chat/completions`);
    const init = fetcher.mock.calls[0][1]!;
    expect(JSON.parse(init.body as string)).toEqual({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 2048, stream: false });
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${secret}`);
    expect(init.redirect).toBe('error');
    await chat('Hi', { model: 'another-supported-model' });
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).model).toBe('another-supported-model');
  });

  it.each([SURPLUS_MIN30_BASE_URL, SURPLUS_MIN90_BASE_URL])('accepts the documented minimum-discount path %s and environment model', async baseURL => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(ok));
    await createSurplusChat({ ...env, SURPLUS_BASE_URL: baseURL, SURPLUS_MODEL: 'custom-model' }, fetcher)('Hi');
    expect(fetcher.mock.calls[0][0]).toBe(`${baseURL}/chat/completions`);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).model).toBe('custom-model');
  });

  it.each([undefined, '', '  ', 'replace_with_your_surplus_api_key'])('rejects missing/placeholder key before network (%s)', key => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createSurplusChat({ SURPLUS_API_KEY: key }, fetcher)).toThrow(SurplusError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['http://api.surplusintelligence.ai/v1', '[API](https://api.surplusintelligence.ai/v1)', 'https://evil.test/v1', 'https://api.surplusintelligence.ai/v1/min30', 'https://api.surplusintelligence.ai/v1?key=secret', 'https://user:pass@api.surplusintelligence.ai/v1'])('rejects unsafe/invalid base %s', base => {
    expect(() => createSurplusChat({ ...env, SURPLUS_BASE_URL: base })).toThrow(SurplusError);
  });

  it.each([{}, { choices: [] }, { choices: [{ message: { content: null } }] }, { choices: [{ message: { content: '  ' } }] }])('rejects empty response %j', async body => {
    await expect(createSurplusChat(env, vi.fn<typeof fetch>().mockResolvedValue(json(body)))('Hi')).rejects.toMatchObject({ code: 'empty_response' });
  });

  it('rejects HTTP 200 error envelopes even if choices exist, without automatic retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ ...ok, error: { message: secret }, usage: { buyer_cost_micro: 42 } }));
    await expect(createSurplusChat(env, fetcher)('Hi')).rejects.toMatchObject({ code: 'provider', usage: { buyer_cost_micro: 42 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([[401, 'authentication'], [403, 'authentication'], [429, 'rate_limit'], [500, 'provider']])('sanitizes status %s, disables logging and retries', async (status, code) => {
    vi.stubEnv('OPENAI_LOG', 'debug');
    const logs = ['log', 'warn', 'error', 'debug', 'info'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ error: { message: `Leaked ${secret}` } }, Number(status)));
    const error = await createSurplusChat(env, fetcher)('private prompt').catch(e => e);
    expect(error).toMatchObject({ code });
    expect(`${error.stack}${JSON.stringify(error)}`).not.toContain(secret);
    expect(error.cause).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it('bounds timeout to 60 seconds with no retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = createSurplusChat(env, fetcher)('Hi').catch(e => e);
    await vi.advanceTimersByTimeAsync(SURPLUS_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sanitizes network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    await expect(createSurplusChat(env, fetcher)('Hi')).rejects.toMatchObject({ code: 'connection' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves exact decimal cost strings and strips arbitrary usage fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...ok, usage: { buyer_cost_micro: '12345678901234567890.123', total_tokens: 7, secret, prompt_tokens: -1 } }));
    expect(await createSurplusChat(env, fetcher)('Hi')).toEqual({ text: 'Hello!', usage: { buyer_cost_micro: '12345678901234567890.123', total_tokens: 7 } });
  });

  it('provides a text-only convenience helper', async () => {
    vi.stubEnv('SURPLUS_API_KEY', secret);
    vi.stubEnv('SURPLUS_BASE_URL', SURPLUS_BASE_URL);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json(ok)));
    expect(await chatSurplus('Hi')).toBe('Hello!');
  });

  it.each([0, -1, 8193, 1.5, NaN, Infinity])('rejects invalid output budget %s before network', async maxTokens => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSurplusChat(env, fetcher)('Hi', { maxTokens })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['', '  ', 'x'.repeat(65_537)])('rejects empty or oversized input before network', async input => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSurplusChat(env, fetcher)(input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not inherit unrelated OpenAI headers or credentials', async () => {
    vi.stubEnv('OPENAI_CUSTOM_HEADERS', 'Authorization: Bearer wrong-key\nX-Other-Secret: unrelated-secret');
    vi.stubEnv('OPENAI_ORG_ID', 'unrelated-org');
    vi.stubEnv('OPENAI_PROJECT_ID', 'unrelated-project');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(ok));
    await createSurplusChat(env, fetcher)('Hi');
    expect(Object.fromEntries(new Headers(fetcher.mock.calls[0][1]!.headers))).toEqual({
      authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json',
    });
  });

  it('sanitizes serialization failures before network', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const input = [{ role: 'user' as const, content: 'Hi', toJSON() { throw new Error(secret); } }];
    const error = await createSurplusChat(env, fetcher)(input).catch(e => e);
    expect(error).toMatchObject({ code: 'invalid_request' });
    expect(String(error.stack)).not.toContain(secret);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses browser usage', () => {
    vi.stubGlobal('window', {});
    expect(() => createSurplusChat(env)).toThrow(SurplusError);
  });
});

describe('disableThinking', () => {
  it('sends thinking disabled, and only when asked', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(ok));
    const chat = createSurplusChat(env, fetcher);
    await chat('Hi', { disableThinking: true });
    await chat('Hi');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ thinking: { type: 'disabled' } });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).not.toHaveProperty('thinking');
  });
  it('retries once without the flag when the supplier rejects it with 400', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: { message: 'unknown field' } }, 400)).mockResolvedValueOnce(json(ok));
    expect((await createSurplusChat(env, fetcher)('Hi', { disableThinking: true })).text).toBe('Hello!');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).not.toHaveProperty('thinking');
  });
});
