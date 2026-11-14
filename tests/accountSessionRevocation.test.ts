import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from 'express';
import { verifySessionWith, verifyFirebaseSession, verifyFirebaseToken, verifyFirebaseIdentity, verifyFreshAuth, verifiedPhoneNumber } from '../src/server/lib/authMiddleware';
import { revokeAccountSessions, sessionTokenIsCurrent, sessionRevocationStore, readSessionCutoff } from '../src/server/lib/sessionRevocation';
import { setServerDb } from '../src/server/lib/serverDb';
import { registerAccountSessionRoutes } from '../src/server/routes/accountSessions';
import { exchangePhoneIdToken } from '../src/server/lib/phoneTokenExchange';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const h = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../src/server/lib/firebaseAdminModule', () => ({ loadFirebaseAdmin: async () => ({ apps: [{}], auth: () => ({ verifyIdToken: h.verify }) }) }));

/** Serializes real transaction callbacks; no provider or database traffic occurs. */
function database() {
  const data = new Map<string, any>();
  let chain = Promise.resolve();
  const ref = (path: string) => ({ path, get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ exists: data.has(path), data: () => data.get(path), id: path.split('/').at(-1), ref: ref(path) });
  const db = {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: (fn: (tx: any) => Promise<unknown>) => {
      const operation = chain.then(() => fn({
        get: async (r: any) => snapshot(r.path),
        set: (r: any, value: any, opts?: any) => data.set(r.path, opts?.merge ? { ...data.get(r.path), ...value } : value),
      }));
      chain = operation.then(() => {}, () => {});
      return operation;
    },
  };
  return { data, db };
}
beforeEach(() => { h.verify.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); setServerDb(null); });

