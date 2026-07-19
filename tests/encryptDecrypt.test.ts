import { describe, it, expect, beforeAll, vi } from 'vitest';

// The fallback encryption key in secrets.ts is 36 chars — too long for AES-256-CBC (needs 32).
// We must supply a proper 32-char key before the module loads.
let encrypt: (text: string) => string;
let decrypt: (text: string) => string;

beforeAll(async () => {
  vi.stubEnv('SECRET_ENCRYPTION_KEY', '12345678901234567890123456789012');
  vi.resetModules();
  const m = await import('../src/server/lib/secrets');
  encrypt = m.encrypt;
  decrypt = m.decrypt;
});

describe('encrypt / decrypt', () => {
  it('decrypt(encrypt(x)) returns the original text', () => {
    const original = 'hello navBharatAI';
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it('encrypted output is authenticated GCM: g<N>:<iv>:<tag>:<ct> (2026-07-19)', () => {
    const enc = encrypt('test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/^g\d+$/);      // GCM key-version prefix
    expect(parts[1]).toMatch(/^[0-9a-f]+$/); // iv
    expect(parts[2]).toMatch(/^[0-9a-f]+$/); // auth tag
    expect(parts[3]).toMatch(/^[0-9a-f]+$/); // ciphertext
  });

  it('still decrypts legacy CBC ciphertext — 3-part v<N> AND 2-part (backward compatible)', () => {
    // Produce old-format CBC via the rollback switch; decrypt() must read both shapes.
    process.env.SECRET_CIPHER = 'cbc';
    const cbc = encrypt('legacy');
    delete process.env.SECRET_CIPHER;
    expect(cbc.split(':')).toHaveLength(3);
    expect(cbc).toMatch(/^v\d+:/);
    expect(decrypt(cbc)).toBe('legacy');
    // Pre-versioning 2-part form (strip the v<N>: prefix) still decrypts too.
    const twoPart = cbc.replace(/^v\d+:/, '');
    expect(twoPart.split(':')).toHaveLength(2);
    expect(decrypt(twoPart)).toBe('legacy');
  });

  it('tampered GCM ciphertext fails the auth check → returns empty (integrity)', () => {
    const enc = encrypt('sensitive');
    const parts = enc.split(':');
    // Flip the last hex nibble of the ciphertext.
    const last = parts[3];
    const flipped = last.slice(0, -1) + (last.slice(-1) === '0' ? '1' : '0');
    const tampered = [parts[0], parts[1], parts[2], flipped].join(':');
    expect(decrypt(tampered)).toBe('');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const a = encrypt('same text');
    const b = encrypt('same text');
    expect(a).not.toBe(b);
  });

  it('decrypt returns empty string for malformed input (no colon)', () => {
    expect(decrypt('notvalidciphertext')).toBe('');
  });

  it('handles empty string round-trip', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode string round-trip', () => {
    const text = 'नमस्ते दुनिया';
    expect(decrypt(encrypt(text))).toBe(text);
  });
});
