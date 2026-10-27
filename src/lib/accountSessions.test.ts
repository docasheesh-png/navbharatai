import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
const h = vi.hoisted(() => ({ auth: { currentUser: null as User | null }, signOut: vi.fn(), perform: vi.fn(), clear: vi.fn(), clearAccount: vi.fn(), deleteDb: vi.fn() }));
vi.mock('./firebase', () => ({ auth: h.auth, signOutEverywhere: h.signOut }));
vi.mock('./signOutFlow', () => ({ performSignOut: h.perform, defaultClearAuthStorage: h.clear, clearAccountAuthStorage: h.clearAccount, deleteFirebaseAuthDb: h.deleteDb }));
vi.mock('./githubTokenStore', () => ({ clearGithubConnection: vi.fn() }));
vi.mock('./pushNotifications', () => ({ teardownPushNotifications: vi.fn() }));
import { logoutAllDevices, logoutCurrentDevice, UNCONFIRMED_LOGOUT_MESSAGE } from './accountSessions';
const fetcher = vi.fn();
let user: User;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); user = { refreshToken: 'original-refresh', getIdToken: vi.fn(async () => 'synthetic') } as unknown as User; h.auth.currentUser = user; vi.stubGlobal('fetch', fetcher); h.perform.mockResolvedValue({ deletedDb: false }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('account logout client', () => {
  it('ordinary current-device action uses prior cleanup and never calls the global endpoint', async () => {
    await logoutCurrentDevice(user); expect(fetcher).not.toHaveBeenCalled();
    expect(h.perform).toHaveBeenCalledWith(expect.objectContaining({ clearStorage: h.clear }));
  });
  it('global action sends no UID and only signs out after shape-checked server success', async () => {
    fetcher.mockResolvedValue(new Response('{"ok":true}'));
    await logoutAllDevices(user);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/sessions/revoke', expect.objectContaining({ method: 'POST', body: '{"confirm":true}', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' } }));
    expect(h.perform).toHaveBeenCalledWith(expect.objectContaining({ clearStorage: h.clearAccount }));
  });
  it.each([[200, '{}'], [200, '{"ok":"true"}'], [200, '<html>'], [503, '{"ok":true}'], [401, '{}']])('unconfirmed HTTP%s/%s neither lies nor silently retries', async (status, body) => {
    fetcher.mockResolvedValue(new Response(body as string, { status: status as number }));
    await expect(logoutAllDevices(user)).rejects.toThrow(UNCONFIRMED_LOGOUT_MESSAGE);
    expect(h.perform).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('token acquisition timeout is bounded and cannot send a late mutation', async () => {
    let resolve!: (token: string) => void;
    vi.mocked(user.getIdToken).mockReturnValue(new Promise(r => { resolve = r; }));
    const result = logoutAllDevices(user).catch(e => e.message);
    await vi.advanceTimersByTimeAsync(20_000); expect(await result).toBe(UNCONFIRMED_LOGOUT_MESSAGE);
    resolve('late'); await vi.advanceTimersByTimeAsync(0); expect(fetcher).not.toHaveBeenCalled(); expect(h.perform).not.toHaveBeenCalled();
  });
  it('a late global success never clears a fresh same-account session assigned into the same User object', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    const result = logoutAllDevices(user);
    await vi.advanceTimersByTimeAsync(0);
    Object.assign(user, { refreshToken: 'new-login-refresh' });
    resolve(new Response('{"ok":true}')); await result;
    expect(h.perform).not.toHaveBeenCalled();
  });
  it('same-object credential replacement during token acquisition prevents a stale global mutation', async () => {
    let resolve!: (token: string) => void;
    vi.mocked(user.getIdToken).mockReturnValue(new Promise(r => { resolve = r; }));
    const result = logoutAllDevices(user).catch(e => e.message);
    Object.assign(user, { refreshToken: 'new-login-refresh' }); resolve('old'); await result;
    expect(fetcher).not.toHaveBeenCalled(); expect(h.perform).not.toHaveBeenCalled();
  });
  it('account replacement while token acquisition is pending cannot send or sign out the new user', async () => {
    let resolve!: (token: string) => void;
    vi.mocked(user.getIdToken).mockReturnValue(new Promise(r => { resolve = r; }));
    const result = logoutAllDevices(user).catch(e => e.message);
    h.auth.currentUser = { uid: 'bob' } as User; resolve('old'); await result;
    expect(fetcher).not.toHaveBeenCalled(); expect(h.perform).not.toHaveBeenCalled();
  });
});
