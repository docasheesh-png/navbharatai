import { describe, it, expect, vi } from 'vitest';
import { popupFailureAction, waitForSignedInUser, settleNativeSignIn, type MinimalAuthLike } from './socialSignInPolicy';

describe('popupFailureAction', () => {
  // THE bug (admin, 2026-07-06): closing the popup ("cancel") forced a FULL-PAGE Google redirect.
  it("the user closing the popup is a CANCEL — never a forced redirect (the reported bug)", () => {
    expect(popupFailureAction('auth/popup-closed-by-user')).toBe('cancel');
  });

  it('a double-tap superseding the first popup is also a cancel (no popup+redirect cascade)', () => {
    expect(popupFailureAction('auth/cancelled-popup-request')).toBe('cancel');
  });

  it('ONLY a genuinely blocked popup falls back to the full-page redirect', () => {
    expect(popupFailureAction('auth/popup-blocked')).toBe('redirect');
  });

  it('every other failure is surfaced as an error (unauthorized-domain, network, unknown, empty)', () => {
    expect(popupFailureAction('auth/unauthorized-domain')).toBe('error');
    expect(popupFailureAction('auth/network-request-failed')).toBe('error');
    expect(popupFailureAction('auth/internal-error')).toBe('error');
    expect(popupFailureAction('')).toBe('error');
    expect(popupFailureAction(null)).toBe('error');
    expect(popupFailureAction(undefined)).toBe('error');
  });
});

// THE bug (admin, 2026-07-11): "Google login 1st time me logout hi rahta hai, 2nd time chalta hai" —
// popup-closed-by-user raced a sign-in that actually COMPLETED; the quiet cancel swallowed the success.
describe('waitForSignedInUser — a "cancel" is only final after the sign-in grace window', () => {
  function fakeAuth(initial: unknown | null = null): MinimalAuthLike & { fire: (u: unknown | null) => void } {
    let cb: ((u: unknown | null) => void) | null = null;
    return {
      currentUser: initial,
      onAuthStateChanged(next) { cb = next; return () => { cb = null; }; },
      fire(u) { (this as { currentUser: unknown | null }).currentUser = u; cb?.(u); },
    };
  }

  it('resolves IMMEDIATELY when the user is already signed in (no wait at all)', async () => {
    const auth = fakeAuth({ uid: 'u1' });
    await expect(waitForSignedInUser(auth, 5_000)).resolves.toEqual({ uid: 'u1' });
  });

  it('THE RACE: the sign-in lands DURING the grace window → resolved as signed-in (not a cancel)', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 2_500);
      auth.fire({ uid: 'landed-late' }); // the auth event arrives after the popup already "cancelled"
      await expect(p).resolves.toEqual({ uid: 'landed-late' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a GENUINE cancel (nobody signs in) resolves null after the window — quiet cancel preserved', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 2_500);
      vi.advanceTimersByTime(2_600);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('null auth events during the window do not resolve early (still waits for a real user)', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 1_000);
      auth.fire(null); // e.g. an initial "signed out" emission
      vi.advanceTimersByTime(1_100);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('settleNativeSignIn (the "stuck on the login spinner after Google" hang fix)', () => {
  function fakeAuth(opts: { currentUser?: unknown; fireAfterMs?: number; fireUser?: unknown }): MinimalAuthLike {
    let cbs: Array<(u: unknown) => void> = [];
    const auth: MinimalAuthLike = {
      currentUser: opts.currentUser ?? null,
      onAuthStateChanged(cb) { cbs.push(cb); return () => { cbs = cbs.filter((c) => c !== cb); }; },
    };
    if (opts.fireAfterMs != null) {
      const u = opts.fireUser ?? { uid: 'landed' };
      setTimeout(() => { (auth as { currentUser: unknown }).currentUser = u; cbs.forEach((c) => c(u)); }, opts.fireAfterMs);
    }
    return auth;
  }

  it("succeeds when the credential exchange resolves normally", async () => {
    expect(await settleNativeSignIn(Promise.resolve('cred'), fakeAuth({}), 1000, 50)).toBe('ok');
  });

  it("succeeds when the exchange REJECTS but a session is already present (the SDK race)", async () => {
    const auth = fakeAuth({ currentUser: { uid: 'u' } });
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), auth, 1000, 50)).toBe('ok');
  });

  it("succeeds when the exchange rejects and the session LANDS via the listener within grace", async () => {
    const auth = fakeAuth({ fireAfterMs: 10 });
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), auth, 1000, 200)).toBe('ok');
  });

  it("succeeds when the exchange HANGS forever but the session landed (never an infinite spinner)", async () => {
    const auth = fakeAuth({ fireAfterMs: 10 }); // currentUser set at 10ms
    expect(await settleNativeSignIn(new Promise<void>(() => {}), auth, 30, 200)).toBe('ok'); // times out at 30ms
  });

  it("FAILS cleanly when the exchange fails and no session ever appears (honest error, not a hang)", async () => {
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), fakeAuth({}), 1000, 40)).toBe('failed');
  });
});
