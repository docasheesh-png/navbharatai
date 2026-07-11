import { describe, it, expect } from 'vitest';
import { adminCredential, mintAdminToken, verifyAdminTokenValue, adminTokenTtlMs } from './admin';

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
  // Reproduces the real bug: the login side used a trimmed password while the verifier used the raw
  // env value → login succeeded but every dashboard call was denied. Both sides normalise via
  // adminCredential now, so a token minted at login verifies (using the REAL mint/verify functions).
  it('issued token verifies even when the env value has whitespace/quotes', () => {
    const messyPass = ' MyP@ss \n';
    const rawUser = 'aashishcpmt09\n';
    const pass = adminCredential(messyPass);
    const user = adminCredential(rawUser);
    const now = 1_000_000_000_000;
    const token = mintAdminToken(pass, user, now);
    expect(verifyAdminTokenValue(token, pass, user, now, adminTokenTtlMs(undefined))).toBe(true);
    expect(adminCredential(messyPass)).toBe('MyP@ss');
    expect(adminCredential(rawUser)).toBe('aashishcpmt09');
  });
});

describe('admin token TTL/expiry (SEC Phase 5, F8) — a leaked token no longer grants permanent access', () => {
  const pass = 'secret', user = 'aashishcpmt09', now = 1_700_000_000_000;
  const ttl = adminTokenTtlMs(undefined); // 30 days
  it('a fresh token verifies; wrong pass/user/sig does not', () => {
    const t = mintAdminToken(pass, user, now);
    expect(verifyAdminTokenValue(t, pass, user, now, ttl)).toBe(true);
    expect(verifyAdminTokenValue(t, 'wrong', user, now, ttl)).toBe(false);
    expect(verifyAdminTokenValue(t, pass, 'other', now, ttl)).toBe(false);
    expect(verifyAdminTokenValue(t + 'x', pass, user, now, ttl)).toBe(false);
  });
  it('a token older than the TTL is rejected (expiry)', () => {
    const t = mintAdminToken(pass, user, now);
    expect(verifyAdminTokenValue(t, pass, user, now + ttl - 1, ttl)).toBe(true);   // just inside
    expect(verifyAdminTokenValue(t, pass, user, now + ttl + 1, ttl)).toBe(false);  // just expired
  });
  it('a legacy dotless / malformed / future token is rejected', () => {
    expect(verifyAdminTokenValue('deadbeefstatichmac', pass, user, now, ttl)).toBe(false); // legacy static
    expect(verifyAdminTokenValue('', pass, user, now, ttl)).toBe(false);
    expect(verifyAdminTokenValue(mintAdminToken(pass, user, now + 5 * 60_000), pass, user, now, ttl)).toBe(false); // future-dated
  });
  it('adminTokenTtlMs clamps to a sane range and defaults to 30 days', () => {
    expect(adminTokenTtlMs(undefined)).toBe(720 * 3600 * 1000);
    expect(adminTokenTtlMs('0')).toBe(720 * 3600 * 1000);   // invalid → default
    expect(adminTokenTtlMs('1000000')).toBe(365 * 24 * 3600 * 1000); // clamped to 1yr
    expect(adminTokenTtlMs('24')).toBe(24 * 3600 * 1000);
  });
});
