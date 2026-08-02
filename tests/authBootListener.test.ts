import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ROOT CAUSE of "iOS app opens logged-out after every restart" (admin 2026-08-02 — survived 8 fix
// attempts): App.tsx's boot-auth effect began with `if (Capacitor.isNativePlatform()) return;` to skip
// the web-only getRedirectResult — but that early return ALSO skipped the onAuthStateChanged
// subscription that follows it in the same effect. On the native app nothing listened to Firebase auth:
// a restored session (and the cold-restart persistence heal wired inside the listener) never reached the
// UI, so every relaunch looked logged-out even when the session was durably saved. Every prior fix
// attacked the STORAGE layer; the listener was the missing piece.
//
// These tests lock the structure so the class can never return: the platform guard may wrap ONLY
// getRedirectResult, never the listener.
describe('App.tsx boot-auth effect — the auth listener must run on BOTH platforms', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

  // The one subscription that drives the app's `user` state.
  const listenerIdx = src.indexOf('const unsubscribe = onAuthStateChanged(auth,');

  it('the boot effect still subscribes onAuthStateChanged', () => {
    expect(listenerIdx).toBeGreaterThan(-1);
  });

  it('NO native early-return may stand between the effect start and the listener (the exact 8-times-missed bug)', () => {
    // Find the start of the effect that contains the listener.
    const effectStart = src.lastIndexOf('useEffect(() => {', listenerIdx);
    expect(effectStart).toBeGreaterThan(-1);
    // Assert on CODE only — the explanatory comment quotes the old buggy line, so strip // comments.
    const beforeListener = src.slice(effectStart, listenerIdx)
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    // An early `return` gated on the platform anywhere before the subscription silently kills auth
    // restore on native. The guard must be a scoped `if (!isNativePlatform()) { ... }` block instead.
    expect(beforeListener).not.toMatch(/isNativePlatform\(\)\s*\)\s*return/);
  });

  it('getRedirectResult stays WEB-ONLY via a scoped block (native auth instance has no redirect resolver)', () => {
    const effectStart = src.lastIndexOf('useEffect(() => {', listenerIdx);
    const beforeListener = src.slice(effectStart, listenerIdx);
    expect(beforeListener).toContain('if (!Capacitor.isNativePlatform()) {');
    expect(beforeListener).toContain('getRedirectResult(auth)');
  });

  it('the cold-restart persistence heal lives INSIDE the listener, where it now actually runs on native', () => {
    // ensureNativeSessionPersisted was dead code while the listener never registered on native.
    const effectEnd = src.indexOf('return unsubscribe;', listenerIdx);
    expect(effectEnd).toBeGreaterThan(-1);
    const listenerBody = src.slice(listenerIdx, effectEnd);
    expect(listenerBody).toContain('ensureNativeSessionPersisted()');
  });
});
