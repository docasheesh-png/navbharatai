import { describe, expect, it } from 'vitest';
import { resolveAdminMfaDocument, unavailableAdminMfa } from '../src/server/lib/adminMfaState';

describe('admin MFA authoritative state', () => {
  it('distinguishes unavailable from positively disabled', () => {
    expect(unavailableAdminMfa().available).toBe(false);
    expect(resolveAdminMfaDocument(null, () => '')).toEqual({ available: true, enabled: false, secret: null, envManaged: false });
    expect(resolveAdminMfaDocument({ enabled: false }, () => { throw new Error('not used'); }).available).toBe(true);
  });
  it.each([{}, { enabled: 'true' }, { enabled: 1 }, { enabled: true }, { enabled: true, encrypted_secret: 123 }, { enabled: true, encrypted_secret: '' }])('blocks malformed record %j', (data) => {
    expect(resolveAdminMfaDocument(data, () => 'secret')).toEqual(unavailableAdminMfa());
  });
  it('blocks missing plaintext and decrypt failure', () => {
    const data = { enabled: true, encrypted_secret: 'ciphertext' };
    for (const plaintext of ['', '   ']) expect(resolveAdminMfaDocument(data, () => plaintext)).toEqual(unavailableAdminMfa());
    expect(resolveAdminMfaDocument(data, () => { throw new Error('bad ciphertext'); })).toEqual(unavailableAdminMfa());
  });
  it('requires the active secret even when pending enrolment exists', () => {
    expect(resolveAdminMfaDocument({ enabled: true, encrypted_pending: 'pending' }, () => 'secret')).toEqual(unavailableAdminMfa());
  });
  it('uses only the active secret', () => {
    const state = resolveAdminMfaDocument({ enabled: true, encrypted_secret: 'active', encrypted_pending: 'pending' }, value => {
      expect(value).toBe('active'); return 'verified-secret';
    });
    expect(state).toEqual({ available: true, enabled: true, secret: 'verified-secret', envManaged: false });
  });
});

import { AdminMfaPolicyError, requireMfaEnrollmentAllowed, pendingAdminMfaSecret } from '../src/server/lib/adminMfaState';
describe('admin MFA enrolment transition guards', () => {
  it('allows initial enrolment only after an authoritative disabled state', () => {
    expect(() => requireMfaEnrollmentAllowed(null, x => x)).not.toThrow();
    expect(() => requireMfaEnrollmentAllowed({ enabled: false }, x => x)).not.toThrow();
    expect(() => requireMfaEnrollmentAllowed({}, x => x)).toThrow(AdminMfaPolicyError);
    expect(() => requireMfaEnrollmentAllowed({ enabled: true, encrypted_secret: 'current' }, x => x)).toThrow('active authenticator');
  });
  it('rejects expired, unbounded and legacy pending values', () => {
    for (const expiry of [undefined, 999, 1000, 601001, Infinity, NaN, '2000']) {
      expect(() => pendingAdminMfaSecret({ enabled: false, encrypted_pending: 'new', pending_expires_at_ms: expiry }, 1000, x => x)).toThrow();
    }
  });
  it('rejects replay after an authenticator became active', () => {
    expect(() => pendingAdminMfaSecret({ enabled: true, encrypted_secret: 'old', encrypted_pending: 'new', pending_expires_at_ms: 2000 }, 1000, x => x)).toThrow('active authenticator');
  });
  it('returns a valid pending factor and fails closed on decrypt error', () => {
    const data = { enabled: false, encrypted_pending: 'new', pending_expires_at_ms: 2000 };
    expect(pendingAdminMfaSecret(data, 1000, x => x)).toBe('new');
    expect(() => pendingAdminMfaSecret(data, 1000, () => { throw new Error('decrypt'); })).toThrow('unavailable');
  });
});
