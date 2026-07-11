import { describe, it, expect, vi } from 'vitest';
import { popupFailureAction, waitForSignedInUser, type MinimalAuthLike } from './socialSignInPolicy';

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
