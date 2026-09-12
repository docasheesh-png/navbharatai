import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, getLatestKeyVersion, secretCreatedAtMs } from '../src/server/lib/secrets';

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

/**
 * WHEN WAS THIS SECRET WRITTEN? (2026-09-12)
 *
 * This number is what decides which of two duplicate keys a build receives, so every shape a
 * `created_at` can arrive in has to reduce to the same comparable value — and an unreadable one has
 * to come back as ABSENT rather than 0, because 0 would make a broken row look like the oldest write
 * and quietly win or lose on that basis.
 */
describe('secretCreatedAtMs', () => {
  it('reads a Date', () => {
    const d = new Date('2026-01-02T03:04:05Z');
    expect(secretCreatedAtMs(d)).toBe(d.getTime());
  });

  it('reads a Firestore Timestamp through toDate()', () => {
    const ms = Date.UTC(2026, 0, 2);
    expect(secretCreatedAtMs({ toDate: () => new Date(ms) })).toBe(ms);
  });

  it('reads a Timestamp that lost its methods crossing JSON', () => {
    expect(secretCreatedAtMs({ seconds: 1_700_000_000, nanoseconds: 0 })).toBe(1_700_000_000_000);
    expect(secretCreatedAtMs({ _seconds: 1_700_000_000 })).toBe(1_700_000_000_000);
  });

  it('reads an ISO string and a plain number', () => {
    expect(secretCreatedAtMs('2026-01-02T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 2));
    expect(secretCreatedAtMs(1234)).toBe(1234);
  });

  it('🔒 anything unreadable is ABSENT, never the epoch', () => {
    expect(secretCreatedAtMs(null)).toBeNull();
    expect(secretCreatedAtMs(undefined)).toBeNull();
    expect(secretCreatedAtMs('not a date')).toBeNull();
    expect(secretCreatedAtMs({})).toBeNull();
    expect(secretCreatedAtMs(NaN)).toBeNull();
    expect(secretCreatedAtMs(new Date('nonsense'))).toBeNull();
  });

  it('a toDate() that throws is absent rather than an exception up the call stack', () => {
    expect(secretCreatedAtMs({ toDate: () => { throw new Error('bad'); } })).toBeNull();
  });
});
