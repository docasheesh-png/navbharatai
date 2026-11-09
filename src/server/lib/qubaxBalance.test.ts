import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUBAX_BALANCE_MAX_BYTES, QUBAX_BALANCE_TIMEOUT_MS, readQubaxBalance } from './qubaxBalance';

const env = { QUBAX_ENABLED: '1', QUBAX_API_KEY: 'mock-qubax-balance-key-not-real' };
const body = { balance_micros: 15_000_000, balance_usd: 15, currency: 'USD' };
const json = (value: unknown = body, init: ResponseInit = {}) => new Response(JSON.stringify(value), {
  ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('explicit Qubax balance metadata', () => {
  it('uses only the fixed authenticated GET, never inference, and returns bounded numeric metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...body, rawCredential: env.QUBAX_API_KEY }));
    vi.stubGlobal('fetch', fetch);
    const result = await readQubaxBalance({ env });
    expect(result).toEqual({ status: 'available', currency: 'USD', balanceMicros: '15000000', checkedAtMs: expect.any(Number) });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('https://api.qubax.ai/v1/billing/balance', {
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${env.QUBAX_API_KEY}`, Accept: 'application/json' },
    });
    expect(JSON.stringify(result)).not.toContain(env.QUBAX_API_KEY);
  });
  it.each([
    [{ ...env, QUBAX_ENABLED: '0' }, 'disabled'],
    [{ ...env, QUBAX_API_KEY: '' }, 'configuration'],
    [{ ...env, QUBAX_MAX_INFLIGHT: 'invalid' }, 'configuration'],
  ])('does not call the provider when configuration cannot authorize the metadata read', async (configuration, code) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await readQubaxBalance({ env: configuration })).toEqual({ status: 'unknown', code });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns cancelled without dispatch for an already aborted request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await readQubaxBalance({ env, signal: AbortSignal.abort() })).toEqual({ status: 'unknown', code: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[401, 'authentication'], [403, 'permission'], [429, 'rate-limit'], [402, 'provider-error'], [500, 'provider-error'], [503, 'provider-error']])(
    'sanitizes HTTP %s without retries or raw upstream diagnostics', async (status, code) => {
      const fetch = vi.fn().mockResolvedValue(json({ error: env.QUBAX_API_KEY }, { status: status as number }));
      vi.stubGlobal('fetch', fetch);
      expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it.each([
    null, [], {}, { ...body, balance_micros: null }, { ...body, balance_micros: -1 },
    { ...body, balance_micros: '15000000' }, { ...body, balance_micros: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, balance_usd: '15.00' }, { ...body, balance_usd: -15 },
    { ...body, balance_usd: 14 }, { ...body, balance_usd: 15.0000004 },
    { ...body, currency: 'INR' },
  ])('treats malformed, missing or inconsistent metadata as unknown, never zero', async value => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'invalid-response' });
  });
  it('preserves a verified zero as zero, without treating it as permission to spend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ balance_micros: 0, balance_usd: 0, currency: 'USD' })));
    expect(await readQubaxBalance({ env })).toMatchObject({ status: 'available', balanceMicros: '0' });
  });
  it('accepts exact fractional dollars using the integer micro amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ balance_micros: 123_456, balance_usd: 0.123456, currency: 'USD' })));
    expect(await readQubaxBalance({ env })).toMatchObject({ status: 'available', balanceMicros: '123456' });
  });
  it.each([
    () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(null, { headers: { 'Content-Type': 'application/json' } }),
    () => json(body, { headers: { 'Content-Length': String(QUBAX_BALANCE_MAX_BYTES + 1) } }),
    () => json(body, { headers: { 'Content-Length': 'malformed' } }),
    () => new Response(' '.repeat(QUBAX_BALANCE_MAX_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects unsupported and oversized bodies without exposing them', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'invalid-response' });
  });
  it('rejects a redirected response even if a fetch implementation ignores redirect:error', async () => {
    const response = json(); Object.defineProperty(response, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'invalid-response' });
  });
  it('sanitizes network exceptions and never retries', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(`Sensitive upstream error ${env.QUBAX_API_KEY}`));
    vi.stubGlobal('fetch', fetch);
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'unavailable' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('returns promptly on timeout while retaining capacity for uncooperative work', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const request = readQubaxBalance({ env });
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'busy' });
    await vi.advanceTimersByTimeAsync(QUBAX_BALANCE_TIMEOUT_MS);
    expect(await request).toEqual({ status: 'unknown', code: 'timeout' });
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'busy' });
    expect(fetch).toHaveBeenCalledOnce();
    resolve(json()); await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValue(json());
    expect(await readQubaxBalance({ env })).toMatchObject({ status: 'available' });
  });
  it('returns cancelled on user cancellation, without an automatic repeated request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const request = readQubaxBalance({ env, signal: controller.signal });
    controller.abort();
    expect(await request).toEqual({ status: 'unknown', code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('retains capacity until a noncooperative body read settles after the timeout', async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const request = readQubaxBalance({ env });
    await vi.advanceTimersByTimeAsync(QUBAX_BALANCE_TIMEOUT_MS);
    expect(await request).toEqual({ status: 'unknown', code: 'timeout' });
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'busy' });
    expect(fetch).toHaveBeenCalledOnce();
    streamController.enqueue(new TextEncoder().encode('{}'));
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValue(json());
    expect(await readQubaxBalance({ env })).toMatchObject({ status: 'available' });
  });
  it('retains capacity while a rejected response body cancellation is unresolved', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const stream = new ReadableStream<Uint8Array>({ cancel() { return new Promise<void>(resolve => { release = resolve; }); } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const request = readQubaxBalance({ env });
    await vi.advanceTimersByTimeAsync(QUBAX_BALANCE_TIMEOUT_MS);
    expect(await request).toEqual({ status: 'unknown', code: 'timeout' });
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'busy' });
    release(); await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValue(json());
    expect(await readQubaxBalance({ env })).toMatchObject({ status: 'available' });
  });
  it('does not round an imprecise USD value into an otherwise safe maximum integer balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ balance_micros: Number.MAX_SAFE_INTEGER,
      balance_usd: Number.MAX_SAFE_INTEGER / 1_000_000, currency: 'USD' })));
    expect(await readQubaxBalance({ env })).toEqual({ status: 'unknown', code: 'invalid-response' });
  });
});
