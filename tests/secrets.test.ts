import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, getLatestKeyVersion } from '../src/server/lib/secrets';

/**
 * P-SEC.5 — Encryption key rotation (versioned ciphertext, backward-compatible).
 */
describe('secrets — versioned encryption (P-SEC.5)', () => {
  it('round-trips a versioned secret (authenticated GCM: g<N>:iv:tag:ct)', () => {
    const plain = 'sk-test-ABC123!@#';
    const enc = encrypt(plain);
    expect(enc.startsWith('g')).toBe(true);           // authenticated GCM format g<N>:iv:tag:ct
    expect(enc.split(':').length).toBe(4);
    expect(decrypt(enc)).toBe(plain);
  });

  it('still decrypts LEGACY CBC ciphertext (v<N>:iv:ct AND <iv>:<ct>) — backward compatible', () => {
    const plain = 'legacy-secret-value';
    // Produce old-format CBC via the rollback switch; decrypt() must read both legacy shapes.
    process.env.SECRET_CIPHER = 'cbc';
    const versioned = encrypt(plain);
    delete process.env.SECRET_CIPHER;
    expect(versioned.split(':').length).toBe(3);
    expect(decrypt(versioned)).toBe(plain);
    // Pre-versioning 2-part form (strip the v<N>: prefix).
    const legacy = versioned.replace(/^v\d+:/, '');
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
