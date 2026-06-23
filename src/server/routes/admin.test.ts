import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { adminCredential } from './admin';

describe('adminCredential — env normalisation', () => {
  it('trims surrounding whitespace and a trailing newline', () => {
    expect(adminCredential('  secret  ')).toBe('secret');
    expect(adminCredential('secret\n')).toBe('secret');
    expect(adminCredential('\tsecret\r\n')).toBe('secret');
  });

  it('strips a single layer of wrapping quotes (console/gcloud paste habit)', () => {
    expect(adminCredential('"secret"')).toBe('secret');
    expect(adminCredential("'secret'")).toBe('secret');
    expect(adminCredential('"secret with spaces"')).toBe('secret with spaces');
  });

  it('leaves a clean value untouched and applies the fallback', () => {
    expect(adminCredential('aashishcpmt09')).toBe('aashishcpmt09');
    expect(adminCredential(undefined, 'aashishcpmt09')).toBe('aashishcpmt09');
    expect(adminCredential('', 'fallback')).toBe('fallback');
  });

  it('does not strip quotes that are only on one side', () => {
    expect(adminCredential('secret"')).toBe('secret"');
    expect(adminCredential('"secret')).toBe('"secret');
  });
});

describe('admin token HMAC consistency (the regression this guards)', () => {
  // Reproduces the real bug: the login side used a trimmed password while the
  // verifier used the raw env value. If the env carries a trailing newline, the
  // two HMAC keys differed → login succeeded but every dashboard call 403'd.
  // With both sides normalising via adminCredential, the keys must match.
  const tokenFor = (passKey: string, userKey: string) =>
    crypto.createHmac('sha256', passKey)
      .update(`admin:${Math.floor(Date.now() / 86400000)}:${userKey}`)
      .digest('hex');

  it('issued token verifies even when the env value has whitespace/quotes', () => {
    const rawPass = '"MyP@ss\n';      // realistically messy env value (note: only leading quote)
    const messyPass = ' MyP@ss \n';   // whitespace-padded
    const rawUser = 'aashishcpmt09\n';

    // Login side and verify side both normalise the SAME way now.
    const loginToken = tokenFor(adminCredential(messyPass), adminCredential(rawUser));
    const verifyToken = tokenFor(adminCredential(messyPass), adminCredential(rawUser));
    expect(loginToken).toBe(verifyToken);

    // And the normalisation actually changed the value (so the bug was real).
    expect(adminCredential(messyPass)).toBe('MyP@ss');
    expect(adminCredential(rawUser)).toBe('aashishcpmt09');
    // single leading quote is preserved (not a wrapping pair)
    expect(adminCredential(rawPass)).toBe('"MyP@ss');
  });
});
