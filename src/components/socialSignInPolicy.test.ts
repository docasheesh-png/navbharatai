import { describe, it, expect } from 'vitest';
import { popupFailureAction } from './socialSignInPolicy';

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