const cutoff = 1001;
const good = { uid: 'alice', auth_time: 1001, email: 'alice@example.test', email_verified: true, phone_number: '+15550000001' };
describe('session authority: old ID tokens, refreshed tokens, other accounts and custom handovers', () => {
  it('always asks Firebase to reject revoked ID tokens before accepting its UID', async () => {
    const verifyIdToken = vi.fn(async () => good);
    const read = vi.fn(async () => cutoff);
    expect((await verifySessionWith('Bearer synthetic', async () => ({ verifyIdToken }), read)).token?.uid).toBe('alice');
    expect(verifyIdToken).toHaveBeenCalledExactlyOnceWith('synthetic', true);
    expect(read).toHaveBeenCalledExactlyOnceWith('alice');
  });
  it.each(['auth/id-token-revoked', 'auth/user-disabled', 'auth/id-token-expired', 'auth/user-not-found'])('permanent %s is not retried', async code => {
    const verifyIdToken = vi.fn(async () => { throw Object.assign(new Error('denied'), { code }); });
    const read = vi.fn(async () => 0);
    expect(await verifySessionWith('Bearer old', async () => ({ verifyIdToken }), read)).toMatchObject({ token: null, invalid: true });
    expect(verifyIdToken).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled();
  });
  it('fails closed on missing/unreadable durable authority, without claiming the session was revoked', async () => {
    expect(await verifySessionWith('Bearer good', async () => ({ verifyIdToken: async () => good }), async () => { throw new Error('offline'); }))
      .toMatchObject({ token: null, invalid: false });
    expect(await verifySessionWith('Bearer good', async () => { throw new Error('init'); })).toMatchObject({ token: null, reason: 'admin-unavailable' });
  });
  it('rejects both an old ID token and a refreshed token with the same original auth_time', () => {
    expect(sessionTokenIsCurrent({ auth_time: 1000 }, cutoff)).toBe(false);
    expect(sessionTokenIsCurrent({ auth_time: 1000 }, cutoff)).toBe(false);
    expect(sessionTokenIsCurrent({ auth_time: cutoff }, cutoff)).toBe(true); // Firebase's equality rule
    expect(sessionTokenIsCurrent({ auth_time: cutoff + 1 }, cutoff)).toBe(true);
    expect(sessionTokenIsCurrent({}, cutoff)).toBe(false);
  });
  it('fences out-of-order provider cutoff rollback with the authoritative monotonic mirror', async () => {
    // Synthetic provider accepted auth_time1001 after its cutoff rolled back from1002 to1001.
    expect(await verifySessionWith('Bearer replay', async () => ({ verifyIdToken: async () => good }), async () => 1002))
      .toMatchObject({ token: null, invalid: true });
    // Another account has no revocation marker and retains its access.
    expect((await verifySessionWith('Bearer bob', async () => ({ verifyIdToken: async () => ({ uid: 'bob', auth_time: 1 }) }), async uid => uid === 'bob' ? 0 : 1002)).token?.uid).toBe('bob');
  });
  it('old outstanding custom tokens cannot gain a new auth epoch by redemption after logout', () => {
    const firebase = { sign_in_provider: 'custom' };
    expect(sessionTokenIsCurrent({ auth_time: 1100, session_auth_time: 999, firebase }, cutoff)).toBe(false);
    expect(sessionTokenIsCurrent({ auth_time: 1100, firebase }, cutoff)).toBe(false); // pre-deploy custom token
    expect(sessionTokenIsCurrent({ auth_time: 1100, session_auth_time: 1050, firebase }, cutoff)).toBe(true);
    expect(sessionTokenIsCurrent({ auth_time: 1100, firebase }, 0)).toBe(true); // untouched account compatibility
  });
  it('phone exchange verifies revocation and stamps the original verified epoch into its custom token', async () => {
    const createCustomToken = vi.fn(async () => 'custom');
    const verifyIdToken = vi.fn(async () => ({ uid: 'alice', auth_time: 1001, phone_number: '+15550000001', firebase: { sign_in_provider: 'phone' } }));
    expect(await exchangePhoneIdToken('synthetic-token-long-enough', { verifyIdToken, createCustomToken }, 1010, async () => 1001)).toEqual({ ok: true, token: 'custom' });
    expect(verifyIdToken).toHaveBeenCalledWith(expect.any(String), true);
    expect(createCustomToken).toHaveBeenCalledWith('alice', { session_auth_time: 1001 });
    createCustomToken.mockClear();
    expect(await exchangePhoneIdToken('synthetic-token-long-enough', { verifyIdToken, createCustomToken }, 1010, async () => 1002)).toMatchObject({ status: 401 });
    expect(createCustomToken).not.toHaveBeenCalled();
  });
  it('deduplicates all helpers only within one request, never across devices or subsequent requests', async () => {
    vi.stubEnv('VITEST', ''); const fixture = database(); setServerDb(fixture.db as never);
    h.verify.mockResolvedValue(good);
    const req = { headers: { authorization: 'Bearer synthetic' } } as Request;
    const [uid, identity, fresh, phone] = await Promise.all([verifyFirebaseToken(req), verifyFirebaseIdentity(req), verifyFreshAuth(req), verifiedPhoneNumber(req)]);
    expect(uid).toBe('alice'); expect(identity?.emailVerified).toBe(true); expect(fresh?.authTimeSec).toBe(1001); expect(phone).toBe(good.phone_number);
    expect(h.verify).toHaveBeenCalledTimes(1);
    fixture.data.set('session_revocations/alice', { revokeTime: 1002 });
    expect((await verifyFirebaseSession({ headers: { authorization: 'Bearer synthetic' } } as Request)).token).toBeNull();
    expect(h.verify).toHaveBeenCalledTimes(2);
    req.headers.authorization = 'Bearer replacement';
    h.verify.mockResolvedValue({ uid: 'bob', auth_time: 1003 });
    expect(await verifyFirebaseToken(req)).toBe('bob');
    expect(h.verify).toHaveBeenCalledTimes(3);
  });
  it('does not treat delayed custom-token redemption as a new phone authentication', async () => {
    vi.stubEnv('VITEST', ''); const fixture = database(); setServerDb(fixture.db as never);
    h.verify.mockResolvedValue({ uid: 'alice', auth_time: 4000, session_auth_time: 1000, firebase: { sign_in_provider: 'custom' } });
    const fresh = await verifyFreshAuth({ headers: { authorization: 'Bearer synthetic-delayed-custom' } } as Request);
    expect(fresh?.authTimeSec).toBe(1000);
  });
  it.each([undefined, null, 0, -1, NaN, 1000.5, '1000', 5000])('refuses unproven custom step-up epoch %s without revoking ordinary access', async original => {
    vi.stubEnv('VITEST', ''); const fixture = database(); setServerDb(fixture.db as never);
    h.verify.mockResolvedValue({ uid: 'alice', auth_time: 4000, session_auth_time: original, firebase: { sign_in_provider: 'custom' } });
    const req = { headers: { authorization: 'Bearer synthetic-custom' } } as Request;
    expect(await verifyFreshAuth(req)).toEqual({ uid: 'alice', authTimeSec: null });
    expect(await verifyFirebaseToken(req)).toBe('alice');
  });
  it('accepts a genuine recent native phone reauthentication rather than an older exchange claim', async () => {
    vi.stubEnv('VITEST', ''); const fixture = database(); setServerDb(fixture.db as never);
    h.verify.mockResolvedValue({ uid: 'alice', auth_time: 4000, session_auth_time: 1000, firebase: { sign_in_provider: 'phone' } });
    expect(await verifyFreshAuth({ headers: { authorization: 'Bearer reauthenticated-phone' } } as Request)).toEqual({ uid: 'alice', authTimeSec: 4000 });
  });
  it('first tokenless request never dereferences an absent cache entry', async () => {
    expect(await verifyFirebaseToken({ headers: {} } as Request)).toBeNull();
    expect(h.verify).not.toHaveBeenCalled();
  });
});

