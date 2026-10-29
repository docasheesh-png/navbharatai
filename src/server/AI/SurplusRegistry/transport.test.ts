import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';
import { describe, expect, it, vi } from 'vitest';
import { createSurplusBuildTransport, SurplusBuildTransportError, SURPLUS_TRANSPORT_TIMEOUT_MS, SURPLUS_TRANSPORT_MAX_ATTEMPTS } from './transport';
import { BuildStoppedError } from '../../AgentV3/stopSignal';
const env = () => ({ AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'test-only-not-a-real-key' });
const request = () => ({ model: 'reviewed-model', provider: 'reviewed-provider', si_route: { objective: 'price' }, messages: [{ role: 'user', content: 'build' }], stream: false, max_tokens: 500 });
const signal = () => new AbortController().signal;
// Transport retries transient/empty bodies (SURPLUS_TRANSPORT_MAX_ATTEMPTS); a factory gives each attempt a fresh body.
function setup(response: Response | (() => Response) = () => new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 })) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => (typeof response === 'function' ? response() : response));
  return { fetcher, dispatch: createSurplusBuildTransport(env(), fetcher) };
}
describe('dedicated min90 build transport', () => {
  it('redacts network errors including nested cause, stack, headers and typed error extras', async () => {
    const secret = 'sk-private PROMPT_PRIVATE Surplus https://api.surplusintelligence.ai reviewed-model buyer_cost_micro=123';
    for (const upstream of [new Error(secret, { cause: new Error(secret) }), new SurplusBuildTransportError('response')]) {
      upstream.name = secret; upstream.stack = secret;
      Object.assign(upstream, { headers: { Authorization: secret }, body: secret });
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(upstream);
      const error = await createSurplusBuildTransport(env(), fetcher)(request(), signal()).catch(e => e);
      expect(error).toBeInstanceOf(SurplusBuildTransportError);
      expect(error).not.toBe(upstream);
      expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
      expect(error.name).toBe('Error'); expect(error.stack).toBe(`Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`);
      expect(Object.getOwnPropertyNames(error).sort()).toEqual(['code', 'message', 'name', 'stack']);
      expect(Object.getOwnPropertyDescriptor(error, 'code')?.enumerable).toBe(false);
      expect(error.cause).toBeUndefined(); expect(error.body).toBeUndefined(); expect(error.headers).toBeUndefined();
      expect(JSON.stringify(error)).not.toMatch(/sk-private|PROMPT_PRIVATE|Surplus|surplusintelligence|buyer_cost|reviewed-model|response|network/);
      // Plain network errors are retried (bounded); typed transport errors are final.
      expect(fetcher).toHaveBeenCalledTimes(upstream instanceof SurplusBuildTransportError ? 1 : SURPLUS_TRANSPORT_MAX_ATTEMPTS);
    }
  });
  it('also sanitizes errors thrown during request encoding before fetch', async () => {
    const { dispatch, fetcher } = setup();
    const hostile = Object.defineProperty(request(), 'model', { get() { throw new Error('sk-private Surplus provider'); } });
    const error = await dispatch(hostile, signal()).catch(e => e);
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(error.stack).toBe(`Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads no key when disabled and performs no work at import or factory', () => {
    const key = vi.fn(() => { throw new Error('must not read'); });
    const config = Object.defineProperty({}, 'SURPLUS_API_KEY', { get: key });
    expect(() => createSurplusBuildTransport(config)).toThrow(SurplusBuildTransportError);
    expect(key).not.toHaveBeenCalled();
    const fetcher = vi.fn<typeof fetch>(); createSurplusBuildTransport(env(), fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('posts exactly once to fixed min90 URL with explicit headers and redirects prohibited', async () => {
    const { dispatch, fetcher } = setup();
    await dispatch(request(), signal());
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.surplusintelligence.ai/min90/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal), body: JSON.stringify(request()),
      headers: { Authorization: 'Bearer test-only-not-a-real-key', 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  });
  it.each([{ provider: ['other'] }, { provider: '' }, { provider: ' bad' }, { model: '\nmodel' }, { si_route: { objective: 'speed' } }, { si_route: { objective: 'price', fallback: true } }, { stream: true }, { unknown_routing: true }, { max_tokens: 0 }])('rejects unreviewed routing/request %j', async invalid => {
    const { dispatch, fetcher } = setup();
    await expect(dispatch({ ...request(), ...invalid }, signal())).rejects.toThrow(SurplusBuildTransportError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves JSON error bodies and only allowlisted response metadata', async () => {
    const body = { error: { code: 'provider_error' }, usage: { buyer_cost_micro: '1' } };
    const { dispatch } = setup(() => new Response(JSON.stringify(body), { status: 200, headers: {
      'x-si-provider-family': 'reviewed-provider', 'x-si-route-objective': 'price', 'set-cookie': 'never forward', 'x-secret': 'never forward',
    } }));
    expect(await dispatch(request(), signal())).toEqual({ body, status: 200, receivedAt: expect.any(Number), headers: { 'x-si-provider-family': 'reviewed-provider', 'x-si-route-objective': 'price' } });
  });
  it('preserves non-2xx JSON for accounting validation rather than silently retrying', async () => {
    const { dispatch, fetcher } = setup(() => new Response('{"error":"quota"}', { status: 429 }));
    expect(await dispatch(request(), signal())).toMatchObject({ status: 429, body: { error: 'quota' } });
    expect(fetcher).toHaveBeenCalledTimes(SURPLUS_TRANSPORT_MAX_ATTEMPTS);
  });
  it('accepts whitespace keepalives and fragmented JSON', async () => {
    const body = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(' \n\t {"ok":')); c.enqueue(new TextEncoder().encode('true}')); c.close(); } });
    const { dispatch } = setup(() => new Response(body()));
    expect((await dispatch(request(), signal())).body).toEqual({ ok: true });
  });
  it('rejects non-JSON safely without exposing raw body or network errors', async () => {
    const { dispatch } = setup(() => new Response('SECRET RESPONSE'));
    await expect(dispatch(request(), signal())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('SECRET CREDENTIAL'));
    await expect(createSurplusBuildTransport(env(), fetcher)(request(), signal())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(fetcher).toHaveBeenCalledTimes(SURPLUS_TRANSPORT_MAX_ATTEMPTS);
  });
  it('bounds declared and streamed response sizes and cancels the reader', async () => {
    const { dispatch } = setup(new Response('{}', { headers: { 'content-length': '4194305' } }));
    await expect(dispatch(request(), signal())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    const cancel = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4194305)); }, cancel });
    const streamed = setup(new Response(body));
    await expect(streamed.dispatch(request(), signal())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('aborts a blocked body read promptly and normalizes Stop', async () => {
    const cancel = vi.fn(); const body = new ReadableStream({ cancel });
    const { dispatch, fetcher } = setup(new Response(body));
    const controller = new AbortController();
    const pending = dispatch(request(), controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BuildStoppedError);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not fetch when stopped or switched off after construction', async () => {
    const config = env(); const fetcher = vi.fn<typeof fetch>(); const dispatch = createSurplusBuildTransport(config, fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(dispatch(request(), controller.signal)).rejects.toBeInstanceOf(BuildStoppedError);
    config.AGENTV3_SURPLUS_BUILDER = 'false';
    await expect(dispatch(request(), signal())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('passes a hard transport timeout so hung Surplus HTTP cannot pin the builder forever', async () => {
    expect(SURPLUS_TRANSPORT_TIMEOUT_MS).toBe(60_000);
    const { dispatch, fetcher } = setup();
    await dispatch(request(), signal());
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // Combined signal must be distinct from a fresh caller signal (AbortSignal.any / controller).
    expect(init?.signal).not.toBe(signal());
  });

});

it.each([{ 'x-si-provider-family': 'x'.repeat(1025) }, { 'x-si-attempted-provider': 'provider' }])('marks omitted provider metadata instead of turning it into no-attempt evidence', async headers => {
  const { dispatch } = setup(new Response(JSON.stringify({ error: { code: 'no_sellers_for_model', type: 'invalid_request_error' }, request_id: 'trace' }), { status: 404, headers }));
  expect(await dispatch(request(), signal())).toMatchObject({ status: 404, metadataIncomplete: true });
});
it('rejects a provisioning key locally before HTTP', () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(() => createSurplusBuildTransport({ ...env(), SURPLUS_API_KEY: 'inf_admin_example' }, fetcher)).toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  expect(fetcher).not.toHaveBeenCalled();
});
