import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionMonitor } from './sessionMonitor';

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const user = { refreshToken: 'old-refresh', getIdToken: vi.fn(async () => 'synthetic') };
  let current: typeof user | null = user;
  const invalidate = vi.fn(async () => {});
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  const visible = vi.fn(() => true);
  const monitor = createSessionMonitor({ currentUser: () => current, invalidate, fetch: fetch as typeof globalThis.fetch, visible });
  return { user, invalidate, fetch, visible, monitor, replace: (u: typeof user | null) => { current = u; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('remote session monitor', () => {
  it.each([200, 403, 429, 500, 503])('HTTP %i never falsely signs out a user', async status => {
    const f = fixture(); f.fetch.mockResolvedValue(new Response('{}', { status }));
    await f.monitor.check(); expect(f.invalidate).not.toHaveBeenCalled(); f.monitor.stop();
  });
  it('only a definitive own-session401 signs out the captured user', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await f.monitor.check(); expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.user, 'old-refresh');
    expect(f.fetch).toHaveBeenCalledWith('/api/v1/auth/session', expect.objectContaining({ cache: 'no-store', headers: { Authorization: 'Bearer synthetic' } }));
  });
  it('offline errors retain login, then reconnect check observes revocation', async () => {
    const f = fixture(); f.fetch.mockRejectedValueOnce(new TypeError('offline'));
    await f.monitor.check(); expect(f.invalidate).not.toHaveBeenCalled();
    f.fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await f.monitor.check(); expect(f.invalidate).toHaveBeenCalledTimes(1);
  });
  it('hidden or signed-out clients make no checks', async () => {
    const f = fixture(); f.visible.mockReturnValue(false); await f.monitor.check();
    f.visible.mockReturnValue(true); f.replace(null); await f.monitor.check();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent focus/online/visibility events', async () => {
    const f = fixture(); const wait = deferred<Response>(); f.fetch.mockReturnValue(wait.promise);
    const check = f.monitor.check(); await Promise.resolve(); await f.monitor.check();
    wait.resolve(new Response('{}')); await check; expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('a late401 cannot log out a newer account/session', async () => {
    const f = fixture(); const wait = deferred<Response>(); f.fetch.mockReturnValue(wait.promise);
    const checking = f.monitor.check(); await vi.advanceTimersByTimeAsync(0);
    f.replace({ refreshToken: 'new-refresh', getIdToken: vi.fn(async () => 'new') });
    wait.resolve(new Response('{}', { status: 401 })); await checking; expect(f.invalidate).not.toHaveBeenCalled();
  });
  it('an initiating logout action can suppress a late monitor response until its outcome is shown', async () => {
    const f = fixture(); const wait = deferred<Response>(); f.fetch.mockReturnValue(wait.promise);
    const checking = f.monitor.check(); await vi.advanceTimersByTimeAsync(0);
    f.visible.mockReturnValue(false); // pending global action or backgrounded app
    wait.resolve(new Response('{}', { status: 401 })); await checking;
    expect(f.invalidate).not.toHaveBeenCalled();
    f.visible.mockReturnValue(true); await f.monitor.check(); expect(f.invalidate).toHaveBeenCalledTimes(1);
  });
  it('same-UID cross-tab replacement mutating the SAME User object fences a late401', async () => {
    const f = fixture(); const wait = deferred<Response>(); f.fetch.mockReturnValue(wait.promise);
    const checking = f.monitor.check(); await vi.advanceTimersByTimeAsync(0);
    f.user.refreshToken = 'new-login-refresh';
    wait.resolve(new Response('{}', { status: 401 })); await checking;
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it('hung native token acquisition is bounded and does not permanently wedge later checks', async () => {
    const f = fixture(); const token = deferred<string>(); f.user.getIdToken.mockReturnValueOnce(token.promise);
    const checking = f.monitor.check(); await vi.advanceTimersByTimeAsync(10_000); await checking;
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
    f.fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })); await f.monitor.check();
    expect(f.invalidate).toHaveBeenCalledTimes(1);
    token.resolve('late'); await vi.advanceTimersByTimeAsync(0); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('stop aborts pending waits and suppresses late signout', async () => {
    const f = fixture(); f.user.getIdToken.mockReturnValue(new Promise(() => {}));
    const checking = f.monitor.check(); f.monitor.stop(); await checking; await f.monitor.check();
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });
  it.each(['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token'])('SDK %s invalidates, not network errors', async code => {
    const f = fixture(); f.user.getIdToken.mockRejectedValue(Object.assign(new Error('invalid'), { code }));
    await f.monitor.check(); expect(f.invalidate).toHaveBeenCalledTimes(1);
  });
});
