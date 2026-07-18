import { describe, it, expect, vi, afterEach } from 'vitest';
import { raceNativeAuth, NATIVE_AUTH_TIMEOUT_MS, settleWithinOrProceed, preLoginWebSignOutAllowed } from './nativeAuthGuard';

afterEach(() => vi.useRealTimers());

describe('raceNativeAuth — no native sign-in may ever hang the UI', () => {
  it('passes through a fast success untouched', async () => {
    await expect(raceNativeAuth(Promise.resolve('cred'), 'timed out', 1000)).resolves.toBe('cred');
  });

  it('passes through a native rejection untouched (cancel/error semantics preserved)', async () => {
    await expect(raceNativeAuth(Promise.reject(new Error('sign_in_canceled')), 'timed out', 1000))
      .rejects.toThrow('sign_in_canceled');
  });

  it('a promise that NEVER settles (the infinite-spinner bug) rejects with the honest timeout', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => { /* the real bug: pending forever */ });
    const raced = raceNativeAuth(never, 'Sign-in timed out — please try again.', 5000);
    const assertion = expect(raced).rejects.toThrow('Sign-in timed out — please try again.');
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });

  it('does not time out a success that lands just before the deadline', async () => {
    vi.useFakeTimers();
    let done!: (v: string) => void;
    const p = new Promise<string>((res) => { done = res; });
    const raced = raceNativeAuth(p, 'timed out', 5000);
    await vi.advanceTimersByTimeAsync(4999);
    done('ok');
    await expect(raced).resolves.toBe('ok');
  });

  it('default window is generous (>= 60s) so a slow human login is never cut off', () => {
    expect(NATIVE_AUTH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('settleWithinOrProceed — pre-login cleanup must never block the sign-in', () => {
  it('resolves as soon as the cleanup finishes (no needless wait in the normal case)', async () => {
    vi.useFakeTimers();
    const settled = settleWithinOrProceed(Promise.resolve(), 4000);
    await expect(settled).resolves.toBeUndefined();
  });

  it('a cleanup that NEVER settles (the iOS build-25 hang) still resolves at the timeout — login proceeds', async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => { /* the real bug: signOut pending forever on WKWebView */ });
    let resolved = false;
    const settled = settleWithinOrProceed(never, 4000).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(resolved).toBe(false);        // hasn't fired early
    await vi.advanceTimersByTimeAsync(2);
    await settled;
    expect(resolved).toBe(true);         // proceeded at the cap
  });

  it('NEVER rejects — a failing cleanup is swallowed so it cannot fail the login', async () => {
    await expect(settleWithinOrProceed(Promise.reject(new Error('signOut blew up')), 4000))
      .resolves.toBeUndefined();
  });
});

describe('preLoginWebSignOutAllowed — no pre-login web signOut on native (build-27 lock poison)', () => {
  it('is FORBIDDEN on the native app (a hung web signOut would block signInWithCredential)', () => {
    expect(preLoginWebSignOutAllowed(true)).toBe(false);
  });

  it('is ALLOWED on the web (clears a stale session that could wedge the popup; signOut is safe there)', () => {
    expect(preLoginWebSignOutAllowed(false)).toBe(true);
  });
});
