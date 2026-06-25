import { describe, it, expect } from 'vitest';
import { explainAuthReason } from './authDiagnostics';

describe('explainAuthReason', () => {
  it('does NOT misreport ADMIN_ONLY_OPERATION as a disabled provider', () => {
    const out = explainAuthReason('ADMIN_ONLY_OPERATION');
    // The diagnostic probe (anonymous sign-up) being rejected is NORMAL — it must not be sold
    // to the admin as "sign-in is turned off".
    expect(out).not.toMatch(/turned off/i);
    expect(out).toMatch(/anonymous sign-up is off/i);
    expect(out).toMatch(/Google/);
    expect(out).toMatch(/support email/i);
  });

  it('reports a genuinely disabled provider for OPERATION_NOT_ALLOWED / PASSWORD_LOGIN_DISABLED', () => {
    expect(explainAuthReason('OPERATION_NOT_ALLOWED')).toMatch(/turned off/i);
    expect(explainAuthReason('PASSWORD_LOGIN_DISABLED')).toMatch(/turned off/i);
  });

  it('reports CONFIGURATION_NOT_FOUND as Authentication not set up', () => {
    expect(explainAuthReason('CONFIGURATION_NOT_FOUND')).toMatch(/not set up/i);
  });

  it('reports wrong-credentials plainly (not as a config problem)', () => {
    expect(explainAuthReason('INVALID_LOGIN_CREDENTIALS')).toMatch(/wrong email or password/i);
    expect(explainAuthReason('EMAIL_NOT_FOUND')).toMatch(/wrong email or password/i);
  });

  it('flags an API key / referrer restriction', () => {
    expect(explainAuthReason('Requests from referer http://x are blocked. API_KEY')).toMatch(/api key/i);
  });

  it('names the project in admin-actionable messages and returns empty for no message', () => {
    expect(explainAuthReason('ADMIN_ONLY_OPERATION')).toContain('gen-lang-client-0866594388');
    expect(explainAuthReason('')).toBe('');
  });
});