describe('confirmed global logout and durable monotonic cutoff', () => {
  function deps() {
    const order: string[] = [];
    return {
      order,
      auth: { revokeRefreshTokens: vi.fn(async (uid: string) => { order.push(`revoke:${uid}`); }), getUser: vi.fn(async () => ({ tokensValidAfterTime: new Date(1001_000).toUTCString() })) },
      store: { reserve: vi.fn(async () => true), advance: vi.fn(async () => { order.push('mirror'); }) },
      clock: { now: () => 1000_500, wait: vi.fn(async () => { order.push('wait'); }) },
    };
  }
  it('waits across the second boundary and only succeeds after BOTH revocation and rules mirror', async () => {
    const d = deps();
    expect(await revokeAccountSessions('alice', 1000, d.auth, d.store, d.clock)).toEqual({ ok: true });
    expect(d.order).toEqual(['wait', 'revoke:alice', 'mirror']);
    expect(d.store.advance).toHaveBeenCalledWith('alice', 1001);
    expect(d.clock.wait).toHaveBeenCalledWith(1000);
  });
  it.each([1000, 999, NaN])('stale cutoff %s cannot prove every pre-click session was revoked, even for an old initiating session', async value => {
    const d = deps(); d.auth.getUser.mockResolvedValue({ tokensValidAfterTime: new Date(value * 1000).toUTCString() });
    expect(await revokeAccountSessions('alice', 10, d.auth, d.store, d.clock)).toMatchObject({ ok: false, status: 503 });
    expect(d.store.advance).not.toHaveBeenCalled();
  });
  it('no success on missing storage/auth, malformed epoch, rate limit or provider failure', async () => {
    const d = deps();
    expect(await revokeAccountSessions('alice', 1000, null, d.store, d.clock)).toMatchObject({ ok: false });
    expect(await revokeAccountSessions('alice', 1000, d.auth, null, d.clock)).toMatchObject({ ok: false });
    expect(await revokeAccountSessions('alice', undefined, d.auth, d.store, d.clock)).toMatchObject({ ok: false });
    d.store.reserve.mockResolvedValueOnce(false);
    expect(await revokeAccountSessions('alice', 1000, d.auth, d.store, d.clock)).toMatchObject({ status: 429 });
    expect(d.auth.revokeRefreshTokens).not.toHaveBeenCalled();
    d.auth.revokeRefreshTokens.mockRejectedValueOnce(new Error('timeout'));
    expect(await revokeAccountSessions('alice', 1000, d.auth, d.store, d.clock)).toMatchObject({ status: 503 });
    expect(d.store.advance).not.toHaveBeenCalled();
  });
  it('retries only the exact idempotent mirror after lost ack, never revokes a fresh login in a retry', async () => {
    const d = deps(); d.store.advance.mockRejectedValueOnce(new Error('lost ack'));
    expect(await revokeAccountSessions('alice', 1000, d.auth, d.store, d.clock)).toEqual({ ok: true });
    expect(d.store.advance).toHaveBeenCalledTimes(2); expect(d.auth.revokeRefreshTokens).toHaveBeenCalledTimes(1);
    d.store.advance.mockRejectedValue(new Error('still offline'));
    expect(await revokeAccountSessions('alice', 1000, d.auth, d.store, d.clock)).toMatchObject({ ok: false, status: 503 });
  });
  it('rate reservation is atomic and older concurrent writes cannot roll back the shared cutoff', async () => {
    const f = database(); setServerDb(f.db as never); const store = sessionRevocationStore()!;
    const grants = await Promise.all(Array.from({ length: 12 }, () => store.reserve('alice', 1000_000)));
    expect(grants.filter(Boolean)).toHaveLength(5);
    await Promise.all([store.advance('alice', 1003), store.advance('alice', 1001), store.advance('alice', 1002)]);
    expect(await readSessionCutoff('alice')).toBe(1003);
    expect(await readSessionCutoff('bob')).toBe(0);
    expect(await store.reserve('alice', 3600_000)).toBe(true);
    expect(await readSessionCutoff('alice')).toBe(1003);
    f.data.set('session_revocations/corrupt', { revokeTime: 'yesterday' });
    await expect(store.advance('corrupt', 2000)).rejects.toThrow();
    await expect(readSessionCutoff('corrupt')).rejects.toThrow();
  });
});

