import { describe, it, expect } from 'vitest';
import {
  generateApiKey, hashApiKey, verifyApiKey, normalizeScopes, hasScope, extractApiKey, KEY_PREFIX,
} from './ApiKeyManager';

describe('generateApiKey', () => {
  it('produces a prefixed plaintext whose stored hash matches, and never exposes plaintext in the hash', () => {
    const k = generateApiKey();
    expect(k.plaintext.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.hash).toBe(hashApiKey(k.plaintext));
    expect(k.hash).not.toContain(k.plaintext);
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(k.displayPrefix.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.last4).toHaveLength(4);
  });

  it('generates unique keys and ids', () => {
    const a = generateApiKey(), b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.id).not.toBe(b.id);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('verifyApiKey', () => {
  it('accepts the correct plaintext and rejects wrong/empty ones', () => {
    const k = generateApiKey();
    expect(verifyApiKey(k.plaintext, k.hash)).toBe(true);
    expect(verifyApiKey('nbai_wrong', k.hash)).toBe(false);
    expect(verifyApiKey('', k.hash)).toBe(false);
    expect(verifyApiKey(k.plaintext, '')).toBe(false);
  });

  it('does not throw on a malformed stored hash', () => {
    expect(verifyApiKey('nbai_x', 'not-hex')).toBe(false);
  });
});

describe('normalizeScopes', () => {
  it('keeps known scopes, drops unknowns, dedupes, and rejects non-arrays', () => {
    expect(normalizeScopes(['read:profile', 'read:profile', 'bogus', 'read:usage']))
      .toEqual(['read:profile', 'read:usage']);
    expect(normalizeScopes('read:profile')).toEqual([]);
    expect(normalizeScopes(undefined)).toEqual([]);
  });
});

describe('hasScope', () => {
  it('checks membership safely', () => {
    expect(hasScope(['read:profile'], 'read:profile')).toBe(true);
    expect(hasScope(['read:usage'], 'read:profile')).toBe(false);
    expect(hasScope(undefined, 'read:profile')).toBe(false);
  });
});

describe('extractApiKey', () => {
  it('reads X-API-Key when it is a NavBharatAI key', () => {
    expect(extractApiKey({ 'x-api-key': 'nbai_abc' })).toBe('nbai_abc');
  });
  it('reads a Bearer token only when it is a NavBharatAI key', () => {
    expect(extractApiKey({ authorization: 'Bearer nbai_xyz' })).toBe('nbai_xyz');
    // a Firebase ID token (not nbai_) must NOT be treated as an API key
    expect(extractApiKey({ authorization: 'Bearer eyJhbGciOi...' })).toBeNull();
  });
  it('returns null when no key is present', () => {
    expect(extractApiKey({})).toBeNull();
    expect(extractApiKey({ 'x-api-key': 'somethingelse' })).toBeNull();
  });
});
