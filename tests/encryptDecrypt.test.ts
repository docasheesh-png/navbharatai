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

  it('encrypted output contains two colon-separated hex parts', () => {
    const enc = encrypt('test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[0-9a-f]+$/);
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
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