describe('account-scoped route boundary', () => {
  function routes(session: any = { token: good, reason: 'ok' }) {
    const revoke = vi.fn(async () => ({ ok: true as const }));
    const verify = vi.fn(async () => session);
    return { revoke, verify, handlers: captureRoutes(registerAccountSessionRoutes, { verify, auth: async () => ({}), store: () => ({}), revoke }) };
  }
  it('derives target UID only from verified token and rejects spoofed or unconfirmed bodies', async () => {
    const d = routes(); const post = d.handlers.get('POST /api/auth/sessions/revoke')!;
    for (const body of [{}, { confirm: false }, { confirm: true, uid: 'bob' }, { confirm: true, userId: 'bob' }]) {
      const res = mockRes(); await post(Object.assign(mockReq({ body }), { is: () => true }), res); expect(res.statusCode).toBe(400);
    }
    expect(d.revoke).not.toHaveBeenCalled();
    const res = mockRes(); await post(Object.assign(mockReq({ body: { confirm: true } }), { is: () => true }), res);
    expect(d.revoke).toHaveBeenCalledWith('alice', 1001, {}, {});
    expect(res.headers['cache-control']).toBe('no-store'); expect(res.body).toEqual({ ok: true });
  });
  it.each([
    [{ token: null, reason: 'no-bearer' }, 401],
    [{ token: null, reason: 'verify-error', invalid: true }, 401],
    [{ token: null, reason: 'admin-unavailable' }, 503],
    [{ token: null, reason: 'verify-error', invalid: false }, 503],
  ])('unauthenticated and unavailable authority remain distinct', async (session, status) => {
    const d = routes(session);
    for (const key of ['GET /api/auth/session', 'POST /api/auth/sessions/revoke']) {
      const res = mockRes(); await d.handlers.get(key)!(Object.assign(mockReq({ body: { confirm: true } }), { is: () => true }), res);
      expect(res.statusCode).toBe(status); expect(d.revoke).not.toHaveBeenCalled();
    }
  });
});

describe('closed sibling census', () => {
  it('every direct platform ID-token verifier enables provider revocation', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.includes('.test.') ? [join(dir, e.name)] : []);
    const calls = walk('src/server').flatMap(path => [...readFileSync(path, 'utf8').matchAll(/\.verifyIdToken\(([^;\n]+)\)/g)].map(m => ({ path, call: m[1] })));
    expect(calls).toHaveLength(2); for (const c of calls) expect(c.call).toMatch(/, true$/);
  });
  it('rules share the cutoff and all self-member branches include session authorization', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain('documents/session_revocations/$(request.auth.uid)');
    expect(rules).toContain('session_auth_time');
    expect(rules).not.toMatch(/\|\| memberId == request\.auth\.uid/);
    expect(rules).not.toContain('match /session_revocations/'); // default-deny client writes
  });
});
