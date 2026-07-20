import { describe, it, expect } from 'vitest';
import { authGateDecision, isAuthGatedView, AUTH_GATED_VIEWS } from './authGate';

describe('authGateDecision — never flash login while the saved session is restoring (admin 2026-07-20)', () => {
  it('THE bug: a returning user tapping a protected tab DURING the restore window is NOT shown login', () => {
    // user=null but restore still running → optimistic open (Google/Instagram behaviour).
    for (const view of AUTH_GATED_VIEWS) {
      expect(authGateDecision(view, false, true)).toBe('open');
    }
  });

  it('a genuinely signed-out user (restore settled) IS prompted to sign in on protected views', () => {
    for (const view of AUTH_GATED_VIEWS) {
      expect(authGateDecision(view, false, false)).toBe('login');
    }
  });

  it('a signed-in user always opens protected views directly', () => {
    expect(authGateDecision('nbi_pro_chat', true, false)).toBe('open');
    expect(authGateDecision('history', true, true)).toBe('open');
  });

  it('non-gated views never gate, in any auth state', () => {
    for (const view of ['home', 'settings', 'professionals', 'admin']) {
      expect(authGateDecision(view, false, false)).toBe('open');
      expect(authGateDecision(view, false, true)).toBe('open');
    }
  });

  it('isAuthGatedView matches exactly the protected set', () => {
    for (const v of AUTH_GATED_VIEWS) expect(isAuthGatedView(v)).toBe(true);
    expect(isAuthGatedView('home')).toBe(false);
  });
});
