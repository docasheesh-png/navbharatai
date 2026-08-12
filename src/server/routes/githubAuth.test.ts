import { describe, it, expect } from 'vitest';
import { oauthTargetOrigin, nativeOauthReturn } from './githubAuth';

describe('oauthTargetOrigin — OAuth popup token postMessage target', () => {
  it('NEVER returns a wildcard (the property that stops window.opener token theft)', () => {
    // The whole point of this helper: the token post target must be a concrete origin, not '*'.
    for (const v of [null, undefined, '', 'not a url', 'javascript:alert(1)', 'https://navbharatai.com/x']) {
      expect(oauthTargetOrigin(v)).not.toBe('*');
    }
  });

  it('derives the exact origin from an allow-listed return URL', () => {
    expect(oauthTargetOrigin('https://navbharatai.com/build#gh_token=x')).toBe('https://navbharatai.com');
    expect(oauthTargetOrigin('https://navbharatai.web.app/')).toBe('https://navbharatai.web.app');
    expect(oauthTargetOrigin('https://www.navbharatai.com/path?q=1')).toBe('https://www.navbharatai.com');
  });

  it('falls back to the canonical production origin for missing/malformed input', () => {
    expect(oauthTargetOrigin(null)).toBe('https://navbharatai.com');
    expect(oauthTargetOrigin(undefined)).toBe('https://navbharatai.com');
    expect(oauthTargetOrigin('')).toBe('https://navbharatai.com');
    expect(oauthTargetOrigin('::::not-a-url')).toBe('https://navbharatai.com');
  });

  it('does not echo an attacker-crafted origin (returnUrl is already allow-list-filtered upstream)', () => {
    // Even if a raw value slipped through, the derived origin is a real origin string, never '*'.
    const out = oauthTargetOrigin('https://evil.example.com/steal');
    expect(out).toBe('https://evil.example.com');
    expect(out).not.toBe('*');
  });
});

describe('nativeOauthReturn — the native-app OAuth deep-link return', () => {
  it('returns the app custom-scheme URL ONLY for the native sentinel state', () => {
    expect(nativeOauthReturn('nbai-native', 'tok123')).toBe('com.navbharat.ai://github-callback#gh_token=tok123');
  });

  it('is null for the normal web flow, so browser/desktop OAuth is completely unchanged', () => {
    expect(nativeOauthReturn('https://navbharatai.com/build', 'tok')).toBeNull();
    expect(nativeOauthReturn('', 'tok')).toBeNull();
    expect(nativeOauthReturn(undefined, 'tok')).toBeNull();
    expect(nativeOauthReturn(null, 'tok')).toBeNull();
  });

  it('🔒 the scheme target is a FIXED constant — a crafted state can NEVER redirect the token elsewhere', () => {
    // Any non-sentinel state (including an attacker's https/scheme) yields null → falls to the normal,
    // allow-list-guarded web path. The token can only ever reach the app's own com.navbharat.ai scheme.
    expect(nativeOauthReturn('https://evil.example.com', 'tok')).toBeNull();
    expect(nativeOauthReturn('evil://steal', 'tok')).toBeNull();
    // And the URL it DOES produce always points at our own scheme, whatever the token contains.
    expect(nativeOauthReturn('nbai-native', 'a b&c')).toBe('com.navbharat.ai://github-callback#gh_token=a%20b%26c');
  });
});
