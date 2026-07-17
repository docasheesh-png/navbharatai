import { describe, it, expect, vi, afterEach } from 'vitest';
import { raceNativeAuth, NATIVE_AUTH_TIMEOUT_MS } from './nativeAuthGuard';

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
