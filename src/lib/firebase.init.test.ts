// Locks the ROOT-CAUSE FIX for the iOS "verifying with Firebase… → sign-in never completes" hang
// (admin 2026-07-18, TestFlight builds 25–29). The build-29 diagnostic proved the network was fine
// (net probe HTTP 200) and signInWithCredential neither resolved nor rejected — the classic Firebase
// JS SDK ✕ Capacitor WKWebView incompatibility: `getAuth()` wires browser-only machinery (the
// popup/redirect resolver iframe + persistence heuristics) that never finishes initializing inside a
// capacitor:// WebView, so the auth operation queue never opens and EVERY sign-in hangs forever.
// The fix: on NATIVE the instance MUST be created via `initializeAuth` with explicit indexedDB
// persistence and NO popupRedirectResolver; WEB stays on `getAuth` + localStorage preference.
// These tests fail if anyone reverts the init to getAuth-on-native (or sneaks a resolver back in).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  native: { value: false },
  initializeAuth: vi.fn((_app: unknown, _deps: unknown) => ({ kind: 'native-auth' })),
  getAuth: vi.fn(() => ({ kind: 'web-auth' })),
  setPersistence: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native.value } }));
vi.mock('firebase/auth', () => ({
  getAuth: h.getAuth,
  initializeAuth: h.initializeAuth,
  setPersistence: h.setPersistence,
  browserLocalPersistence: 'LOCAL',
  indexedDBLocalPersistence: 'IDB',
  signOut: () => Promise.resolve(),
}));

describe('firebase auth init — the WKWebView sign-in-hang root fix', () => {
  beforeEach(() => {
    vi.resetModules();
    h.initializeAuth.mockClear();
    h.getAuth.mockClear();
    h.setPersistence.mockClear();
  });

  it('NATIVE app: initializeAuth with a DURABLE persistence hierarchy and NO popup/redirect resolver', async () => {
    h.native.value = true;
    const mod = await import('./firebase');
    expect(h.initializeAuth).toHaveBeenCalledTimes(1);
    const deps = h.initializeAuth.mock.calls[0][1] as { persistence: string[] };
    // ONLY `persistence` — a popupRedirectResolver here would reintroduce the iframe that wedges
    // WKWebView init.
    expect(Object.keys(deps)).toEqual(['persistence']);
    // A HIERARCHY of durable stores, not a lone one (admin 2026-07-25 cold-restart logout): passing a
    // single store let a momentary localStorage miss silently downgrade the whole session to IN-MEMORY,
    // so login survived until the app was killed and every relaunch came back logged out.
    expect(deps.persistence).toEqual(['LOCAL', 'IDB']);
    // localStorage MUST stay first: it is synchronous and immune to the build-30 failure (WebKit
    // suspends IDB while the native auth sheet backgrounds the WebView, so an IDB-first session save
    // hangs and onAuthStateChanged never fires — login succeeded but the app stayed logged out).
    expect(deps.persistence[0]).toBe('LOCAL');
    expect(h.getAuth).not.toHaveBeenCalled();
    // Still no eager setPersistence at init — persistence is resolved by the hierarchy above. (The
    // signed-in verifier may re-apply it LATER to heal an in-memory instance; that is not this path.)
    expect(h.setPersistence).not.toHaveBeenCalled();
    expect(mod.auth).toEqual({ kind: 'native-auth' });
  });

  it('WEB: getAuth + the localStorage persistence preference (behavior unchanged)', async () => {
    h.native.value = false;
    const mod = await import('./firebase');
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.initializeAuth).not.toHaveBeenCalled();
    expect(h.setPersistence).toHaveBeenCalledWith({ kind: 'web-auth' }, 'LOCAL');
    expect(mod.auth).toEqual({ kind: 'web-auth' });
  });
});
