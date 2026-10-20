// HOUSE ADS — the client's one way to ask for an ad (src/lib/houseAdClient.ts), run against injected
// viewers and transports (admin 2026-10-20).
//
// What is held, none visible to `tsc`:
//   1. The client NEVER asks before the sign-in state is known, and a signed-in person whose token cannot be
//      read is "unknown" (no ad) — never silently an anonymous visitor.
//   2. A signed-in user sends their token; a visitor sends none.
//   3. An answer is reused for a minute, per viewer — a different viewer is never handed the previous one's ad.
//   4. Anything that is not a clean, well-formed answer is NO ad, and a failed read is not remembered.
import { describe, it, expect, vi } from 'vitest';
import { createHouseAdClient, HOUSE_AD_CLIENT_TTL_MS, type Viewer } from '../src/lib/houseAdClient';

const SERVED = { id: 'ad_0123456789ab', name: 'Kumar Spices', description: 'Fresh masalas.', linkUrl: 'https://kumarspices.in/', imageUrl: '/api/ads/image/ad_0123456789ab?v=1' };
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
const fail = (status = 500) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

function setup(viewer: Viewer | (() => Promise<Viewer>), reply: () => Response | Promise<Response> = () => ok({ ad: SERVED })) {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => reply()) as unknown as typeof fetch;
  let t = 1_000_000;
  const client = createHouseAdClient({
    getViewer: typeof viewer === 'function' ? viewer : async () => viewer,
    fetchImpl,
    resolveHref: (p) => `https://navbharatai.com${p}`,
    now: () => t,
    timeoutMs: 50,
  });
  return { client, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, tick: (ms: number) => { t += ms; } };
}

describe('1 — it never asks before it knows who is looking', () => {
  it('an unknown viewer draws nothing and sends NO request', async () => {
    const { client, fetchImpl } = setup({ kind: 'unknown' });
    expect(await client.get('mart_tile')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a viewer lookup that throws is an unknown viewer, not an anonymous one', async () => {
    const { client, fetchImpl } = setup(async () => { throw new Error('auth blew up'); });
    expect(await client.get('mart_tile')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('2 — who sends what', () => {
  it('a signed-in user sends their token, and the URL is resolved for the bundled phone app', async () => {
    const { client, fetchImpl } = setup({ kind: 'user', uid: 'u1', token: 'tok-123' });
    expect(await client.get('dashboard')).toEqual(SERVED);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://navbharatai.com/api/ads/dashboard');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok-123' });
  });

  it('a visitor sends no credentials at all', async () => {
    const { client, fetchImpl } = setup({ kind: 'anonymous' });
    await client.get('dashboard');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toEqual({});
  });
});

describe('3 — reuse is per viewer and per place, and short', () => {
  it('asks once for many callers at the same moment', async () => {
    const { client, fetchImpl } = setup({ kind: 'anonymous' });
    const all = await Promise.all([client.get('mart_tile'), client.get('mart_tile'), client.get('mart_tile')]);
    expect(all.every((a) => a?.id === SERVED.id)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reuses the answer for the TTL and asks again after it', async () => {
    const { client, fetchImpl, tick } = setup({ kind: 'anonymous' });
    await client.get('mart_tile');
    tick(HOUSE_AD_CLIENT_TTL_MS - 1);
    await client.get('mart_tile');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    tick(2);
    await client.get('mart_tile');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a different place is a different question', async () => {
    const { client, fetchImpl } = setup({ kind: 'anonymous' });
    await client.get('mart_tile');
    await client.get('dashboard');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a different VIEWER is never handed the previous viewer\'s cached ad', async () => {
    let viewer: Viewer = { kind: 'anonymous' };
    let n = 0;
    const { client, fetchImpl } = setup(async () => viewer, () => { n++; return ok({ ad: n === 1 ? SERVED : null }); });
    expect(await client.get('mart_tile')).toEqual(SERVED);          // the visitor is shown an ad
    viewer = { kind: 'user', uid: 'u_paid', token: 't' };            // …then a paying user signs in, same screen
    expect(await client.get('mart_tile')).toBeNull();                // the server said "no ad": that is what they get
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('4 — anything but a clean answer is NO ad, and a failed read is not remembered', () => {
  it.each([
    ['a server error', () => fail(500)],
    ['a 404', () => fail(404)],
    ['a body that is not JSON', () => ({ ok: true, json: async () => { throw new Error('not json'); } }) as unknown as Response],
    ['no ad', () => ok({ ad: null })],
    ['a picture from another host', () => ok({ ad: { ...SERVED, imageUrl: 'https://evil.example/p.png' } })],
    ['an http link', () => ok({ ad: { ...SERVED, linkUrl: 'http://x.example.in' } })],
    ['a javascript link', () => ok({ ad: { ...SERVED, linkUrl: 'javascript:alert(1)' } })],
    ['a nameless ad', () => ok({ ad: { ...SERVED, name: '' } })],
  ])('%s → null', async (_why, reply) => {
    const { client } = setup({ kind: 'anonymous' }, reply);
    expect(await client.get('mart_tile')).toBeNull();
  });

  it('a network failure is null, and the NEXT screen asks again (a failure is not cached)', async () => {
    let n = 0;
    const { client, fetchImpl } = setup({ kind: 'anonymous' }, () => { n++; if (n === 1) throw new Error('offline'); return ok({ ad: SERVED }); });
    expect(await client.get('mart_tile')).toBeNull();
    expect(await client.get('mart_tile')).toEqual(SERVED);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a request that never answers is cut at the timeout and draws nothing', async () => {
    const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const client = createHouseAdClient({ getViewer: async () => ({ kind: 'anonymous' }), fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 });
    expect(await client.get('mart_tile')).toBeNull();
  });

  it('clear() forgets everything', async () => {
    const { client, fetchImpl } = setup({ kind: 'anonymous' });
    await client.get('mart_tile');
    client.clear();
    await client.get('mart_tile');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
