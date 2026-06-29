import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, getLatestKeyVersion } from '../src/server/lib/secrets';

/**
 * P-SEC.5 — Encryption key rotation (versioned ciphertext, backward-compatible).
 */
describe('secrets — versioned encryption (P-SEC.5)', () => {
  it('round-trips a versioned secret', () => {
    const plain = 'sk-test-ABC123!@#';
    const enc = encrypt(plain);
    expect(enc.startsWith('v')).toBe(true);           // versioned format v<N>:iv:ct
    expect(enc.split(':').length).toBe(3);
    expect(decrypt(enc)).toBe(plain);
  });

  it('still decrypts LEGACY two-part ciphertext (<iv>:<ct>) — backward compatible', () => {
    const plain = 'legacy-secret-value';
    // Simulate pre-versioning data: strip the version prefix from a fresh ciphertext
    // (same key, so the 2-part legacy path must decrypt it identically).
    const legacy = encrypt(plain).replace(/^v\d+:/, '');
    expect(legacy.split(':').length).toBe(2);
    expect(decrypt(legacy)).toBe(plain);
  });

  it('latest key version defaults to 1 when no SECRET_KEY_V* keys are set', () => {
    expect(getLatestKeyVersion()).toBe(1);
  });

  it('returns empty string on malformed input (never throws)', () => {
    expect(decrypt('')).toBe('');
    expect(decrypt('garbage')).toBe('');
    expect(decrypt('not:valid:hex:extra')).toBe('');
  });

  it('different ivs → different ciphertext for the same plaintext', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
    expect(decrypt(encrypt('same'))).toBe('same');
  });
});
